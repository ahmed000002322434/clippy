/**
 * MEDIA PROCESSING — browser-native worker for the ingestion pipeline.
 *
 * The deployment has no FFmpeg binary and Convex actions are sandboxed, so
 * real media processing runs in the browser against the actual file:
 *
 *  - proxy:     re-encode a lightweight copy (canvas → MediaRecorder) at a
 *               capped resolution with a browser-friendly codec. The
 *               original file is never modified.
 *  - thumbnail: decode a frame at a chosen timestamp (skips the intro).
 *  - timeline:  sample N evenly-spaced frames as compact thumbnails.
 *  - waveform:  decode the real audio track and bucket RMS energy into
 *               peaks the timeline can render without touching audio again.
 *
 * The `MediaProcessor` interface mirrors the FFmpeg service contract, so a
 * server-side worker can replace this implementation without call-site
 * changes.
 */

export interface ProxyOptions {
  /** Longest edge of the proxy, e.g. 720. */
  maxDimension?: number;
  fps?: number;
  signal?: AbortSignal;
  onProgress?: (pct: number) => void;
}

export interface ProxyResult {
  blob: Blob;
  mimeType: string;
  extension: "mp4" | "webm";
  width: number;
  height: number;
  durationMs: number;
}

function pickProxyMimeType(): { mimeType: string; extension: "mp4" | "webm" } {
  const candidates: { mimeType: string; extension: "mp4" | "webm" }[] = [
    { mimeType: "video/mp4", extension: "mp4" },
    { mimeType: "video/webm;codecs=vp9,opus", extension: "webm" },
    { mimeType: "video/webm;codecs=vp8,opus", extension: "webm" },
    { mimeType: "video/webm", extension: "webm" },
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c.mimeType)) {
      return c;
    }
  }
  return { mimeType: "video/webm", extension: "webm" };
}

function loadVideo(url: string, signal?: AbortSignal): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    const onAbort = () => {
      video.removeAttribute("src");
      video.load();
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    video.addEventListener(
      "loadedmetadata",
      () => {
        signal?.removeEventListener("abort", onAbort);
        resolve(video);
      },
      { once: true },
    );
    video.addEventListener("error", () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("Could not load video for processing."));
    }, { once: true });
  });
}

/**
 * Re-encode a proxy of the source video. Real encoding via canvas +
 * MediaRecorder; pace-controlled seeking composes frames at target fps.
 */
export async function generateProxy(
  url: string,
  opts: ProxyOptions,
): Promise<ProxyResult> {
  const fps = opts.fps ?? 30;
  const signal = opts.signal;
  const video = await loadVideo(url, signal);

  const vw = video.videoWidth || 16;
  const vh = video.videoHeight || 9;
  const maxDim = opts.maxDimension ?? 720;
  const scale = Math.min(1, maxDim / Math.max(vw, vh));
  const width = Math.max(2, Math.round(vw * scale) - (Math.round(vw * scale) % 2));
  const height = Math.max(2, Math.round(vh * scale) - (Math.round(vh * scale) % 2));
  const durationMs = (video.duration || 0) * 1000;

  try {
    await video.play();
  } catch {
    // muted play should be allowed; if not, seek-only loop still works
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable for proxy generation.");

  const { mimeType, extension } = pickProxyMimeType();
  const canvasStream = canvas.captureStream(fps);
  const vidStream = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
  const stream = new MediaStream(canvasStream.getVideoTracks());
  if (vidStream) {
    for (const t of vidStream.getAudioTracks()) stream.addTrack(t);
  }

  const recorder = new MediaRecorder(
    stream,
    mimeType ? { mimeType, videoBitsPerSecond: 4_000_000 } : undefined,
  );
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  return new Promise<ProxyResult>((resolve, reject) => {
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
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    recorder.onstop = () => {
      signal?.removeEventListener("abort", onAbort);
      cleanup();
      const blob = new Blob(chunks, { type: mimeType || "video/webm" });
      resolve({ blob, mimeType: mimeType || "video/webm", extension, width, height, durationMs });
    };
    recorder.onerror = (e) => {
      signal?.removeEventListener("abort", onAbort);
      cleanup();
      reject(new Error(`Proxy encoding failed: ${String(e.error ?? "unknown")}`));
    };

    recorder.start(500);

    const frameMs = 1000 / fps;
    let nextT = 0;
    let lastWall = performance.now();

    const step = async () => {
      if (signal?.aborted) return;
      const now = performance.now();
      const elapsed = now - lastWall;
      if (elapsed < frameMs) {
        requestAnimationFrame(step);
        return;
      }
      lastWall = now;

      if (nextT >= durationMs) {
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
        setTimeout(() => {
          video.removeEventListener("seeked", onSeeked);
          resolveSeek();
        }, 500);
      });

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(video, 0, 0, width, height);

      nextT += frameMs;
      opts.onProgress?.(Math.min(99, Math.round((nextT / durationMs) * 100)));
      requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  });
}

/** Capture a single frame as a compact JPEG data-url (skips frame 0). */
export function captureThumbnailAt(
  url: string,
  timeMs: number,
  maxWidth = 640,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = url;
    const onAbort = () => {
      video.removeAttribute("src");
      video.load();
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    video.addEventListener("error", () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("Could not load video for thumbnail."));
    }, { once: true });
    video.addEventListener("loadedmetadata", () => {
      const t = Math.max(0, Math.min(timeMs, (video.duration || 0) * 1000));
      video.currentTime = t / 1000;
    }, { once: true });
    video.addEventListener("seeked", () => {
      try {
        const w = video.videoWidth || 16;
        const h = video.videoHeight || 9;
        const scale = Math.min(1, maxWidth / w);
        const cw = Math.round(w * scale);
        const ch = Math.round(h * scale);
        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas unavailable");
        ctx.drawImage(video, 0, 0, cw, ch);
        signal?.removeEventListener("abort", onAbort);
        video.removeAttribute("src");
        video.load();
        resolve(canvas.toDataURL("image/jpeg", 0.6));
      } catch (err) {
        signal?.removeEventListener("abort", onAbort);
        reject(err instanceof Error ? err : new Error("Thumbnail failed"));
      }
    }, { once: true });
  });
}

/** Sample N evenly-spaced timeline thumbnails across the full duration. */
export async function generateTimelineThumbnails(
  url: string,
  durationMs: number,
  count = 8,
  signal?: AbortSignal,
  onProgress?: (pct: number) => void,
): Promise<string[]> {
  const thumbs: string[] = [];
  const first = Math.min(1500, Math.max(250, durationMs * 0.02));
  const step = Math.max(1000, (durationMs - first) / Math.max(1, count - 1));
  for (let i = 0; i < count; i++) {
    const t = Math.min(durationMs - 1, first + i * step);
    try {
      thumbs.push(await captureThumbnailAt(url, t, 320, signal));
    } catch {
      // A bad sample frame shouldn't fail ingestion — keep what we have.
    }
    onProgress?.(Math.round(((i + 1) / count) * 100));
  }
  return thumbs;
}

/**
 * Build compact waveform peaks from real decoded audio.
 * `energy` is the normalized per-window RMS array from the analysis pass;
 * we bucket it into `buckets` peaks the timeline can render instantly.
 */
export function buildWaveformPeaks(
  energy: number[],
  windowMs: number,
  buckets = 600,
): { peaks: number[]; sampleRate: number } {
  if (!energy || energy.length === 0) return { peaks: [], sampleRate: 0 };
  const n = Math.min(buckets, energy.length);
  const peaks: number[] = new Array(n).fill(0);
  for (let i = 0; i < energy.length; i++) {
    const idx = Math.min(n - 1, Math.floor((i / energy.length) * n));
    peaks[idx] = Math.max(peaks[idx], energy[i] ?? 0);
  }
  return { peaks, sampleRate: windowMs > 0 ? Math.round(1000 / windowMs) : 0 };
}

/** Readable stage labels for the ingestion pipeline (honest states). */
export const INGESTION_STAGES = [
  "Probing media",
  "Generating proxy",
  "Generating thumbnails",
  "Extracting waveform",
  "Finalizing",
] as const;
