import type { Id } from "@/convex/_generated/dataModel";
import type { StorageProvider, UploadProgress } from "./provider";
import { UploadError } from "./provider";

/** Mutations the Convex provider binds to (bound from useMutation hooks). */
export type ConvexUploadMutations = {
  createUploadSession: (args: {
    projectId: Id<"projects">;
    filename: string;
    mimeType: string;
    size: number;
  }) => Promise<{ sessionId: Id<"uploadSessions">; uploadUrl: string }>;
  markUploading: (args: { sessionId: Id<"uploadSessions"> }) => Promise<unknown>;
  getFreshUploadUrl: (args: { sessionId: Id<"uploadSessions"> }) => Promise<string>;
  updateUploadProgress: (args: {
    sessionId: Id<"uploadSessions">;
    uploadedBytes: number;
  }) => Promise<unknown>;
  completeUploadSession: (args: {
    sessionId: Id<"uploadSessions">;
    storageId: Id<"_storage">;
    durationMs?: number;
    width?: number;
    height?: number;
    thumbnail?: string;
  }) => Promise<{ videoId: Id<"videos">; alreadyCompleted: boolean }>;
  failUploadSession: (args: {
    sessionId: Id<"uploadSessions">;
    error: string;
    errorClass?: "retryable" | "permanent" | "user-action";
  }) => Promise<unknown>;
  cancelUploadSession: (args: { sessionId: Id<"uploadSessions"> }) => Promise<unknown>;
};

/** Rolling speed window (keep ~2s of samples). */
function trackSpeed() {
  let samples: { t: number; bytes: number }[] = [];
  const push = (bytes: number, t: number): number => {
    samples.push({ t, bytes });
    const cutoff = t - 2000;
    samples = samples.filter((s) => s.t >= cutoff);
    if (samples.length >= 2) {
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dt = (last.t - first.t) / 1000;
      if (dt > 0) return Math.max(0, (last.bytes - first.bytes) / dt);
    }
    return 0;
  };
  return { push };
}

/**
 * Convex-backed storage provider. Uploads stream straight to Convex object
 * storage from the browser via a signed URL, with real XHR progress events.
 */
export class ConvexStorageProvider implements StorageProvider {
  readonly name = "convex";
  mutations: ConvexUploadMutations;

  constructor(mutations: ConvexUploadMutations) {
    this.mutations = mutations;
  }

  async createUploadSession(opts: {
    projectId: string;
    filename: string;
    mimeType: string;
    size: number;
  }): Promise<{ sessionId: string; uploadUrl: string }> {
    const res = await this.mutations.createUploadSession({
      projectId: opts.projectId as Id<"projects">,
      filename: opts.filename,
      mimeType: opts.mimeType,
      size: opts.size,
    });
    return { sessionId: res.sessionId, uploadUrl: res.uploadUrl };
  }

  async markUploading(sessionId: string): Promise<void> {
    await this.mutations.markUploading({
      sessionId: sessionId as Id<"uploadSessions">,
    });
  }

  async getFreshUploadUrl(sessionId: string): Promise<string> {
    return this.mutations.getFreshUploadUrl({
      sessionId: sessionId as Id<"uploadSessions">,
    });
  }

  putFile(
    file: Blob,
    uploadUrl: string,
    callbacks: { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal },
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.responseType = "json";

      const speed = trackSpeed();

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable || e.total <= 0) return;
        const now = performance.now();
        const speedBps = speed.push(e.loaded, now);
        const remaining = e.total - e.loaded;
        const etaMs = speedBps > 0 ? (remaining / speedBps) * 1000 : null;
        callbacks.onProgress?.({
          bytesUploaded: e.loaded,
          bytesTotal: e.total,
          speedBps,
          etaMs,
        });
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const storageId = (xhr.response as { storageId?: string } | null)?.storageId;
          if (!storageId) {
            reject(new UploadError("Upload response was missing the object id.", "retryable"));
            return;
          }
          callbacks.onProgress?.({
            bytesUploaded: file.size,
            bytesTotal: file.size,
            speedBps: 0,
            etaMs: null,
          });
          resolve(storageId);
        } else if (xhr.status === 403 || xhr.status === 401) {
          reject(new UploadError("The upload link expired — starting it again.", "retryable"));
        } else {
          reject(new UploadError(`Upload failed (${xhr.status}).`, "retryable"));
        }
      };
      xhr.onerror = () => reject(new UploadError("Network error during upload.", "retryable"));
      xhr.onabort = () => reject(new UploadError("Upload cancelled.", "user-action"));

      const onAbort = () => xhr.abort();
      callbacks.signal?.addEventListener("abort", onAbort, { once: true });
      xhr.send(file);
    });
  }

  async reportProgress(sessionId: string, uploadedBytes: number): Promise<void> {
    await this.mutations.updateUploadProgress({
      sessionId: sessionId as Id<"uploadSessions">,
      uploadedBytes,
    });
  }

  async completeUpload(opts: {
    sessionId: string;
    storageId: string;
    durationMs?: number;
    width?: number;
    height?: number;
    thumbnail?: string;
  }): Promise<{ videoId: string; alreadyCompleted: boolean }> {
    const res = await this.mutations.completeUploadSession({
      sessionId: opts.sessionId as Id<"uploadSessions">,
      storageId: opts.storageId as Id<"_storage">,
      durationMs: opts.durationMs,
      width: opts.width,
      height: opts.height,
      thumbnail: opts.thumbnail,
    });
    return { videoId: res.videoId, alreadyCompleted: res.alreadyCompleted };
  }

  async failSession(sessionId: string, error: string): Promise<void> {
    await this.mutations.failUploadSession({
      sessionId: sessionId as Id<"uploadSessions">,
      error,
    });
  }

  async cancelSession(sessionId: string): Promise<void> {
    await this.mutations.cancelUploadSession({
      sessionId: sessionId as Id<"uploadSessions">,
    });
  }
}

// ---------------------------------------------------------------------------
// Provider selection — env-driven, defaults to Convex (this deployment).
// ---------------------------------------------------------------------------

export function createStorageProvider(mutations: ConvexUploadMutations): StorageProvider {
  const provider =
    (import.meta.env.VITE_STORAGE_PROVIDER as string | undefined) ?? "convex";
  switch (provider) {
    case "convex":
    default:
      return new ConvexStorageProvider(mutations);
  }
}
