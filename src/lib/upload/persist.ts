/**
 * INDEXEDDB UPLOAD PERSISTENCE
 * ----------------------------
 * In-flight uploads are remembered across page closes. The server keeps the
 * upload session (src/convex/uploads.ts) so progress/state survive a refresh,
 * and this module keeps the local file blob so the transfer can be resumed
 * automatically on the next visit without re-picking the file.
 *
 * Two stores: `meta` (cheap, updated on every progress tick) and `files`
 * (the Blob, written once per upload so big files are never re-serialized on
 * every progress update). Storage quota failures degrade gracefully — the
 * interrupted-session list remains as a manual fallback.
 */

export interface PendingUploadMeta {
  /** Client task id (also used as the IDB record key). */
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  sessionId: string | null;
  startedAt: number;
  lastPct: number;
}

export interface PendingUpload {
  meta: PendingUploadMeta;
  blob: Blob;
}

const DB_NAME = "clippy-uploads";
const DB_VERSION = 1;
const META_STORE = "meta";
const FILE_STORE = "files";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
      if (!db.objectStoreNames.contains(FILE_STORE)) {
        db.createObjectStore(FILE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error("Failed to open upload store"));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function requestDone(
  req: IDBRequest,
  t: IDBTransaction,
): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error("indexeddb error"));
    req.onerror = () =>
      reject(req.error ?? new Error("indexeddb request error"));
  });
}

export async function savePendingMeta(meta: PendingUploadMeta): Promise<void> {
  try {
    const db = await openDb();
    const t = db.transaction(META_STORE, "readwrite");
    const req = t.objectStore(META_STORE).put(meta, meta.id);
    await requestDone(req, t);
  } catch {
    // best-effort — persistence is a nicety, never blocks the upload
  }
}

export async function savePendingFile(id: string, blob: Blob): Promise<void> {
  try {
    const db = await openDb();
    const t = db.transaction(FILE_STORE, "readwrite");
    const req = t.objectStore(FILE_STORE).put(blob, id);
    await requestDone(req, t);
  } catch {
    // best-effort (quota / privacy mode) — manual resume still works
  }
}

async function getAllFrom(store: string): Promise<unknown[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readonly");
    const req = t.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as unknown[]);
    req.onerror = () => reject(req.error);
  });
}

async function getAllFilesWithKeys(): Promise<Map<string, Blob>> {
  const db = await openDb();
  const map = new Map<string, Blob>();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(FILE_STORE, "readonly");
    const req = t.objectStore(FILE_STORE).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        map.set(String(cursor.key), cursor.value as Blob);
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error);
  });
  return map;
}

/** Every persisted upload that still has its file blob. */
export async function listPendingUploads(): Promise<PendingUpload[]> {
  const metas = (await getAllFrom(META_STORE)) as PendingUploadMeta[];
  const files = await getAllFilesWithKeys();
  return metas
    .filter((m) => m && typeof m.id === "string" && files.has(m.id))
    .map((m) => ({ meta: m, blob: files.get(m.id)! }));
}

/** Drop both the metadata and the stored blob for an upload. */
export async function removePendingUpload(id: string): Promise<void> {
  try {
    const db = await openDb();
    const t = db.transaction([META_STORE, FILE_STORE], "readwrite");
    t.objectStore(META_STORE).delete(id);
    t.objectStore(FILE_STORE).delete(id);
    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  } catch {
    // best-effort
  }
}

/** Rebuild a File from a persisted blob + metadata. */
export function pendingUploadToFile(upload: PendingUpload): File {
  return new File([upload.blob], upload.meta.filename, {
    type: upload.meta.mimeType || "video/mp4",
  });
}
