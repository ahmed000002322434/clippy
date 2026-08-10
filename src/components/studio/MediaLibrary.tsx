import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatBytes, formatDuration } from "@/lib/video/format";
import { PreviewPlayer } from "./PreviewPlayer";
import type { PreviewableVideo } from "./PreviewPlayer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  FileVideo,
  Link2,
  Loader2,
  Pencil,
  Play,
  Trash2,
  X,
} from "lucide-react";

interface LibraryVideo extends PreviewableVideo {
  _id: Id<"videos">;
  projectId: Id<"projects">;
  userId: Id<"users">;
  name: string;
  mimeType: string;
  size: number;
  thumbnail?: string;
  source?: string;
  status: string;
  transcriptionStatus?: string;
  mediaStatus?: string;
  mediaError?: string;
  url: string | null;
}

type ProcessingState =
  | { kind: "queued" }
  | { kind: "processing"; stage?: string; progress?: number }
  | { kind: "failed"; error?: string }
  | { kind: "ready" }
  | { kind: "none" };

function processingStateOf(
  video: LibraryVideo,
  jobs: { assetId?: Id<"videos">; type: string; status: string; stage?: string; progress: number; error?: string }[],
): ProcessingState {
  const job = jobs.find(
    (j) => j.assetId === video._id && j.type === "MEDIA_INGESTION",
  );
  if (job) {
    if (job.status === "queued" || job.status === "retrying") {
      return { kind: "queued" };
    }
    if (job.status === "processing") {
      return { kind: "processing", stage: job.stage, progress: job.progress };
    }
    if (job.status === "failed") return { kind: "failed", error: job.error };
  }
  if (video.mediaStatus === "failed") {
    return { kind: "failed", error: video.mediaError };
  }
  if (video.mediaStatus === "ready") return { kind: "ready" };
  return { kind: "none" };
}

function StateBadge({ state }: { state: ProcessingState }) {
  switch (state.kind) {
    case "queued":
      return (
        <Badge variant="secondary" className="gap-1 text-[10px]">
          <Clock className="size-3 text-amber-500" /> Queued
        </Badge>
      );
    case "processing":
      return (
        <Badge
          variant="secondary"
          className="gap-1 text-[10px]"
          title={state.stage ?? "Processing"}
        >
          <Loader2 className="size-3 animate-spin text-primary" />
          {state.stage ?? "Processing"}
          {typeof state.progress === "number" ? ` ${state.progress}%` : ""}
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="text-[10px]" title={state.error}>
          Failed
        </Badge>
      );
    case "ready":
      return (
        <Badge variant="secondary" className="clay-chip gap-1 text-[10px]">
          <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-300" />
          Ready
        </Badge>
      );
    case "none":
      return <Badge variant="outline" className="text-[10px]">Pending</Badge>;
  }
}

export function MediaLibrary({
  projectId,
  videos,
  selectedVideoId,
  onSelect,
}: {
  projectId: Id<"projects">;
  videos: LibraryVideo[];
  selectedVideoId: Id<"videos"> | null;
  onSelect: (id: Id<"videos">) => void;
}) {
  const jobs = useQuery(api.jobs.listJobs, { projectId });
  const renameVideo = useMutation(api.videos.renameVideo);
  const deleteVideo = useMutation(api.videos.deleteVideo);

  const [renamingId, setRenamingId] = useState<Id<"videos"> | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [deletingId, setDeletingId] = useState<Id<"videos"> | null>(null);
  const [previewId, setPreviewId] = useState<Id<"videos"> | null>(null);

  const previewVideo = videos.find((v) => v._id === previewId) ?? null;

  const commitRename = async (videoId: Id<"videos">) => {
    const name = nameDraft.trim();
    if (name && name !== videos.find((v) => v._id === videoId)?.name) {
      try {
        await renameVideo({ videoId, name });
      } catch (err) {
        // surface via the inline input reset
      }
    }
    setRenamingId(null);
  };

  return (
    <div className="flex flex-col gap-2">
      {videos.map((video) => {
        const state = processingStateOf(video, jobs ?? []);
        const isSelected = selectedVideoId === video._id;
        const isProcessing =
          state.kind === "queued" || state.kind === "processing";
        return (
          <div
            key={video._id}
            className={cn(
              "clay-press flex items-center gap-3 rounded-2xl border p-2 transition-all",
              isSelected
                ? "border-primary/60 bg-primary/5"
                : "border-transparent hover:bg-accent/60",
            )}
          >
            {/* thumbnail */}
            <button
              onClick={() => onSelect(video._id)}
              className="relative h-14 w-20 shrink-0 overflow-hidden rounded-xl"
              title="Select in studio"
            >
              {video.thumbnail ? (
                <img src={video.thumbnail} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="clay-inset flex h-full w-full items-center justify-center">
                  <FileVideo className="size-5 text-muted-foreground" />
                </div>
              )}
              {isProcessing && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <Loader2 className="size-4 animate-spin text-white" />
                </div>
              )}
              {state.kind === "ready" && (
                <div className="absolute bottom-1 right-1 flex size-5 items-center justify-center rounded-full bg-black/50">
                  <Play className="size-2.5 text-white" />
                </div>
              )}
            </button>

            {/* details */}
            <button
              onClick={() => onSelect(video._id)}
              className="min-w-0 flex-1 text-left"
            >
              <div className="flex items-center gap-1.5">
                {renamingId === video._id ? (
                  <form
                    className="flex min-w-0 flex-1 items-center gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void commitRename(video._id);
                    }}
                  >
                    <Input
                      autoFocus
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onBlur={() => void commitRename(video._id)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      className="h-7 text-xs"
                    />
                  </form>
                ) : (
                  <p className="truncate text-sm font-medium">{video.name}</p>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {video.durationMs ? formatDuration(video.durationMs) : "—"}
                {video.width && video.height
                  ? ` · ${video.width}×${video.height}`
                  : ""}
                {" · "}
                {formatBytes(video.size)}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <StateBadge state={state} />
                {state.kind === "ready" && video.transcriptionStatus === "done" && (
                  <Badge variant="secondary" className="clay-chip gap-1 text-[10px]">
                    <CheckCircle2 className="size-3 text-primary" /> Transcript
                  </Badge>
                )}
                {video.source === "url" && (
                  <Badge variant="secondary" className="clay-chip gap-1 text-[10px]">
                    <Link2 className="size-3 text-primary" /> Imported
                  </Badge>
                )}
                {state.kind === "failed" && state.error && (
                  <span className="max-w-40 truncate text-[10px] text-destructive" title={state.error}>
                    {state.error}
                  </span>
                )}
              </div>
            </button>

            <ChevronRight
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                isSelected && "rotate-90",
              )}
            />

            {/* actions */}
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon-sm"
                title="Preview"
                onClick={() => setPreviewId(video._id)}
                disabled={!video.url && !video.proxyUrl}
              >
                <Play className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Rename"
                onClick={() => {
                  setRenamingId(video._id);
                  setNameDraft(video.name);
                }}
              >
                <Pencil className="size-4" />
              </Button>
              <AlertDialog
                open={deletingId === video._id}
                onOpenChange={(open) => {
                  if (!open) setDeletingId(null);
                }}
              >
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-destructive"
                    title="Delete"
                    onClick={() => setDeletingId(video._id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this video?</AlertDialogTitle>
                    <AlertDialogDescription>
                      “{video.name}” and everything derived from it — the original
                      file, proxy, thumbnails, waveform and clips — will be
                      permanently removed. This can&apos;t be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-white hover:bg-destructive/90"
                      onClick={async () => {
                        await deleteVideo({ videoId: video._id });
                        setDeletingId(null);
                      }}
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              {renamingId === video._id && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Cancel rename"
                  onClick={() => setRenamingId(null)}
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
          </div>
        );
      })}

      <PreviewPlayer
        video={previewVideo}
        open={previewVideo !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewId(null);
        }}
      />
    </div>
  );
}
