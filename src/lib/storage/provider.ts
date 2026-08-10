/**
 * STORAGE PROVIDER ABSTRACTION
 * ----------------------------
 * The application coordinates uploads through a StorageProvider instead of
 * talking to a vendor directly. Today the only implementation is Convex
 * storage (this deployment's object store). The interface mirrors what an
 * S3-compatible provider (AWS S3, Cloudflare R2, Supabase Storage…) needs,
 * so a new provider is a drop-in: implement the interface, set
 * `VITE_STORAGE_PROVIDER`, done.
 *
 * Convex storage notes (verified against current behavior):
 *  - Uploads are a single PUT of the whole object to a signed, single-use
 *    URL — byte-level resume (Content-Range) is NOT supported. Retries get a
 *    fresh signed URL for the same persistent session.
 *  - URLs are unguessable bearer links; access control is enforced by only
 *    ever resolving URLs for objects the signed-in user owns.
 *  - Objects are deleted via `ctx.storage.delete(id)`.
 */

export interface UploadSessionHandle {
  /** Server-side session id persisted across refreshes. */
  sessionId: string;
  /** Signed, single-use URL the browser PUTs the file body to. */
  uploadUrl: string;
}

export interface UploadProgress {
  /** True byte count transferred so far. */
  bytesUploaded: number;
  bytesTotal: number;
  /** Instantaneous speed in bytes/second (rolling window). */
  speedBps: number;
  /** Estimated milliseconds remaining (from speed), null when unknown. */
  etaMs: number | null;
}

export interface StorageProvider {
  readonly name: string;
  /**
   * Create a persistent upload session (validated + rate-limited
   * server-side) and get a signed upload URL. Direct-to-storage: the
   * backend coordinates, the browser streams bytes straight to object
   * storage.
   */
  createUploadSession(opts: {
    projectId: string;
    filename: string;
    mimeType: string;
    size: number;
  }): Promise<UploadSessionHandle>;

  /** Mark a session as actively uploading (first attempt). */
  markUploading(sessionId: string): Promise<void>;

  /**
   * Get a fresh signed upload URL for an existing session — used when a
   * transfer attempt failed and must be retried.
   */
  getFreshUploadUrl(sessionId: string): Promise<string>;

  /**
   * Transfer the full file body to the signed URL with real progress.
   * Resolves with the provider's storage object id. Throws on failure;
   * caller decides whether to retry.
   */
  putFile(
    file: Blob,
    uploadUrl: string,
    callbacks: { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal },
  ): Promise<string>;

  /** Report real uploaded-byte progress to the backend session. */
  reportProgress(sessionId: string, uploadedBytes: number): Promise<void>;

  /** Persist the completed object + media early-metadata, mark complete. */
  completeUpload(opts: {
    sessionId: string;
    storageId: string;
    durationMs?: number;
    width?: number;
    height?: number;
    thumbnail?: string;
  }): Promise<{ videoId: string; alreadyCompleted: boolean }>;

  failSession(sessionId: string, error: string): Promise<void>;
  cancelSession(sessionId: string): Promise<void>;
}

export type ErrorClass = "retryable" | "permanent" | "user-action";

/** Upload failures carry an error class so the UI can retry appropriately. */
export class UploadError extends Error {
  errorClass: ErrorClass;
  retryable: boolean;
  constructor(message: string, errorClass: ErrorClass = "retryable") {
    super(message);
    this.errorClass = errorClass;
    this.retryable = errorClass === "retryable";
  }
}
