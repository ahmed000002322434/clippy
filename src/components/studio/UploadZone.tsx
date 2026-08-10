import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { analyzeVideoFile } from "@/lib/video/analyze";
import { uploadToStorage, validateVideoFile } from "@/lib/upload";
import { formatBytes } from "@/lib/video/format";
import { Button } from "@/components/ui/button";
import { useState, useRef } from "react";
import {
  CheckCircle2,
  FileVideo,
  Loader2,
  RefreshCcw,
  UploadCloud,
  XCircle,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Phase = "analyzing" | "uploading" | "creating" | "done" | "error";

interface Task {
  id: string;
  file: File;
  phase: Phase;
  analysisPct: number;
  uploadPct: number;
  error?: string;
  videoId?: Id<"videos">;
  controller: AbortController;
}

let taskCounter = 0;

export function UploadZone({
  projectId,
  onUploaded,
}: {
  projectId: Id<"projects">;
  onUploaded?: (videoId: Id<"videos">) => void;
}) {
  const generateUploadUrl = useMutation(api.videos.generateUploadUrl);
  const createVideo = useMutation(api.videos.createVideo);
  const updateVideo = useMutation(api.videos.updateVideo);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const patchTask = (id: string, patch: Partial<Task>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const addFiles = (files: FileList | File[]) => {
    const newTasks: Task[] = [];
    for (const file of Array.from(files)) {
      const validation = validateVideoFile(file);
      if (!validation.ok) {
        // Surface invalid files as error tasks
        newTasks.push({
          id: `t${++taskCounter}`,
          file,
          phase: "error",
          analysisPct: 0,
          uploadPct: 0,
          error: validation.error,
          controller: new AbortController(),
        });
        continue;
      }
      const task: Task = {
        id: `t${++taskCounter}`,
        file,
        phase: "analyzing",
        analysisPct: 0,
        uploadPct: 0,
        controller: new AbortController(),
      };
      newTasks.push(task);
      void runTask(task);
    }
    setTasks((prev) => [...prev, ...newTasks]);
  };

  const runTask = async (task: Task) => {
    const signal = task.controller.signal;
    try {
      // Start upload immediately (independent of analysis)
      const uploadPromise = uploadToStorage(
        task.file,
        generateUploadUrl,
        {
          onProgress: (pct) => patchTask(task.id, { uploadPct: pct }),
          signal,
        },
      ).catch((err) => {
        throw err;
      });

      // Analyze in parallel (real signal processing)
      let signals: Awaited<ReturnType<typeof analyzeVideoFile>> | null = null;
      try {
        signals = await analyzeVideoFile(task.file, (p) => {
          patchTask(task.id, {
            analysisPct:
              p.stage === "reading"
                ? Math.round(p.pct * 0.25)
                : p.stage === "audio"
                  ? Math.round(25 + p.pct * 0.35)
                  : Math.round(60 + p.pct * 0.4),
          });
        }, signal);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        // Analysis failed but upload may still succeed — continue without signals
        signals = null;
      }

      const { storageId } = await uploadPromise;
      patchTask(task.id, { phase: "creating", analysisPct: 100, uploadPct: 100 });
      const storageIdTyped = storageId as Id<"_storage">;

      const videoId = await createVideo({
        projectId,
        name: task.file.name.replace(/\.[^.]+$/, ""),
        mimeType: task.file.type || "video/mp4",
        size: task.file.size,
        storageId: storageIdTyped,
        durationMs: signals?.meta.durationMs,
        width: signals?.meta.width,
        height: signals?.meta.height,
        thumbnail: signals?.meta.thumbnail,
      });

      if (signals) {
        await updateVideo({
          videoId,
          signals: signals.signals,
          analyzedAt: Date.now(),
          status: "analyzed",
        });
      }

      patchTask(task.id, { phase: "done", videoId });
      onUploaded?.(videoId);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        patchTask(task.id, { phase: "error", error: "Cancelled" });
      } else {
        patchTask(task.id, {
          phase: "error",
          error: err instanceof Error ? err.message : "Upload failed",
        });
      }
    }
  };

  const retryTask = (task: Task) => {
    patchTask(task.id, { phase: "analyzing", analysisPct: 0, uploadPct: 0, error: undefined });
    task.controller = new AbortController();
    void runTask(task);
  };

  const cancelTask = (task: Task) => {
    task.controller.abort();
  };

  const removeTask = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const activeCount = tasks.filter(
    (t) => t.phase === "analyzing" || t.phase === "uploading" || t.phase === "creating",
  ).length;

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
          MP4 · MOV · WebM — up to 2GB. Analysis runs locally in your browser.
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
      </div>

      {tasks.length > 0 && (
        <div className="flex flex-col gap-2">
          {tasks.map((task) => {
            const combined =
              task.phase === "creating" || task.phase === "done"
                ? 100
                : Math.round(task.analysisPct * 0.5 + task.uploadPct * 0.5);
            return (
              <div key={task.id} className="clay flex items-center gap-3 px-4 py-3">
                <div className="clay-inset flex size-10 shrink-0 items-center justify-center rounded-xl">
                  {task.phase === "done" ? (
                    <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-300" />
                  ) : task.phase === "error" ? (
                    <XCircle className="size-5 text-destructive" />
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
                  {task.phase === "error" ? (
                    <p className="mt-1 text-xs text-destructive">{task.error}</p>
                  ) : task.phase === "done" ? (
                    <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-300">
                      Ready — analysis & upload complete
                    </p>
                  ) : (
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-200"
                        style={{ width: `${combined}%` }}
                      />
                    </div>
                  )}
                  {task.phase !== "error" && task.phase !== "done" && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {task.phase === "analyzing" && "Analyzing audio & scenes…"}
                      {task.phase === "uploading" && `Uploading ${task.uploadPct}%`}
                      {task.phase === "creating" && "Saving…"}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {task.phase === "error" && task.error !== "Cancelled" && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => retryTask(task)}
                      title="Retry"
                    >
                      <RefreshCcw className="size-4" />
                    </Button>
                  )}
                  {(task.phase === "analyzing" ||
                    task.phase === "uploading" ||
                    task.phase === "creating") && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => cancelTask(task)}
                      title="Cancel"
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                  {(task.phase === "done" || task.phase === "error") && (
                    <Button variant="ghost" size="icon-sm" onClick={() => removeTask(task.id)} title="Dismiss">
                      <X className="size-4" />
                    </Button>
                  )}
                  {task.phase === "creating" && (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {activeCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {activeCount} file{activeCount > 1 ? "s" : ""} processing in parallel
        </p>
      )}
    </div>
  );
}
