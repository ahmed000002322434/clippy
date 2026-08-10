/**
 * Uploads a file to Convex storage with real progress, cancellation and retry.
 * Each attempt uses a fresh single-use upload URL (Convex storage uploads are
 * resumable by re-PUTting ranges on the same URL; we keep it simple and retry
 * the whole body on failure, which is safe for our sizes).
 */

export interface UploadCallbacks {
  onProgress: (pct: number) => void;
  signal?: AbortSignal;
}

export async function uploadToStorage(
  file: File,
  getUploadUrl: () => Promise<string>,
  callbacks: UploadCallbacks,
  maxAttempts = 3,
): Promise<{ storageId: string }> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (callbacks.signal?.aborted) {
      throw new DOMException("Upload cancelled", "AbortError");
    }
    try {
      const uploadUrl = await getUploadUrl();
      const storageId = await putWithProgress(file, uploadUrl, callbacks);
      return { storageId };
    } catch (err) {
      lastError = err;
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      if (attempt < maxAttempts) {
        // small backoff before retrying
        await new Promise((r) => setTimeout(r, 600 * attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Upload failed");
}

function putWithProgress(
  file: File,
  uploadUrl: string,
  callbacks: UploadCallbacks,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.responseType = "json";

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        callbacks.onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const storageId = xhr.response?.storageId;
        if (storageId) {
          callbacks.onProgress(100);
          resolve(storageId as string);
        } else {
          reject(new Error("Upload response missing storageId"));
        }
      } else {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));

    callbacks.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

/** Validate an upload candidate before accepting it. */
export interface UploadValidation {
  ok: boolean;
  error?: string;
}

const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

export function validateVideoFile(file: File): UploadValidation {
  const videoTypes = [
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "video/x-matroska",
    "video/ogg",
    "video/mpeg",
    "video/avi",
    "video/x-msvideo",
  ];
  const looksLikeVideo =
    videoTypes.includes(file.type) ||
    /\.(mp4|mov|webm|mkv|m4v|avi|ogv|mpg|mpeg)$/i.test(file.name);

  if (!looksLikeVideo) {
    return { ok: false, error: `${file.name} doesn't look like a video file.` };
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return { ok: false, error: `${file.name} is over the 2GB limit.` };
  }
  if (file.size === 0) {
    return { ok: false, error: `${file.name} is empty.` };
  }
  return { ok: true };
}
