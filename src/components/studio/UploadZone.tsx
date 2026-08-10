import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useRef, useState } from "react";
import { UploadEngine } from "@/lib/upload/engine";
import type { UploadTask } from "@/lib/upload/engine";
import { createStorageProvider } from "@/lib/storage/convex";
import type { ConvexUploadMutations } from "@/lib/storage/convex";
import { validateVideoFileClient } from "@/lib/upload/validate";
import { analyzeVideoFile } from "@/lib/video/analyze";
import { formatBytes, formatEta, formatSpeed } from "@/lib/video/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  FileVideo,
  HardDrive,
  Link2,
  Loader2,
  RefreshCcw,
  UploadCloud,
  XCircle,
  X,
  Youtube,
} from "lucide-react";

const PROVIDERS = [
  {
    id: "url",
    label: "Direct link",
    icon: Link2,
    enabled: true,
    hint: "Paste a direct link to a video file (MP4, MOV, WebM, MKV).",
  },
  {
    id: "youtube",
    label: "YouTube",
    icon: Youtube,
    enabled: false,
    hint: "Coming soon — needs the YouTube API adapter (no scraping).",
  },
  {
    id: "drive",
    label: "Google Drive",
    icon: HardDrive,
    enabled: false,
    hint: "Coming soon — needs Google Drive API + OAuth.",
  },
  {
    id: "dropbox",
    label: "Dropbox",
    icon: Cloud,
    enabled: false,
    hint: "Coming soon — needs the Dropbox API + OAuth.",
  },
];

/** Sessions that can be resumed after a refresh (created/uploading/failed). */
function isRecoverable(s: {
  status: string;
  videoId?: string;
  uploadedBytes: number;
  size: number;
}): boolean {
  return (
    !s.videoId &&
    (s.status === "created" || s.status === "uploading" || s.status === "failed")
  );
}

function phaseLabel(task: UploadTask): string {
  switch (task.phase) {
    case "validating":
      return "Checking file…";
    case "creating-session":
      return "Starting upload…";
    case "uploading":
      return `${formatBytes(task.bytesUploaded)} / ${formatBytes(task.bytesTotal)} · ${formatSpeed(task.speedBps)}${
        formatEta(task.etaMs) ? ` · ${formatEta(task.etaMs)} left` : ""
      }`;
    case "finalizing":
      return "Saving…";
    case "done":
      return "Uploaded — processing starts automatically";
    case "cancelled":
      return "Cancelled";
    case "error":
      return task.error ?? "Upload failed";
  }
}

export function UploadZone({
  projectId,
  onUploaded,
}: {
  projectId: Id<"projects">;
  onUploaded?: (videoId: Id<"videos">) => void;
}) {
  const createUploadSession = useMutation(api.uploads.createUploadSession);
  const markUploading = useMutation(api.uploads.markUploading);
  const getFreshUploadUrl = useMutation(api.uploads.getFreshUploadUrl);
  const updateUploadProgress = useMutation(api.uploads.updateUploadProgress);
  const completeUploadSession = useMutation(api.uploads.completeUploadSession);
  const failUploadSession = useMutation(api.uploads.failUploadSession);
  const cancelUploadSession = useMutation(api.uploads.cancelUploadSession);
  const updateVideo = useMutation(api.videos.updateVideo);
  const importFromUrl = useAction(api.imports.importFromUrl);

  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [rejected, setRejected] = useState<{ id: string; name: string; error: string }[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resumeInputRef = useRef<HTMLInputElement>(null);
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;

  const sessions = useQuery(api.uploads.listUploadSessions, { projectId });
  const recoverable = (sessions ?? []).filter(isRecoverable);

  // Build the provider once per render; the engine follows it.
  const mutations: ConvexUploadMutations = {
    createUploadSession: (a) => createUploadSession(a),
    markUploading: (a) => markUploading(a),
    getFreshUploadUrl: (a) => getFreshUploadUrl(a),
    updateUploadProgress: (a) => updateUploadProgress(a),
    completeUploadSession: (a) => completeUploadSession(a),
    failUploadSession: (a) => failUploadSession(a),
    cancelUploadSession: (a) => cancelUploadSession(a),
  };
  const provider = createStorageProvider(mutations);

  const engineRef = useRef<UploadEngine | null>(null);
  if (!engineRef.current || engineRef.current.projectId !== projectId) {
    engineRef.current?.dispose();
    const engine = new UploadEngine(provider, projectId, {
      onUpdate: (ts) => setTasks([...ts]),
      onCompleted: (_task, videoId) =>
        onUploadedRef.current?.(videoId as Id<"videos">),
    });
    engineRef.current = engine;
  }

  const addFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    const rejectedBatch: typeof rejected = [];
    for (const file of list) {
      const validation = validateVideoFileClient(file);
      if (!validation.ok) {
        rejectedBatch.push({
          id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: file.name,
          error: validation.error ?? "Unsupported file",
        });
        continue;
      }
      // Session recovery: if a recoverable session matches this filename,
      // resume that session instead of creating a fresh one.
      const match = recoverable.find(
        (s) => s.filename.toLowerCase() === file.name.toLowerCase(),
      );
      engineRef.current?.addFile(file, match?._id ?? null);
    }
    if (rejectedBatch.length) setRejected((prev) => [...prev, ...rejectedBatch]);
  };

  const resumeTargetRef = useRef<string | null>(null);
  const resumeFor = (sessionId: string) => {
    // Re-pick the file; the picker matches it against the recoverable session
    // so the upload continues on the same session (statuses preserved).
    resumeTargetRef.current = sessionId;
    resumeInputRef.current?.click();
  };

  // import-from-URL state
  const [importOpen, setImportOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importStage, setImportStage] = useState<"download" | "analyze" | "done">("download");
  const [importPct, setImportPct] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);
  const importAbortRef = useRef<AbortController | null>(null);

  const runImport = async () => {
    const url = importUrl.trim();
    if (!url || importing) return;
    const controller = new AbortController();
    importAbortRef.current = controller;
    setImporting(true);
    setImportError(null);
    setImportPct(0);
    setImportStage("download");
    try {
      const { videoId, url: videoUrl } = await importFromUrl({ projectId, url });
      if (!videoUrl) throw new Error("Imported file could not be served back.");

      // Re-download from storage and run the same browser analysis pipeline so
      // imported videos unlock clip discovery, the waveform and smart reframing.
      setImportStage("analyze");
      setImportPct(5);
      const res = await fetch(videoUrl, { signal: controller.signal });
      if (!res.ok) throw new Error(`Could not fetch imported video (${res.status}).`);
      const blob = await res.blob();
      const file = new File([blob], "imported-video", {
        type: blob.type || "video/mp4",
      });
      try {
        const { signals, meta } = await analyzeVideoFile(
          file,
          (p) => {
            setImportPct(
              p.stage === "reading"
                ? Math.round(5 + p.pct * 0.3)
                : p.stage === "audio"
                  ? Math.round(35 + p.pct * 0.3)
                  : Math.round(65 + p.pct * 0.35),
            );
          },
          controller.signal,
        );
        await updateVideo({
          videoId,
          signals,
          analyzedAt: Date.now(),
          status: "analyzed",
          durationMs: meta.durationMs,
          width: meta.width,
          height: meta.height,
          thumbnail: meta.thumbnail,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        // Analysis failed — video is imported but without signals
      }
      setImportPct(100);
      setImportStage("done");
      setImportOpen(false);
      setImportUrl("");
      onUploaded?.(videoId);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setImportError("Cancelled");
      } else {
        setImportError(err instanceof Error ? err.message : "Import failed");
      }
    } finally {
      setImporting(false);
      importAbortRef.current = null;
    }
  };

  const activeTasks = tasks.filter(
    (t) => t.phase !== "done" && t.phase !== "error" && t.phase !== "cancelled",
  );
  const totalBytes = tasks.reduce((a, t) => a + t.bytesTotal, 0);
  const uploadedBytes = tasks.reduce((a, t) => a + t.bytesUploaded, 0);
  const overallPct =
    totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 0;

  return (
    <div className="flex flex-col gap-3">
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "clay-inset flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed px-6 py-10 text-center transition-all cursor-pointer",
          dragging && "scale-[1.01] border-primary/50",
        )}
      >
        <div className="clay clay-peach flex size-14 items-center justify-center rounded-full">
          <UploadCloud className="size-7" />
        </div>
        <p className="font-semibold">
          Drop a long-form video here, or <span className="text-primary underline underline-offset-2">browse</span>
        </p>
        <p className="text-xs text-muted-foreground">
          MP4 · MOV · WebM — up to 2GB. Uploads stream straight to storage; real progress, pause &amp; resume.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={resumeInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            const sessionId = resumeTargetRef.current;
            resumeTargetRef.current = null;
            if (!file || !sessionId) return;
            const session = recoverable.find((s) => s._id === sessionId);
            if (!session) return;
            if (session.filename.toLowerCase() !== file.name.toLowerCase()) {
              setRejected((prev) => [
                ...prev,
                {
                  id: `r-${Date.now()}`,
                  name: file.name,
                  error: "Pick the same file to resume — or drop it again to start fresh.",
                },
              ]);
              return;
            }
            engineRef.current?.addFile(file, sessionId);
          }}
        />
      </div>

      {/* interrupted-session recovery */}
      {recoverable.length > 0 && (
        <div className="clay flex flex-col gap-2 p-3">
          <p className="flex items-center gap-1.5 text-xs font-bold text-amber-600 dark:text-amber-300">
            <AlertTriangle className="size-3.5" />
            {recoverable.length} upload{recoverable.length > 1 ? "s were" : " was"} interrupted
          </p>
          {recoverable.map((s) => (
            <div
              key={s._id}
              className="clay-inset flex items-center gap-2 rounded-xl px-3 py-2"
            >
              <FileVideo className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{s.filename}</p>
                <p className="text-[10px] text-muted-foreground">
                  {formatBytes(s.uploadedBytes)} / {formatBytes(s.size)} transferred
                  {s.status === "failed" && " · failed, retryable"}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                className="clay-press shrink-0"
                onClick={() => resumeFor(s._id)}
              >
                <RefreshCcw className="size-3.5" />
                Resume
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* import from URL */}
      {importOpen ? (
        <div className="clay flex flex-col gap-3 p-4">
          <div className="flex flex-wrap gap-1.5">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  if (!p.enabled) return;
                  setImportUrl("");
                  setImportError(null);
                }}
                className={cn(
                  "clay-press clay-chip flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all",
                  p.enabled
                    ? "bg-background hover:bg-accent"
                    : "cursor-not-allowed opacity-45",
                )}
                title={p.hint}
                disabled={p.enabled === false}
              >
                <p.icon className="size-3.5" />
                {p.label}
                {!p.enabled && (
                  <span className="rounded-full bg-accent/60 px-1.5 py-0.5 text-[9px] font-bold uppercase text-muted-foreground">
                    soon
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Link2 className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                placeholder="https://…/video.mp4"
                className="clay-inset border-0 pl-9"
                disabled={importing}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runImport();
                }}
                autoFocus
              />
            </div>
            <Button
              className="clay-press gap-1.5"
              disabled={importing || !importUrl.trim()}
              onClick={() => void runImport()}
            >
              {importing ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
              Import
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                if (importing) importAbortRef.current?.abort();
                else setImportOpen(false);
              }}
              title={importing ? "Cancel import" : "Close"}
            >
              <X className="size-4" />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Paste a direct link to a video file. YouTube, Drive and Dropbox are
            staged behind official API adapters — no scraping.
          </p>
          {importing && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[11px] font-semibold">
                <span>
                  {importStage === "download"
                    ? "Importing file…"
                    : importStage === "analyze"
                      ? "Analyzing audio & scenes…"
                      : "Done"}
                </span>
                <span className="tabular-nums">{importPct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-200"
                  style={{ width: `${importPct}%` }}
                />
              </div>
            </div>
          )}
          {importError && (
            <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
              {importError}
            </p>
          )}
        </div>
      ) : (
        <button
          onClick={() => setImportOpen(true)}
          className="clay-press flex items-center justify-center gap-2 rounded-2xl border border-dashed py-2.5 text-xs font-semibold text-muted-foreground transition-all hover:text-foreground"
        >
          <Link2 className="size-3.5" />
          Import from a link instead
        </button>
      )}

      {/* rejected files */}
      {rejected.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {rejected.map((r) => (
            <div
              key={r.id}
              className="clay flex items-center gap-2 rounded-xl px-3 py-2 text-xs"
            >
              <XCircle className="size-4 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.name}</p>
                <p className="text-destructive">{r.error}</p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setRejected((prev) => prev.filter((x) => x.id !== r.id))}
                title="Dismiss"
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* upload tasks */}
      {tasks.length > 0 && (
        <div className="flex flex-col gap-2">
          {tasks.map((task) => (
            <div key={task.id} className="clay flex items-center gap-3 px-4 py-3">
              <div className="clay-inset flex size-10 shrink-0 items-center justify-center rounded-xl">
                {task.phase === "done" ? (
                  <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-300" />
                ) : task.phase === "error" ? (
                  <XCircle className="size-5 text-destructive" />
                ) : task.phase === "cancelled" ? (
                  <XCircle className="size-5 text-muted-foreground" />
                ) : (
                  <FileVideo className="size-5 text-primary" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{task.file.name}</p>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatBytes(task.file.size)}
                  </span>
                </div>
                {task.phase === "error" || task.phase === "cancelled" ? (
                  <p className="mt-1 text-xs text-destructive">
                    {task.error}
                    {task.errorClass === "retryable" && " — you can retry."}
                    {task.errorClass === "user-action" &&
                      task.phase === "cancelled" &&
                      " You can resume from the interrupted-uploads list."}
                  </p>
                ) : task.phase === "done" ? (
                  <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-300">
                    {phaseLabel(task)}
                  </p>
                ) : (
                  <>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-200",
                          task.phase === "finalizing"
                            ? "bg-emerald-500"
                            : "bg-primary",
                        )}
                        style={{ width: `${task.pct}%` }}
                      />
                    </div>
                    <p className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span className="truncate">{phaseLabel(task)}</span>
                      <span className="shrink-0 tabular-nums">{task.pct}%</span>
                    </p>
                  </>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {task.phase === "error" && task.errorClass !== "user-action" && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => engineRef.current?.retry(task.id)}
                    title="Retry upload"
                  >
                    <RefreshCcw className="size-4" />
                  </Button>
                )}
                {task.phase === "error" && task.errorClass === "user-action" && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => engineRef.current?.remove(task.id)}
                    title="Dismiss"
                  >
                    <X className="size-4" />
                  </Button>
                )}
                {(task.phase === "validating" ||
                  task.phase === "creating-session" ||
                  task.phase === "uploading" ||
                  task.phase === "finalizing") && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => engineRef.current?.cancel(task.id)}
                    title="Cancel upload"
                  >
                    <X className="size-4" />
                  </Button>
                )}
                {task.phase === "cancelled" && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => engineRef.current?.retry(task.id)}
                    title="Try again"
                  >
                    <RefreshCcw className="size-4" />
                  </Button>
                )}
                {task.phase === "done" && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => engineRef.current?.remove(task.id)}
                    title="Dismiss"
                  >
                    <X className="size-4" />
                  </Button>
                )}
                {task.phase === "finalizing" && (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* aggregate progress */}
      {activeTasks.length > 0 && (
        <div className="clay-inset flex flex-col gap-1.5 rounded-2xl p-3">
          <div className="flex items-center justify-between text-[11px] font-semibold">
            <span>
              {activeTasks.length} upload{activeTasks.length > 1 ? "s" : ""} in progress
            </span>
            <span className="tabular-nums">
              {formatBytes(uploadedBytes)} / {formatBytes(totalBytes)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
            <div
              className="h-full rounded-full bg-primary transition-all duration-200"
              style={{ width: `${overallPct}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground">{overallPct}% overall</p>
        </div>
      )}
    </div>
  );
}
