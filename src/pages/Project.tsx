import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/AppShell";
import { UploadZone } from "@/components/studio/UploadZone";
import { MediaLibrary } from "@/components/studio/MediaLibrary";
import { StrategyPicker } from "@/components/studio/StrategyPicker";
import { ScoreRing } from "@/components/studio/ScoreRing";
import { useIngestionRunner } from "@/hooks/use-ingestion-runner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { discoverClips } from "@/lib/video/scoring";
import { hookForCandidate } from "@/lib/video/hooks";
import type { ClipCandidate, ClipStrategy } from "@/lib/video/types";
import { formatDuration, formatTimestamp } from "@/lib/video/format";
import { useNavigate, useParams } from "react-router";
import { useState, useEffect } from "react";
import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  Clock,
  ChevronRight,
  Loader2,
  Mic,
  MoreHorizontal,
  Sparkles,
  Trash2,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { cn } from "@/lib/utils";

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const project = useQuery(
    api.projects.getProject,
    projectId ? { projectId: projectId as Id<"projects"> } : "skip",
  );
  const videos = useQuery(
    api.videos.listVideos,
    projectId ? { projectId: projectId as Id<"projects"> } : "skip",
  );
  const clips = useQuery(
    api.clips.listClips,
    projectId ? { projectId: projectId as Id<"projects"> } : "skip",
  );
  const templates = useQuery(api.templates.listTemplates);
  const aiStatus = useQuery(api.status.aiStatus);

  const renameProject = useMutation(api.projects.renameProject);
  const toggleArchive = useMutation(api.projects.toggleArchive);
  const deleteProject = useMutation(api.projects.deleteProject);
  const transcribe = useAction(api.ai.transcribe);
  const createClips = useMutation(api.clips.createClips);
  const touchVideo = useMutation(api.videos.touchVideo);

  // Browser-side ingestion worker: picks up queued MEDIA_INGESTION jobs and
  // runs the real processing pipeline (probe → analyze → proxy → thumbs).
  useIngestionRunner(projectId ? (projectId as Id<"projects">) : null);

  const [selectedVideoId, setSelectedVideoId] = useState<Id<"videos"> | null>(null);
  const [strategy, setStrategy] = useState<ClipStrategy>("viral");
  const [activeTemplateId, setActiveTemplateId] = useState<Id<"templates"> | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [transcribingId, setTranscribingId] = useState<Id<"videos"> | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const selectedVideo = videos?.find((v) => v._id === selectedVideoId) ?? videos?.[0] ?? null;

  useEffect(() => {
    if (videos && videos.length > 0 && !selectedVideoId) {
      const first = videos[0]._id;
      setSelectedVideoId(first);
      // Opening a video counts as activity — keeps the original around.
      void touchVideo({ videoId: first });
    }
  }, [videos, selectedVideoId, touchVideo]);

  if (project === undefined || videos === undefined || clips === undefined) {
    return (
      <AppShell>
        <div className="flex min-h-64 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  if (project === null) {
    return (
      <AppShell>
        <div className="clay mx-auto max-w-md p-8 text-center">
          <p className="font-semibold">Project not found</p>
          <Button className="mt-4" onClick={() => navigate("/dashboard")}>
            Back to projects
          </Button>
        </div>
      </AppShell>
    );
  }

  const clipList = selectedVideo
    ? (clips ?? []).filter((c) => c.videoId === selectedVideo._id)
    : [];

  const handleDiscover = async () => {
    if (!selectedVideo?.signals) return;
    setDiscovering(true);
    try {
      const activeTemplate =
        templates?.find((t) => t._id === activeTemplateId) ?? null;
      const candidates: ClipCandidate[] = discoverClips(
        selectedVideo.signals,
        selectedVideo.transcript ?? null,
        activeTemplate?.strategy ?? strategy,
        10,
        activeTemplate?.durationMs,
      );
      if (candidates.length === 0) {
        toast({
          title: "No strong clips found",
          description: "Try a different strategy or check that the video has clear audio.",
        });
        return;
      }
      const transcriptText = selectedVideo.transcript?.text ?? "";
      const created = await createClips({
        videoId: selectedVideo._id,
        aspect: activeTemplate?.aspect,
        captionsEnabled: activeTemplate?.captionsEnabled,
        clips: candidates.map((c) => ({
          startMs: c.startMs,
          endMs: c.endMs,
          score: c.score,
          subScores: c.subScores,
          reasons: c.reasons,
          strategy: c.strategy,
          hook: transcriptText ? hookForCandidate(transcriptText, c.strategy) : undefined,
        })),
      });
      toast({
        title: `${created} clips found`,
        description: "Each clip is scored and ready to refine in the studio.",
      });
    } catch (err) {
      toast({
        title: "Discovery failed",
        description: err instanceof Error ? err.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setDiscovering(false);
    }
  };

  const handleTranscribe = async (videoId: Id<"videos">) => {
    setTranscribingId(videoId);
    try {
      const result = await transcribe({ videoId });
      if (result.configured) {
        toast({
          title: "Transcription complete",
          description: "Word-level captions & AI hooks are now available.",
        });
      }
    } catch (err) {
      toast({
        title: "Transcription failed",
        description: err instanceof Error ? err.message : "Check the provider key and try again.",
        variant: "destructive",
      });
    } finally {
      setTranscribingId(null);
    }
  };

  return (
    <AppShell title={project.name}>
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="size-5" />
          </Button>
          {editingName ? (
            <form
              className="flex items-center gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                await renameProject({ projectId: project._id, name: nameDraft || project.name });
                setEditingName(false);
              }}
            >
              <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} className="h-9 max-w-56" autoFocus />
              <Button type="submit" size="sm">Save</Button>
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => setEditingName(false)}>
                <X className="size-4" />
              </Button>
            </form>
          ) : (
            <button
              onClick={() => {
                setNameDraft(project.name);
                setEditingName(true);
              }}
              className="clay-press group flex items-center gap-2 rounded-full px-4 py-1.5 text-lg font-bold hover:bg-accent"
              title="Rename project"
            >
              {project.name}
            </button>
          )}
          <Badge variant="secondary" className="clay-chip gap-1">
            {project.videoCount} video{project.videoCount !== 1 ? "s" : ""} · {project.clipCount} clip{project.clipCount !== 1 ? "s" : ""}
          </Badge>
          <div className="ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreHorizontal className="size-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => toggleArchive({ projectId: project._id })} className="cursor-pointer">
                  <Archive className="mr-2 size-4" />
                  {project.archived ? "Unarchive" : "Archive"}
                </DropdownMenuItem>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <DropdownMenuItem className="cursor-pointer text-destructive focus:text-destructive" onSelect={(e) => e.preventDefault()}>
                      <Trash2 className="mr-2 size-4" />
                      Delete project
                    </DropdownMenuItem>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this project?</AlertDialogTitle>
                      <AlertDialogDescription>
                        All videos, clips and exports in “{project.name}” will be permanently deleted.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-white hover:bg-destructive/90"
                        onClick={async () => {
                          await deleteProject({ projectId: project._id });
                          navigate("/dashboard");
                        }}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
          {/* LEFT: media library */}
          <div className="flex flex-col gap-4">
            <UploadZone projectId={project._id} onUploaded={(id) => setSelectedVideoId(id)} />

            <div className="clay p-4">
              <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
                Media library
              </h3>
              {videos.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No videos yet. Drop a file above to get started.
                </p>
              ) : (
                <MediaLibrary
                  projectId={project._id}
                  videos={videos}
                  selectedVideoId={selectedVideo?._id ?? null}
                  onSelect={(id) => {
                    setSelectedVideoId(id);
                    // Selecting a video counts as activity.
                    void touchVideo({ videoId: id });
                  }}
                />
              )}
            </div>
          </div>

          {/* RIGHT: AI studio */}
          <div className="flex flex-col gap-5">
            {!selectedVideo ? (
              <div className="clay flex min-h-72 flex-col items-center justify-center gap-3 p-8 text-center">
                <div className="clay clay-sky flex size-14 items-center justify-center rounded-full">
                  <Sparkles className="size-7" />
                </div>
                <p className="font-semibold">Upload a video to start finding clips</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Clippy analyzes audio &amp; visual signals, finds the best moments, and scores every clip.
                </p>
              </div>
            ) : (
              <>
                {/* AI pipeline status */}
                <div className="clay p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold">AI Studio</h3>
                    <span className="text-sm text-muted-foreground">{selectedVideo.name}</span>
                    <div className="ml-auto flex items-center gap-2">
                      {selectedVideo.transcriptionStatus === "unconfigured" && (
                        <>
                          <Badge variant="outline" className="gap-1 text-[11px]">
                            <Wand2 className="size-3" /> Transcript needs DEEPGRAM_API_KEY
                          </Badge>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="clay-press"
                            disabled={transcribingId === selectedVideo._id}
                            onClick={() => handleTranscribe(selectedVideo._id)}
                            title="Re-check after adding the key"
                          >
                            {transcribingId === selectedVideo._id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Mic className="size-4" />
                            )}
                            Try again
                          </Button>
                        </>
                      )}
                      {selectedVideo.transcriptionStatus === "none" && (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="clay-press"
                          disabled={transcribingId === selectedVideo._id}
                          onClick={() => handleTranscribe(selectedVideo._id)}
                        >
                          {transcribingId === selectedVideo._id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Mic className="size-4" />
                          )}
                          Transcribe
                        </Button>
                      )}
                      {selectedVideo.transcriptionStatus === "pending" && (
                        <Badge variant="secondary" className="gap-1 text-[11px]">
                          <Loader2 className="size-3 animate-spin" /> Transcribing…
                        </Badge>
                      )}
                      {selectedVideo.transcriptionStatus === "done" && (
                        <Badge variant="secondary" className="clay-chip gap-1 text-[11px]">
                          <CheckCircle2 className="size-3 text-emerald-600" />
                          {(selectedVideo.transcript?.words ?? []).length.toLocaleString()} words
                        </Badge>
                      )}
                      {selectedVideo.transcriptionStatus === "failed" && (
                        <Badge variant="destructive" className="text-[11px]" title={selectedVideo.transcriptionError}>
                          Transcript failed
                        </Badge>
                      )}
                    </div>
                  </div>

                  {selectedVideo.transcriptionStatus === "unconfigured" && !aiStatus?.transcriptionConfigured && (
                    <p className="mt-2 rounded-xl bg-accent/50 px-3 py-2 text-xs text-muted-foreground">
                      Add a <code className="font-mono">DEEPGRAM_API_KEY</code> in your Keys panel to unlock
                      word-level captions, speaker diarization and AI hooks. Clip discovery works on audio
                      signals regardless.
                    </p>
                  )}

                  {selectedVideo.signals ? (
                    <div className="mt-4 flex flex-col gap-3">
                      <StrategyPicker
                        value={strategy}
                        onChange={(s) => {
                          setStrategy(s);
                          setActiveTemplateId(null);
                        }}
                      />
                      {templates && templates.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                            Apply template
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {templates.map((tpl) => (
                              <button
                                key={tpl._id}
                                onClick={() => {
                                  setActiveTemplateId(tpl._id);
                                  setStrategy(tpl.strategy);
                                }}
                                className={cn(
                                  "clay-press clay-chip flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all",
                                  activeTemplateId === tpl._id
                                    ? "bg-primary text-primary-foreground shadow-md"
                                    : "bg-background hover:bg-accent",
                                )}
                                title={tpl.description ?? undefined}
                              >
                                <span>{tpl.emoji}</span>
                                {tpl.name}
                                <span className="opacity-70">· {tpl.durationMs / 1000}s</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <Button
                        size="lg"
                        className="clay-press self-start gap-2"
                        disabled={discovering}
                        onClick={handleDiscover}
                      >
                        {discovering ? (
                          <Loader2 className="size-5 animate-spin" />
                        ) : (
                          <Zap className="size-5" />
                        )}
                        Find my best clips
                        {activeTemplateId && (
                          <span className="text-xs font-normal opacity-80">
                            · {templates?.find((t) => t._id === activeTemplateId)?.name}
                          </span>
                        )}
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">
                      {selectedVideo.status === "failed"
                        ? "Analysis failed for this video. Try re-uploading it."
                        : "This video was uploaded without analysis. Re-upload to enable clip discovery."}
                    </p>
                  )}
                </div>

                {/* expired-original notice */}
                {selectedVideo.status === "expired" && (
                  <div className="clay flex items-start gap-3 border-amber-300/40 p-4">
                    <Clock className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" />
                    <div className="text-sm">
                      <p className="font-semibold">Original file removed</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        The source video was deleted after 2 hours of inactivity. Your
                        clips, analysis and exports are safe — re-upload the source to
                        trim or re-render clips.
                      </p>
                    </div>
                  </div>
                )}

                {/* clip grid */}
                <div className="flex flex-col gap-3">
                  <h3 className="text-base font-bold">
                    Best clips{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      ({clipList.length})
                    </span>
                  </h3>
                  {clipList.length === 0 ? (
                    <div className="clay-inset rounded-2xl p-6 text-center text-sm text-muted-foreground">
                      No clips yet — run “Find my best clips” above.
                    </div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      {clipList.map((clip) => (
                        <div key={clip._id} className="clay flex flex-col gap-3 p-4 transition-shadow hover:shadow-xl">
                          <div className="flex items-center gap-3">
                            <ScoreRing score={clip.score} />
                            <div className="min-w-0 flex-1">
                              <p className="font-bold tabular-nums">
                                {formatTimestamp(clip.startMs)} → {formatTimestamp(clip.endMs)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatDuration(clip.endMs - clip.startMs)} · {clip.strategy}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              className="clay-press"
                              onClick={() => navigate(`/clips/${clip._id}`)}
                            >
                              Open <ChevronRight className="size-4" />
                            </Button>
                          </div>
                          {clip.hook && (
                            <p className="line-clamp-2 rounded-xl bg-accent/40 px-3 py-2 text-sm font-medium">
                              “{clip.hook}”
                            </p>
                          )}
                          <ul className="flex flex-wrap gap-1">
                            {clip.reasons.map((r) => (
                              <li key={r} className="clay-chip bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground">
                                {r}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
