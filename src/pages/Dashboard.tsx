import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { ScoreRing } from "@/components/studio/ScoreRing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { formatBytes, formatTimestamp, timeAgo } from "@/lib/video/format";
import { useNavigate } from "react-router";
import { useState } from "react";
import {
  Archive,
  ChevronRight,
  Clapperboard,
  Film,
  FolderPlus,
  HardDrive,
  KeyRound,
  Loader2,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const projects = useQuery(api.projects.listProjects, {});
  const recentClips = useQuery(api.clips.listRecentClips, { limit: 8 });
  const aiStatus = useQuery(api.status.aiStatus);

  const createProject = useMutation(api.projects.createProject);
  const toggleArchive = useMutation(api.projects.toggleArchive);
  const deleteProject = useMutation(api.projects.deleteProject);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!projectName.trim()) return;
    setCreating(true);
    try {
      const id = await createProject({ name: projectName.trim() });
      setDialogOpen(false);
      setProjectName("");
      navigate(`/projects/${id}`);
    } catch (err) {
      toast({
        title: "Could not create project",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const stats = [
    {
      label: "Projects",
      value: projects?.length ?? 0,
      icon: <FolderPlus className="size-5" />,
      tint: "clay-peach",
    },
    {
      label: "Clips generated",
      value: (projects ?? []).reduce((acc, p) => acc + p.clipCount, 0),
      icon: <Scissors className="size-5" />,
      tint: "clay-mint",
    },
    {
      label: "Storage used",
      value: formatBytes(user?.storageBytes ?? 0),
      icon: <HardDrive className="size-5" />,
      tint: "clay-sky",
    },
    {
      label: "AI providers",
      value:
        aiStatus === undefined
          ? "…"
          : aiStatus.transcriptionConfigured || aiStatus.llmConfigured
            ? "Connected"
            : "Not configured",
      icon: <KeyRound className="size-5" />,
      tint: "clay-lilac",
    },
  ];

  return (
    <AppShell>
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        {/* greeting */}
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">
              Welcome back{user?.name ? `, ${user.name.split(" ")[0]}` : ""} 👋
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Turn long-form video into short-form clips your audience actually watches.
            </p>
          </div>
          <Button size="lg" className="clay-press ml-auto gap-2" onClick={() => setDialogOpen(true)}>
            <Plus className="size-5" />
            New project
          </Button>
        </div>

        {/* stats */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className={cn("clay flex items-center gap-3 p-4", s.tint)}>
              <div className="clay-inset flex size-11 shrink-0 items-center justify-center rounded-2xl">
                {s.icon}
              </div>
              <div className="min-w-0">
                <p className="text-lg font-extrabold leading-tight tabular-nums">{s.value}</p>
                <p className="truncate text-xs text-muted-foreground">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* provider banner */}
        {aiStatus && !aiStatus.transcriptionConfigured && !aiStatus.llmConfigured && (
          <div className="clay clay-butter flex flex-wrap items-center gap-3 p-4">
            <div className="clay-inset flex size-10 items-center justify-center rounded-xl">
              <KeyRound className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">Connect AI providers for full power</p>
              <p className="text-xs text-muted-foreground">
                Add <code className="font-mono">DEEPGRAM_API_KEY</code> for word-level captions &amp; speaker
                diarization and <code className="font-mono">OPENAI_API_KEY</code> for AI hooks &amp; titles.
                Clip discovery works without either.
              </p>
            </div>
            <Sparkles className="size-5 shrink-0 text-muted-foreground" />
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          {/* projects */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold">Projects</h2>
              <span className="text-xs text-muted-foreground">{(projects ?? []).length} total</span>
            </div>
            {projects === undefined ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : projects.length === 0 ? (
              <div className="clay-inset flex flex-col items-center gap-3 rounded-3xl p-10 text-center">
                <div className="clay clay-mint flex size-14 items-center justify-center rounded-full">
                  <Film className="size-7" />
                </div>
                <p className="font-semibold">No projects yet</p>
                <p className="max-w-xs text-sm text-muted-foreground">
                  Create a project, drop in a long video, and let the AI find your best clips.
                </p>
                <Button className="clay-press gap-2" onClick={() => setDialogOpen(true)}>
                  <Plus className="size-4" /> Create your first project
                </Button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {projects.map((p) => (
                  <div
                    key={p._id}
                    className={cn(
                      "clay group flex cursor-pointer flex-col gap-3 p-4 transition-all hover:shadow-xl",
                      p.archived && "opacity-70",
                    )}
                    onClick={() => navigate(`/projects/${p._id}`)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="clay-inset flex size-11 items-center justify-center rounded-2xl bg-accent/40">
                        <Clapperboard className="size-5 text-primary" />
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon-sm">
                            <ChevronRight className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenuItem
                            className="cursor-pointer"
                            onClick={() => toggleArchive({ projectId: p._id })}
                          >
                            <Archive className="mr-2 size-4" />
                            {p.archived ? "Unarchive" : "Archive"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="cursor-pointer text-destructive focus:text-destructive"
                            onClick={async () => {
                              await deleteProject({ projectId: p._id });
                              toast({ title: "Project deleted" });
                            }}
                          >
                            <Trash2 className="mr-2 size-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div>
                      <p className="font-bold leading-tight">{p.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {p.videoCount} video{p.videoCount !== 1 ? "s" : ""} · {p.clipCount} clip{p.clipCount !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">{timeAgo(p.updatedAt)}</span>
                      <span className="clay-chip flex items-center gap-1 bg-accent/50 px-2 py-0.5 text-[10px] font-bold text-accent-foreground">
                        <Zap className="size-3" /> Open
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* recent clips */}
          <div className="flex flex-col gap-3">
            <h2 className="text-base font-bold">Recent clips</h2>
            {recentClips === undefined ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : recentClips.length === 0 ? (
              <div className="clay-inset rounded-3xl p-6 text-center text-sm text-muted-foreground">
                Clips you generate will show up here.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {recentClips.map((c) => (
                  <button
                    key={c._id}
                    onClick={() => navigate(`/clips/${c._id}`)}
                    className="clay-press flex items-center gap-3 rounded-2xl p-2.5 text-left transition-all hover:bg-accent/50"
                  >
                    <ScoreRing score={c.score} size={44} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{c.projectName || "Clip"}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatTimestamp(c.startMs)} → {formatTimestamp(c.endMs)} · {c.videoName}
                      </p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              A project holds your videos, AI analysis, clips and exports.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate();
            }}
          >
            <Input
              autoFocus
              placeholder="e.g. Podcast Q3 · Client launch · Vlog channel"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
            />
            <DialogFooter className="mt-4">
              <Button
                type="submit"
                className="clay-press gap-2"
                disabled={creating || !projectName.trim()}
              >
                {creating && <Loader2 className="size-4 animate-spin" />}
                Create project
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
