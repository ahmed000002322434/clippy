import { drawCaptionLine } from "./captions";
import { motionCenterAt } from "./analyze";
import type {
  AnalysisSignals,
  AspectRatio,
  CaptionStyle,
  Transcript,
} from "./types";

export const ASPECT_DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "16:9": { width: 1920, height: 1080 },
};

export interface RenderOptions {
  aspect: AspectRatio;
  captionsEnabled: boolean;
  captionStyle: CaptionStyle;
  fps?: number;
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
}

export interface RenderResult {
  blob: Blob;
  mimeType: string;
  extension: "mp4" | "webm";
}

function pickMimeType(): { mimeType: string; extension: "mp4" | "webm" } {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("This browser does not support in-browser recording.");
  }
  const candidates: { mimeType: string; extension: "mp4" | "webm" }[] = [
    { mimeType: "video/mp4", extension: "mp4" },
    { mimeType: "video/webm;codecs=vp9,opus", extension: "webm" },
    { mimeType: "video/webm;codecs=vp8,opus", extension: "webm" },
    { mimeType: "video/webm", extension: "webm" },
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mimeType)) return c;
  }
  return { mimeType: "", extension: "webm" };
}

interface ReframeState {
  cropX: number;
  cropY: number;
  initialized: boolean;
}

function computeCrop(
  video: HTMLVideoElement,
  canvasW: number,
  canvasH: number,
  signals: AnalysisSignals | null,
  timeMs: number,
  state: ReframeState,
): { sx: number; sy: number; sw: number; sh: number } {
  const vw = video.videoWidth || 16;
  const vh = video.videoHeight || 9;
  const targetAr = canvasW / canvasH;
  const sourceAr = vw / vh;

  let sw: number;
  let sh: number;
  if (sourceAr > targetAr) {
    // crop horizontal
    sh = vh;
    sw = vh * targetAr;
  } else {
    sw = vw;
    sh = vw / targetAr;
  }

  let targetX = (vw - sw) / 2;
  let targetY = (vh - sh) / 2;

  if (signals?.motionCenters?.length) {
    const mc = motionCenterAt(signals.motionCenters, timeMs);
    // bias crop toward active region, clamped to bounds
    targetX = Math.min(vw - sw, Math.max(0, mc.x * vw - sw / 2));
    targetY = Math.min(vh - sh, Math.max(0, mc.y * vh - sh / 2));
    // bias toward the top-ish for talking heads when there's vertical slack
    if (sh < vh && sourceAr > targetAr * 1.15) {
      targetY = Math.min(vh - sh, Math.max(0, (vh - sh) * 0.3));
    }
  }

  // smooth movement to avoid jitter
  if (!state.initialized) {
    state.cropX = targetX;
    state.cropY = targetY;
    state.initialized = true;
  } else {
    state.cropX += (targetX - state.cropX) * 0.25;
    state.cropY += (targetY - state.cropY) * 0.25;
  }

  return {
    sx: Math.max(0, Math.min(vw - sw, state.cropX)),
    sy: Math.max(0, Math.min(vh - sh, state.cropY)),
    sw,
    sh,
  };
}

/** Draw a single composed frame (reframe + captions). */
export function drawComposedFrame(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  video: HTMLVideoElement,
  signals: AnalysisSignals | null,
  timeMs: number,
  reframe: ReframeState,
  captionsEnabled: boolean,
  captionStyle: CaptionStyle,
  activeCaptionLine: { draw: (ctx: CanvasRenderingContext2D, t: number) => void } | null,
) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvasW, canvasH);
  const crop = computeCrop(video, canvasW, canvasH, signals, timeMs, reframe);
  ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvasW, canvasH);
  if (captionsEnabled && activeCaptionLine) {
    activeCaptionLine.draw(ctx, timeMs);
  }
}

/**
 * Renders the clip in real time (canvas + MediaRecorder) with audio.
 * Progress is real: it tracks how much of the clip has been composed.
 */
export async function renderClip(
  videoUrl: string,
  startMs: number,
  endMs: number,
  transcript: Transcript | null,
  signals: AnalysisSignals | null,
  options: RenderOptions,
): Promise<RenderResult> {
  const fps = options.fps ?? 30;
  const { width, height } = ASPECT_DIMENSIONS[options.aspect];
  const durationMs = Math.max(1, endMs - startMs);

  const video = document.createElement("video");
  video.src = videoUrl;
  video.muted = true; // start muted to satisfy autoplay policy
  video.playsInline = true;
  video.preload = "auto";

  await new Promise<void>((resolve, reject) => {
    video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    video.addEventListener("error", () => reject(new Error("Could not load video for render")), { once: true });
  });

  // Autoplay policies block unmuted play without a gesture; play muted first,
  // then unmute so the audio track is included in the capture stream.
  try {
    await video.play();
    video.muted = false;
  } catch {
    video.muted = false;
    await video.play();
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  const { mimeType, extension } = pickMimeType();
  const canvasStream = canvas.captureStream(fps);
  const videoWithStream = video as HTMLVideoElement & {
    captureStream: () => MediaStream;
  };
  const videoStream = videoWithStream.captureStream();
  const audioTracks = videoStream.getAudioTracks();
  const stream = new MediaStream(canvasStream.getVideoTracks());
  for (const track of audioTracks) stream.addTrack(track);

  const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 8_000_000 } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const reframe: ReframeState = { cropX: 0, cropY: 0, initialized: false };

  const clipCaptions = transcript
    ? await import("./captions").then((m) => m.buildCaptionLines(transcript))
    : [];

  const activeLineAt = (t: number) => {
    const line = clipCaptions.find((l) => t >= l.startMs && t <= l.endMs);
    if (!line) return null;
    return {
      draw: (c: CanvasRenderingContext2D, time: number) =>
        drawCaptionLine(c, line, time, options.captionStyle),
    };
  };

  return new Promise<RenderResult>((resolve, reject) => {
    const cleanup = () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
    const onAbort = () => {
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
      cleanup();
      reject(new DOMException("Render cancelled", "AbortError"));
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    recorder.onstop = () => {
      options.signal?.removeEventListener("abort", onAbort);
      cleanup();
      const blob = new Blob(chunks, { type: mimeType || "video/webm" });
      resolve({ blob, mimeType: mimeType || "video/webm", extension });
    };
    recorder.onerror = (e) => {
      options.signal?.removeEventListener("abort", onAbort);
      cleanup();
      reject(new Error(`Recording failed: ${String(e.error ?? "unknown")}`));
    };

    recorder.start(250);

    // realtime-paced seek loop
    const frameMs = 1000 / fps;
    let nextT = startMs;
    let lastWall = performance.now();
    let recording = true;

    const step = async () => {
      if (!recording || options.signal?.aborted) return;
      const now = performance.now();
      const elapsed = now - lastWall;
      if (elapsed < frameMs) {
        requestAnimationFrame(step);
        return;
      }
      lastWall = now;

      if (nextT >= endMs) {
        recording = false;
        setTimeout(() => recorder.stop(), 400);
        return;
      }

      video.currentTime = nextT / 1000;
      await new Promise<void>((resolveSeek) => {
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          resolveSeek();
        };
        video.addEventListener("seeked", onSeeked);
        // safety: if seeking stalls, advance anyway
        setTimeout(() => {
          video.removeEventListener("seeked", onSeeked);
          resolveSeek();
        }, 500);
      });

      drawComposedFrame(
        ctx,
        width,
        height,
        video,
        signals,
        nextT,
        reframe,
        options.captionsEnabled,
        options.captionStyle,
        activeLineAt(nextT),
      );

      nextT += frameMs;
      const pct = Math.min(99, ((nextT - startMs) / durationMs) * 100);
      options.onProgress?.(Math.round(pct));
      requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  });
}

/** Best-effort canvas preview for the studio (no recording). */
export function createPreviewDrawer(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  opts: {
    signals: AnalysisSignals | null;
    captionsEnabled: boolean;
    captionStyle: CaptionStyle;
    activeLineAt: (t: number) => { draw: (c: CanvasRenderingContext2D, time: number) => void } | null;
    aspect: AspectRatio;
  },
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const { width, height } = ASPECT_DIMENSIONS[opts.aspect];
  const reframe: ReframeState = { cropX: 0, cropY: 0, initialized: false };

  // Resize canvas to match aspect (scaled down for performance)
  const scale = Math.min(1, 720 / width);
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  return (timeMs: number) => {
    drawComposedFrame(
      ctx,
      canvas.width,
      canvas.height,
      video,
      opts.signals,
      timeMs,
      reframe,
      opts.captionsEnabled,
      opts.captionStyle,
      opts.activeLineAt(timeMs),
    );
  };
}
