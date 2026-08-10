/**
 * PURE UPLOAD VALIDATION
 * ----------------------
 * Shared by the Convex backend (authoritative) and unit tests. Never trusts
 * the browser-supplied filename, MIME type or size. No DOM, no Convex, no
 * Node — pure functions only.
 */

export type UploadErrorClass = "retryable" | "permanent" | "user-action";

export const ALLOWED_VIDEO_EXTENSIONS = new Set([
  "mp4",
  "mov",
  "webm",
  "mkv",
  "m4v",
  "avi",
  "mpg",
  "mpeg",
  "ogv",
  "3gp",
]);

const ALLOWED_MIME_PREFIXES = ["video/", "application/octet-stream"];

export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024; // 2GB
export const MAX_NAME_LENGTH = 120;

export interface ValidationResult {
  ok: boolean;
  error?: string;
  errorClass?: UploadErrorClass;
}

/**
 * Sanitize + validate a user-supplied filename into a safe display name.
 * Rejects path traversal, control characters, dotfiles and unknown
 * extensions. Never used as a storage path — display only.
 */
export function sanitizeFilename(raw: string): ValidationResult & { name?: string } {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, error: "No filename provided.", errorClass: "user-action" };
  }
  // Strip anything resembling a path — only the final component is used.
  const leaf = raw.split(/[\\/]/).pop() ?? "";
  if (leaf !== raw) {
    return { ok: false, error: "Filename may not contain paths.", errorClass: "user-action" };
  }
  if (leaf.includes("\0") || /[\u0000-\u001f\u007f]/.test(leaf)) {
    return { ok: false, error: "Filename contains invalid characters.", errorClass: "user-action" };
  }
  if (leaf.startsWith(".")) {
    return { ok: false, error: "Filename may not start with a dot.", errorClass: "user-action" };
  }
  const trimmed = leaf.trim();
  if (trimmed.length > MAX_NAME_LENGTH) {
    return { ok: false, error: "Filename is too long.", errorClass: "user-action" };
  }
  const ext = trimmed.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_VIDEO_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      error: `Unsupported file type (.${ext}). Supported: ${[...ALLOWED_VIDEO_EXTENSIONS].join(", ")}.`,
      errorClass: "user-action",
    };
  }
  return { ok: true, name: trimmed };
}

/** Validate MIME type + declared size + filename of an upload candidate. */
export function validateUpload(
  filename: string,
  mimeType: string,
  size: number,
): ValidationResult {
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: "File size must be positive.", errorClass: "user-action" };
  }
  if (size > MAX_FILE_BYTES) {
    return { ok: false, error: "File is over the 2GB limit.", errorClass: "user-action" };
  }
  const mime = (mimeType ?? "").toLowerCase();
  const mimeOk = ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p));
  if (!mimeOk) {
    return { ok: false, error: "File is not a recognized video type.", errorClass: "user-action" };
  }
  const nameOk = sanitizeFilename(filename);
  if (!nameOk.ok) return nameOk;
  return { ok: true };
}

/**
 * Client-side pre-check mirroring the backend rules, so invalid files fail
 * fast before an upload session is created. Backend validation remains
 * authoritative.
 */
export function validateVideoFileClient(file: { name: string; type: string; size: number }): ValidationResult {
  const res = validateUpload(file.name, file.type, file.size);
  return res;
}
