/**
 * MEDIA INGESTION WORKER
 * ----------------------
 * Runs the ingestion pipeline for a freshly-uploaded video and reports real
 * progress to its processing job. Because this deployment has no FFmpeg
 * binary and Convex actions are sandboxed, the "worker" runs in the browser
 * against the stored object URL — every step is real (actual media
 * decode/encode) and progress reflects completed work, not a fake timer.
 *
 * Pipeline: prepare (download) → probe → analyze (signals + thumbnail) →
 * proxy → timeline thumbnails → waveform → finalize.
 *
 * The `MediaProcessor`-shaped functions in ./processing map 1:1 to an FFmpeg
 * service contract, so a server-side worker can replace this implementation
 * without call-site changes.
 */

import type { Id } from "@/convex/_generated/dataModel";
import type { AnalysisSignals } from "./types";
import { analyzeVideoFile } from "./analyze";
import { probeMedia } from "./probe";
import {
  buildWaveformPeaks,
  generateProxy,
  generateTimelineThumbnails,
} from "./processing";

export interface JobMutations {
  claimJob: (args: { jobId: Id<"processingJobs"> }) => Promise<unknown>;
  updateJobProgress: (args: {
    jobId: Id<"processingJobs">;
    progress: number;
    stage?: string;
  }) => Promise<unknown>;
  completeJob: (args: {
    jobId: Id<"processingJobs">;
    result?: unknown;
  }) => Promise<unknown>;
  failJob: (args: {
    jobId: Id<"processingJobs">;
    error: string;
    errorClass?: "retryable" | "permanent" | "user-action";
  }) => Promise<unknown>;
}

export interface IngestInput {
  jobId: Id<"processingJobs">;
  videoId: Id<"videos">;
  /** Signed URL of the stored original. */
  sourceUrl: string;
  mimeType: string;
  filename: string;
  mutations: JobMutations;
  /** Uploads a generated blob (e.g. the proxy) to storage, returns id+url. */
  storeBlob?: (blob: Blob, mimeType: string) => Promise<{ storageId: string; url: string }>;
  signal?: AbortSignal;
}

export interface IngestResult {
  mediaInfo: Record<string, unknown>;
  waveform: { peaks: number[]; sampleRate: number } | null;
  timelineThumbnails: string[];
  proxy: { storageId: string; url: string; width: number; height: number } | null;
  /** Honest reason a proxy wasn't generated (e.g. "duration"). */
  proxySkipped?: string;
  signals: AnalysisSignals | null;
  thumbnail: string | null;
}

export class IngestError extends Error {
  errorClass: "retryable" | "permanent" | "user-action";
  constructor(message: string, errorClass: IngestError["errorClass"] = "retryable") {
    super(message);
    this.errorClass = errorClass;
  }
}

/** Honest stage labels for the ingestion pipeline. */
export const INGESTION_STAGES = [
  "Preparing",
  "Probing media",
  "Analyzing audio & scenes",
  "Generating proxy",
  "Generating thumbnails",
  "Extracting waveform",
  "Finalizing",
] as const;

/**
 * Proxy generation seeks + re-encodes every frame in the browser. For long
 * videos that is impractical (hours of work), so we only generate a proxy up
 * to this duration and let the original serve playback beyond it.
 */
const MAX_PROXY_DURATION_MS = 10 * 60 * 1000; // 10 minutes

/** Start of each stage in overall % (7 stages). */
const STAGE_START = [0, 4, 12, 48, 74, 86, 93];

function stagePct(index: number, within: number): number {
  const start = STAGE_START[index] ?? 96;
  const end = STAGE_START[index + 1] ?? 99;
  return Math.round(start + (end - start) * Math.min(1, Math.max(0, within)));
}

/** Run the ingestion pipeline for one video. */
export async function runIngestion(input: IngestInput): Promise<IngestResult> {
  const { jobId, mutations, signal } = input;

  // Claim the job (idempotent — a duplicate run returns current state).
  await mutations.claimJob({ jobId });

  const report = (stage: string, pct: number) =>
    void mutations.updateJobProgress({ jobId, progress: pct, stage }).catch(() => undefined);

  try {
    // --- 0. Prepare: download the stored original ----------------------
    report(INGESTION_STAGES[0], stagePct(0, 0.1));
    const res = await fetch(input.sourceUrl, { signal });
    if (!res.ok) {
      throw new IngestError(
        `Could not download the stored file (${res.status}). Try re-uploading.`,
        "retryable",
      );
    }
    const blob = await res.blob();
    if (blob.size <= 0) {
      throw new IngestError(
        "The stored file is empty or unreadable. Try re-uploading it.",
        "permanent",
      );
    }
    const file = new File([blob], input.filename || "video", {
      type: input.mimeType || blob.type || "video/mp4",
    });
    const objectUrl = URL.createObjectURL(file);
    report(INGESTION_STAGES[0], stagePct(0, 1));

    try {
      // --- 1. Probe -----------------------------------------------------
      report(INGESTION_STAGES[1], stagePct(1, 0.1));
      const mediaInfo = await probeMedia(objectUrl, {
        mimeType: input.mimeType,
        filename: input.filename,
        signal,
        onProgress: () => report(INGESTION_STAGES[1], stagePct(1, 0.5)),
      });
      report(INGESTION_STAGES[1], stagePct(1, 1));

      // --- 2. Analyze: signals + thumbnail (Phase 1 pipeline) ----------
      report(INGESTION_STAGES[2], stagePct(2, 0.02));
      let signals: AnalysisSignals | null = null;
      let thumbnail: string | null = null;
      try {
        const analysis = await analyzeVideoFile(
          file,
          (p) => {
            const within =
              p.stage === "reading"
                ? p.pct * 0.2
                : p.stage === "audio"
                  ? 20 + p.pct * 0.4
                  : 60 + p.pct * 0.4;
            report(INGESTION_STAGES[2], stagePct(2, within / 100));
          },
          signal,
        );
        signals = analysis.signals;
        thumbnail = analysis.meta.thumbnail;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        // Analysis failed — ingestion continues with probe/thumbnail data.
      }
      report(INGESTION_STAGES[2], stagePct(2, 1));

      // --- 3. Proxy -----------------------------------------------------
      report(INGESTION_STAGES[3], stagePct(3, 0.02));
      let proxy: Awaited<ReturnType<typeof generateProxy>> | null = null;
      let proxySkipped: string | undefined;
      if (mediaInfo.duration * 1000 <= MAX_PROXY_DURATION_MS) {
        proxy = await generateProxy(objectUrl, {
          maxDimension: 720,
          fps: 30,
          signal,
          onProgress: (pct) => report(INGESTION_STAGES[3], stagePct(3, pct / 100)),
        });
      } else {
        proxySkipped = "duration";
      }
      report(INGESTION_STAGES[3], stagePct(3, 1));

      // --- 4. Timeline thumbnails ----------------------------------------
      report(INGESTION_STAGES[4], stagePct(4, 0.02));
      const timelineThumbnails = await generateTimelineThumbnails(
        objectUrl,
        mediaInfo.duration * 1000,
        8,
        signal,
        (pct) => report(INGESTION_STAGES[4], stagePct(4, pct / 100)),
      );
      report(INGESTION_STAGES[4], stagePct(4, 1));

      // --- 5. Waveform (derived from decoded audio energy) --------------
      report(INGESTION_STAGES[5], stagePct(5, 0.2));
      let waveform: { peaks: number[]; sampleRate: number } | null = null;
      if (signals?.energy?.length) {
        waveform = buildWaveformPeaks(signals.energy, signals.windowMs);
      }
      report(INGESTION_STAGES[5], stagePct(5, 1));

      // --- 6. Finalize --------------------------------------------------
      report(INGESTION_STAGES[6], stagePct(6, 0.2));

      let proxyResult: IngestResult["proxy"] = null;
      if (proxy && proxy.blob.size > 0 && input.storeBlob) {
        const stored = await input.storeBlob(proxy.blob, proxy.mimeType);
        proxyResult = {
          storageId: stored.storageId,
          url: stored.url,
          width: proxy.width,
          height: proxy.height,
        };
      }

      const result: IngestResult = {
        mediaInfo: {
          duration: mediaInfo.duration,
          width: mediaInfo.width,
          height: mediaInfo.height,
          fps: mediaInfo.fps,
          videoCodec: mediaInfo.videoCodec,
          audioCodec: mediaInfo.audioCodec,
          sampleRate: mediaInfo.sampleRate,
          channels: mediaInfo.channels,
          container: mediaInfo.container,
          rotation: mediaInfo.rotation,
          orientation: mediaInfo.orientation,
          hasAudio: mediaInfo.hasAudio,
        },
        waveform,
        timelineThumbnails,
        proxy: proxyResult,
        proxySkipped,
        signals,
        thumbnail,
      };

      report(INGESTION_STAGES[6], stagePct(6, 0.7));
      await mutations.completeJob({
        jobId,
        result: {
          mediaInfo: result.mediaInfo,
          waveform: result.waveform ?? undefined,
          timelineThumbnails: result.timelineThumbnails,
          proxyStorageId: proxyResult?.storageId ?? undefined,
          proxyUrl: proxyResult?.url ?? undefined,
          signals: result.signals ?? undefined,
          thumbnail: result.thumbnail ?? undefined,
        },
      });
      report(INGESTION_STAGES[6], stagePct(6, 1));

      return result;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      await mutations.failJob({
        jobId,
        error: "Processing cancelled",
        errorClass: "user-action",
      });
      throw err;
    }
    const message = err instanceof Error ? err.message : "Processing failed";
    const errorClass =
      err instanceof IngestError
        ? err.errorClass
        : message.toLowerCase().includes("corrupt") ||
            message.toLowerCase().includes("unsupported")
          ? "permanent"
          : "retryable";
    await mutations.failJob({ jobId, error: message, errorClass });
    throw err;
  }
}

export type { IngestResult as IngestResultType };
