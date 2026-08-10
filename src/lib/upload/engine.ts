import type { StorageProvider, UploadProgress } from "@/lib/storage/provider";
import { UploadError } from "@/lib/storage/provider";

export type UploadPhase =
  | "validating"
  | "creating-session"
  | "uploading"
  | "finalizing"
  | "done"
  | "error"
  | "cancelled";

export interface UploadTask {
  id: string;
  sessionId: string | null;
  file: File;
  phase: UploadPhase;
  /** Real byte progress from XHR. */
  bytesUploaded: number;
  bytesTotal: number;
  speedBps: number;
  etaMs: number | null;
  /** % across all phases (session create 0–4, transfer 5–92, finalize 93–100). */
  pct: number;
  attempts: number;
  error: string | null;
  errorClass: "retryable" | "permanent" | "user-action" | null;
  videoId?: string;
  controller: AbortController;
  createdAt: number;
}

export interface UploadEngineCallbacks {
  onUpdate?: (tasks: UploadTask[]) => void;
  onCompleted?: (task: UploadTask, videoId: string) => void;
}

const MAX_ATTEMPTS = 3;

function taskPct(task: Pick<UploadTask, "phase" | "bytesUploaded" | "bytesTotal">): number {
  switch (task.phase) {
    case "validating":
    case "creating-session":
      return 3;
    case "uploading": {
      const transfer =
        task.bytesTotal > 0 ? (task.bytesUploaded / task.bytesTotal) * 100 : 0;
      return 5 + Math.round(transfer * 0.87);
    }
    case "finalizing":
      return 93;
    case "done":
      return 100;
    default:
      return 0;
  }
}

/**
 * Upload engine: owns per-file lifecycle (session → transfer → finalize),
 * real progress, retries with backoff, cancellation, and multi-file
 * orchestration. Sessions persist server-side, so a refresh can recover and
 * re-attach the same file later.
 */
export class UploadEngine {
  private tasks = new Map<string, UploadTask>();
  private callbacks: UploadEngineCallbacks;
  private provider: StorageProvider;
  /** Project this engine uploads into (recreate the engine when it changes). */
  readonly projectId: string;

  constructor(
    provider: StorageProvider,
    projectId: string,
    callbacks?: UploadEngineCallbacks,
  ) {
    this.provider = provider;
    this.projectId = projectId;
    this.callbacks = callbacks ?? {};
  }

  private emit() {
    this.callbacks.onUpdate?.(Array.from(this.tasks.values()));
  }

  private patch(id: string, patch: Partial<UploadTask>) {
    const task = this.tasks.get(id);
    if (!task) return;
    Object.assign(task, patch);
    task.pct = taskPct(task);
    this.emit();
  }

  getTasks(): UploadTask[] {
    return Array.from(this.tasks.values());
  }

  get activeCount(): number {
    return Array.from(this.tasks.values()).filter(
      (t) => t.phase !== "done" && t.phase !== "error" && t.phase !== "cancelled",
    ).length;
  }

  /**
   * Add a file. If a previous session for the same file exists in a
   * recoverable state (created/uploading/failed), pass it in to re-attach
   * rather than creating a fresh one — recovery after a refresh.
   *
   * `preferredId` is used when re-attaching an upload restored from
   * IndexedDB so the persisted record key (and preview URL) stays stable
   * across refreshes.
   */
  addFile(file: File, existingSessionId?: string | null, preferredId?: string) {
    const id =
      preferredId ??
      `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const task: UploadTask = {
      id,
      sessionId: existingSessionId ?? null,
      file,
      phase: "validating",
      bytesUploaded: 0,
      bytesTotal: file.size,
      speedBps: 0,
      etaMs: null,
      pct: 0,
      attempts: 0,
      error: null,
      errorClass: null,
      controller: new AbortController(),
      createdAt: Date.now(),
    };
    this.tasks.set(id, task);
    this.emit();
    void this.run(id);
    return id;
  }

  private async run(id: string) {
    const task = this.tasks.get(id);
    if (!task) return;
    const signal = task.controller.signal;

    try {
      // 1. Session (create or reuse)
      this.patch(id, { phase: "creating-session", error: null, errorClass: null });
      let sessionId = task.sessionId;
      let uploadUrl: string | null = null;
      if (!sessionId) {
        const session = await this.provider.createUploadSession({
          projectId: this.projectId,
          filename: task.file.name,
          mimeType: task.file.type || "video/mp4",
          size: task.file.size,
        });
        sessionId = session.sessionId;
        uploadUrl = session.uploadUrl;
        task.sessionId = sessionId;
      }
      await this.provider.markUploading(sessionId);

      // 2. Transfer with retry + backoff
      this.patch(id, { phase: "uploading", attempts: task.attempts + 1 });
      const storageId = await this.transferWithRetry(task, sessionId, uploadUrl, signal);

      // 3. Finalize (verify + persist + queue ingestion job)
      this.patch(id, { phase: "finalizing" });
      const complete = await this.provider.completeUpload({
        sessionId,
        storageId,
      });
      task.videoId = complete.videoId;

      this.patch(id, { phase: "done" });
      this.callbacks.onCompleted?.(task, complete.videoId);
    } catch (err) {
      const aborted =
        err instanceof DOMException && err.name === "AbortError";
      if (aborted) {
        this.patch(id, {
          phase: "cancelled",
          error: "Cancelled",
          errorClass: "user-action",
        });
        if (task.sessionId) {
          void this.provider.cancelSession(task.sessionId).catch(() => undefined);
        }
      } else {
        const uploadError =
          err instanceof UploadError
            ? err
            : new UploadError(err instanceof Error ? err.message : "Upload failed");
        this.patch(id, {
          phase: "error",
          error: uploadError.message,
          errorClass: uploadError.errorClass,
        });
        if (task.sessionId) {
          void this.provider
            .failSession(task.sessionId, uploadError.message)
            .catch(() => undefined);
        }
      }
    } finally {
      this.emit();
    }
  }

  private async transferWithRetry(
    task: UploadTask,
    sessionId: string,
    firstUrl: string | null,
    signal: AbortSignal,
  ): Promise<string> {
    let attempt = task.attempts;
    let lastError: Error | null = null;

    while (attempt <= MAX_ATTEMPTS) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        // First attempt uses the URL from session creation; retries get a
        // fresh signed URL for the same session.
        const uploadUrl =
          attempt === 1 && firstUrl
            ? firstUrl
            : await this.provider.getFreshUploadUrl(sessionId);
        const onProgress = (p: UploadProgress) => {
          this.patch(task.id, {
            bytesUploaded: p.bytesUploaded,
            speedBps: p.speedBps,
            etaMs: p.etaMs,
          });
          if (p.bytesUploaded > 0 && p.bytesUploaded % (4 * 1024 * 1024) < 1024) {
            void this.provider.reportProgress(sessionId, p.bytesUploaded).catch(() => undefined);
          }
        };
        return await this.provider.putFile(task.file, uploadUrl, { onProgress, signal });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        lastError = err instanceof Error ? err : new Error("Upload failed");
        const retryable = err instanceof UploadError ? err.retryable : true;
        if (!retryable || attempt >= MAX_ATTEMPTS) throw lastError;
        attempt++;
        this.patch(task.id, { attempts: attempt });
        // Exponential backoff before retrying.
        await new Promise((r) => setTimeout(r, 800 * 2 ** (attempt - 2)));
      }
    }
    throw lastError ?? new Error("Upload failed");
  }

  cancel(id: string) {
    const task = this.tasks.get(id);
    task?.controller.abort();
  }

  retry(id: string) {
    const task = this.tasks.get(id);
    if (!task || (task.phase !== "error" && task.phase !== "cancelled")) return;
    task.controller = new AbortController();
    task.phase = "validating";
    task.bytesUploaded = 0;
    task.speedBps = 0;
    task.etaMs = null;
    task.error = null;
    task.errorClass = null;
    task.attempts = 0;
    task.sessionId = null;
    this.emit();
    void this.run(id);
  }

  remove(id: string) {
    this.tasks.delete(id);
    this.emit();
  }

  dispose() {
    for (const t of this.tasks.values()) t.controller.abort();
    this.tasks.clear();
  }
}
