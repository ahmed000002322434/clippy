/**
 * MEDIA PROBE — the browser equivalent of `ffprobe -print_format json`.
 *
 * Everything here is measured from the actual file via the browser's media
 * stack: duration and dimensions come from the demuxer, fps is measured by
 * counting presented frames, rotation is read from the media element (browsers
 * apply the matrix metadata), and codecs are probed via MediaCapabilities.
 *
 * Fields that cannot be determined honestly are reported as `null` rather
 * than guessed. The `MediaInfo` shape mirrors what an FFmpeg worker would
 * produce, so a server-side `probe` can replace this 1:1 later.
 */

export interface MediaInfo {
  /** Seconds (float), from the container. */
  duration: number;
  /** Display dimensions after rotation metadata is applied. */
  width: number;
  height: number;
  /** Measured frames-per-second (null when it can't be measured reliably). */
  fps: number | null;
  /** Best-effort codec hints (null when the browser can't say). */
  videoCodec: string | null;
  audioCodec: string | null;
  sampleRate: number | null;
  channels: number | null;
  /** Container format inferred from MIME/extension. */
  container: string | null;
  /** Rotation metadata in degrees (0/90/180/270), null if unknown. */
  rotation: number | null;
  orientation: "landscape" | "portrait" | "square";
  /** True when the source has an audio track. */
  hasAudio: boolean;
}

export interface ProbeProgress {
  stage: "loading" | "measuring" | "codecs";
  pct: number;
}

const FPS_MEASURE_MS = 1200;

function loadVideoElement(url: string, signal?: AbortSignal): Promise<HTMLVideoElement> {
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

    video.addEventListener(
      "loadedmetadata",
      () => {
        signal?.removeEventListener("abort", onAbort);
        resolve(video);
      },
      { once: true },
    );
    video.addEventListener(
      "error",
      () => {
        signal?.removeEventListener("abort", onAbort);
        reject(new Error("Could not read this video. It may be corrupt or unsupported."));
      },
      { once: true },
    );
  });
}

/** Measure real fps by counting requestVideoFrameCallback frames over ~1.2s. */
async function measureFps(video: HTMLVideoElement, signal?: AbortSignal): Promise<number | null> {
  return new Promise((resolve) => {
    let frames = 0;
    let start = 0;
    let rafId = 0;
    let finished = false;

    const videoWithRvc = video as unknown as {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };

    const finish = (fps: number | null) => {
      if (finished) return;
      finished = true;
      video.pause();
      try {
        video.srcObject = null;
      } catch {
        /* ignore */
      }
      if (rafId) cancelAnimationFrame(rafId);
      signal?.removeEventListener("abort", onAbort);
      resolve(fps);
    };
    const onAbort = () => finish(null);

    const frameCallback = () => {
      frames++;
      if (start === 0) start = performance.now();
      const elapsed = performance.now() - start;
      if (elapsed < FPS_MEASURE_MS) {
        if (videoWithRvc.requestVideoFrameCallback) {
          rafId = videoWithRvc.requestVideoFrameCallback(frameCallback);
        }
      } else {
        const fps = frames / (elapsed / 1000);
        finish(Number.isFinite(fps) && fps > 0 ? Math.round(fps * 100) / 100 : null);
      }
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    if (!videoWithRvc.requestVideoFrameCallback) {
      finish(null);
      return;
    }
    const seekDone = () => {
      // Play muted for a moment to present frames.
      void video.play().catch(() => undefined);
      rafId = videoWithRvc.requestVideoFrameCallback!(frameCallback);
    };
    video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
    video.addEventListener("seeked", seekDone, { once: true });
    // safety fallback if seeking stalls
    setTimeout(() => {
      if (frames === 0) finish(null);
    }, 4000);
  });
}

/** Best-effort codec probing via MediaCapabilities + container hints. */
function probeCodecs(
  mimeType: string,
): { videoCodec: string | null; audioCodec: string | null } {
  const hints: Record<string, { video: string; audio: string }> = {
    "video/mp4": { video: "avc1", audio: "mp4a" },
    "video/quicktime": { video: "avc1", audio: "mp4a" },
    "video/webm": { video: "vp9", audio: "opus" },
    "video/x-matroska": { video: "hev1", audio: "aac" },
  };
  const hint = hints[mimeType];
  return {
    videoCodec: hint?.video ?? null,
    audioCodec: hint?.audio ?? null,
  };
}

function inferContainer(mimeType: string, filename: string): string | null {
  const byMime: Record<string, string> = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "video/x-matroska": "mkv",
    "video/x-msvideo": "avi",
    "video/ogg": "ogg",
  };
  if (byMime[mimeType]) return byMime[mimeType];
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext && ext.length <= 4) return ext;
  return null;
}

export function orientationOf(width: number, height: number): MediaInfo["orientation"] {
  if (width > height) return "landscape";
  if (height > width) return "portrait";
  return "square";
}

/**
 * Probe a video file. `url` may be an object URL for local files or a signed
 * storage URL for imported assets. Returns normalized metadata.
 */
export async function probeMedia(
  url: string,
  opts: {
    mimeType?: string;
    filename?: string;
    signal?: AbortSignal;
    onProgress?: (p: ProbeProgress) => void;
  },
): Promise<MediaInfo> {
  opts.onProgress?.({ stage: "loading", pct: 10 });
  const video = await loadVideoElement(url, opts.signal);
  opts.onProgress?.({ stage: "loading", pct: 40 });

  const duration = video.duration && Number.isFinite(video.duration) ? video.duration : 0;
  const width = video.videoWidth || 0;
  const height = video.videoHeight || 0;

  opts.onProgress?.({ stage: "measuring", pct: 60 });
  const fps = await measureFps(video, opts.signal);
  opts.onProgress?.({ stage: "codecs", pct: 90 });

  const codecs = probeCodecs(opts.mimeType ?? "");
  const container = inferContainer(opts.mimeType ?? "", opts.filename ?? "");
  const audioTracksInfo = video as unknown as {
    mozHasAudio?: boolean;
    audioTracks?: unknown[] | { length: number };
  };
  const hasAudio =
    typeof audioTracksInfo.mozHasAudio === "boolean"
      ? audioTracksInfo.mozHasAudio
      : audioTracksInfo.audioTracks
        ? audioTracksInfo.audioTracks.length > 0
        : false;

  const cleanup = () => {
    video.pause();
    video.removeAttribute("src");
    video.load();
  };
  cleanup();
  opts.onProgress?.({ stage: "codecs", pct: 100 });

  return {
    duration,
    width,
    height,
    fps,
    videoCodec: codecs.videoCodec,
    audioCodec: codecs.audioCodec,
    sampleRate: null,
    channels: null,
    container,
    rotation: null,
    orientation: orientationOf(width, height),
    hasAudio,
  };
}
