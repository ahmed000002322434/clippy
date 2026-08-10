import type { AnalysisSignals, VideoMeta } from "./types";

export type AnalysisStage = "reading" | "audio" | "scenes" | "energy";

export interface AnalysisProgress {
  stage: AnalysisStage;
  pct: number;
}

const WINDOW_MS = 100;
const MAX_AUDIO_DECODE_BYTES = 400 * 1024 * 1024; // 400MB safety guard

function abortIf(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

/**
 * Analyzes a video file entirely in the browser:
 *  1. Reads media metadata (duration, dimensions, thumbnail)
 *  2. Decodes audio and computes per-window RMS energy + voiced frames
 *  3. Samples frames to detect scene changes and the active region centroid
 *
 * The result is a compact structured representation persisted with the video.
 */
export async function analyzeVideoFile(
  file: File,
  onProgress?: (p: AnalysisProgress) => void,
  signal?: AbortSignal,
): Promise<{ signals: AnalysisSignals; meta: VideoMeta }> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const meta = await loadMeta(objectUrl, onProgress, signal);
    const signals = await computeSignals(
      file,
      objectUrl,
      meta.durationMs,
      onProgress,
      signal,
    );
    return { signals, meta };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadMeta(
  url: string,
  onProgress?: (p: AnalysisProgress) => void,
  signal?: AbortSignal,
): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    onProgress?.({ stage: "reading", pct: 5 });
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Could not read this video file. It may be corrupt or unsupported."));
    };
    video.addEventListener("error", onError, { once: true });
    video.addEventListener(
      "loadedmetadata",
      async () => {
        try {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
          const durationMs = (video.duration || 0) * 1000;
          const width = video.videoWidth || 0;
          const height = video.videoHeight || 0;
          if (durationMs <= 0 || width <= 0) throw new Error("Invalid video metadata");
          onProgress?.({ stage: "reading", pct: 10 });
          const thumbnail = await captureThumbnail(video, width, height);
          onProgress?.({ stage: "reading", pct: 15 });
          cleanup();
          resolve({ durationMs, width, height, thumbnail });
        } catch (err) {
          cleanup();
          reject(err);
        }
      },
      { once: true },
    );
  });
}

function captureThumbnail(
  video: HTMLVideoElement,
  width: number,
  height: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const t = Math.min(0.5, (video.duration || 1) / 2);
    const onSeeked = () => {
      try {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 640 / width);
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas unavailable"));
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.65));
      } catch (err) {
        reject(err);
      }
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.currentTime = t;
  });
}

async function computeSignals(
  file: File,
  url: string,
  durationMs: number,
  onProgress?: (p: AnalysisProgress) => void,
  signal?: AbortSignal,
): Promise<AnalysisSignals> {
  // --- Audio energy -----------------------------------------------------
  let energy: number[] = [];
  let voiced: boolean[] = [];
  let audioAnalyzed = false;

  const canDecodeAudio =
    file.type.startsWith("video/") || file.type.startsWith("audio/");

  if (canDecodeAudio && file.size <= MAX_AUDIO_DECODE_BYTES) {
    try {
      const audioData = await decodeAudio(file, onProgress, signal);
      if (audioData) {
        energy = computeEnergy(audioData, durationMs);
        voiced = computeVoiced(energy);
        audioAnalyzed = true;
      }
    } catch {
      // Audio decoding failed (unsupported codec, memory) — continue with
      // visual-only analysis rather than failing the whole pipeline.
      audioAnalyzed = false;
    }
  }

  // --- Scene + motion sampling -----------------------------------------
  const sampleEveryMs = Math.max(1000, Math.min(2500, durationMs / 180));
  const { scenes, motionCenters } = await sampleScenesAndMotion(
    url,
    durationMs,
    sampleEveryMs,
    onProgress,
    signal,
  );

  onProgress?.({ stage: "energy", pct: 100 });

  // --- Pauses (silence) --------------------------------------------------
  const pauses = audioAnalyzed
    ? detectPauses(voiced, energy.length, WINDOW_MS, durationMs)
    : [];

  return {
    durationMs,
    windowMs: WINDOW_MS,
    energy,
    voiced,
    pauses,
    scenes,
    motionCenters,
    audioAnalyzed,
    sampleEveryMs,
  };
}

async function decodeAudio(
  file: File,
  onProgress?: (p: AnalysisProgress) => void,
  signal?: AbortSignal,
): Promise<AudioBuffer | null> {
  onProgress?.({ stage: "audio", pct: 15 });
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const arrayBuffer = await file.arrayBuffer();
    abortIf(signal);
    onProgress?.({ stage: "audio", pct: 40 });
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    abortIf(signal);
    onProgress?.({ stage: "audio", pct: 100 });
    return buffer;
  } finally {
    void ctx.close().catch(() => undefined);
  }
}

function computeEnergy(buffer: AudioBuffer, durationMs: number): number[] {
  const data = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const windowSamples = Math.round((WINDOW_MS / 1000) * sampleRate);
  const nWindows = Math.max(1, Math.ceil(data.length / windowSamples));
  const rms: number[] = new Array(nWindows);
  for (let w = 0; w < nWindows; w++) {
    let sum = 0;
    const start = w * windowSamples;
    const end = Math.min(data.length, start + windowSamples);
    for (let i = start; i < end; i++) sum += data[i] * data[i];
    rms[w] = Math.sqrt(sum / Math.max(1, end - start));
  }
  // Normalize by a robust max (95th percentile)
  const sorted = [...rms].sort((a, b) => a - b);
  const maxRms = sorted[Math.floor(sorted.length * 0.95)] || 1e-6;
  // Resample to match durationMs / WINDOW_MS target length
  const targetLen = Math.max(1, Math.round(durationMs / WINDOW_MS));
  const out = new Array<number>(targetLen).fill(0);
  for (let i = 0; i < nWindows; i++) {
    const idx = Math.min(targetLen - 1, Math.round((i / nWindows) * (targetLen - 1)));
    out[idx] = Math.min(1, rms[i] / maxRms);
  }
  // Fill any zero-length gaps with neighbor values
  let last = 0;
  for (let i = 0; i < out.length; i++) {
    if (out[i] > 0) last = out[i];
    else out[i] = last;
  }
  return out;
}

function computeVoiced(energy: number[]): boolean[] {
  const nonZero = energy.filter((e) => e > 0.004);
  if (nonZero.length === 0) return energy.map(() => false);
  const median = nonZero.sort((a, b) => a - b)[Math.floor(nonZero.length / 2)];
  const floor = Math.max(0.008, median * 2.2);
  return energy.map((e) => e >= floor);
}

function detectPauses(
  voiced: boolean[],
  nWindows: number,
  windowMs: number,
  durationMs: number,
): { startMs: number; endMs: number }[] {
  const pauses: { startMs: number; endMs: number }[] = [];
  let runStart = -1;
  for (let i = 0; i <= voiced.length; i++) {
    const isVoiced = i < voiced.length ? voiced[i] : true;
    if (!isVoiced && runStart === -1) runStart = i;
    if (isVoiced && runStart !== -1) {
      const startMs = runStart * windowMs;
      const endMs = i * windowMs;
      if (endMs - startMs >= 300) pauses.push({ startMs, endMs });
      runStart = -1;
    }
  }
  void nWindows;
  void durationMs;
  return pauses;
}

interface FrameSample {
  tMs: number;
  diff: number;
  cx: number;
  cy: number;
}

function sampleScenesAndMotion(
  url: string,
  durationMs: number,
  sampleEveryMs: number,
  onProgress?: (p: AnalysisProgress) => void,
  signal?: AbortSignal,
): Promise<{ scenes: number[]; motionCenters: AnalysisSignals["motionCenters"] }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;

    const samples: FrameSample[] = [];
    const scenes: number[] = [];
    const canvas = document.createElement("canvas");
    const SW = 64;
    const SH = 36;
    canvas.width = SW;
    canvas.height = SH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return reject(new Error("Canvas unavailable"));

    let prevData: Uint8ClampedArray | null = null;
    let currentIdx = 0;
    const times: number[] = [];
    for (let t = 0; t < durationMs; t += sampleEveryMs) times.push(t);
    if (times.length === 0) times.push(0);

    const done = () => {
      video.removeAttribute("src");
      video.load();
      resolve({ scenes, motionCenters: samples.map((s) => ({ tMs: s.tMs, x: s.cx, y: s.cy })) });
    };

    const step = () => {
      if (signal?.aborted) {
        video.removeAttribute("src");
        video.load();
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const t = times[currentIdx];
      video.currentTime = t / 1000;
    };

    video.addEventListener("error", () => {
      // Sampling failed partway — still deliver whatever we captured.
      done();
    });

    video.addEventListener(
      "seeked",
      () => {
        try {
          ctx.drawImage(video, 0, 0, SW, SH);
          const imageData = ctx.getImageData(0, 0, SW, SH).data;
          let diff = 0;
          let sumX = 0;
          let sumY = 0;
          let weight = 0;
          if (prevData) {
            for (let i = 0; i < imageData.length; i += 4) {
              const d =
                Math.abs(imageData[i] - prevData[i]) +
                Math.abs(imageData[i + 1] - prevData[i + 1]) +
                Math.abs(imageData[i + 2] - prevData[i + 2]);
              if (d > 30) {
                diff += d;
                const px = (i / 4) % SW;
                const py = Math.floor(i / 4 / SW);
                sumX += px * d;
                sumY += py * d;
                weight += d;
              }
            }
            diff /= imageData.length / 4;
          }
          prevData = imageData;
          const cx = weight > 0 ? sumX / weight / SW : 0.5;
          const cy = weight > 0 ? sumY / weight / SH : 0.5;
          const tMs = times[currentIdx];
          samples.push({ tMs, diff, cx, cy });
          if (samples.length > 1 && diff > 0.11) scenes.push(tMs);
          currentIdx++;
          onProgress?.({
            stage: "scenes",
            pct: Math.round((currentIdx / times.length) * 100),
          });
          if (currentIdx < times.length) {
            step();
          } else {
            done();
          }
        } catch {
          done();
        }
      },
      { once: false },
    );

    step();
  });
}

/** Linear-interpolated active region (normalized 0..1) at a given time. */
export function motionCenterAt(
  centers: AnalysisSignals["motionCenters"],
  tMs: number,
  fallback = { x: 0.5, y: 0.45 },
): { x: number; y: number } {
  if (!centers || centers.length === 0) return fallback;
  if (tMs <= centers[0].tMs) return { x: centers[0].x, y: centers[0].y };
  const last = centers[centers.length - 1];
  if (tMs >= last.tMs) return { x: last.x, y: last.y };
  let lo = 0;
  let hi = centers.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (centers[mid].tMs <= tMs) lo = mid;
    else hi = mid;
  }
  const a = centers[lo];
  const b = centers[hi];
  const span = Math.max(1, b.tMs - a.tMs);
  const k = (tMs - a.tMs) / span;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}
