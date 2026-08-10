import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { CAPTION_STYLES, getCaptionStyle } from "@/lib/video/captions";
import { STRATEGIES } from "@/lib/video/scoring";
import type { AspectRatio, ClipStrategy } from "@/lib/video/types";
import { formatBytes } from "@/lib/video/format";
import { useState } from "react";
import {
  CheckCircle2,
  Clapperboard,
  Clock,
  FileVideo,
  HardDrive,
  KeyRound,
  LayoutTemplate,
  Loader2,
  Mic,
  Palette,
  Pencil,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  Wand2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ASPECTS: AspectRatio[] = ["9:16", "1:1", "4:5", "16:9"];
const DURATION_PRESETS = [15_000, 30_000, 45_000, 60_000, 90_000];
const PRESET_COLORS = [
  "#F97316",
  "#EF4444",
  "#8B5CF6",
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#EC4899",
  "#14B8A6",
];

// ---------------------------------------------------------------------------
// Brand kit editor
// ---------------------------------------------------------------------------
interface KitDraft {
  name: string;
  primaryColor: string;
  captionStyle: string;
  aspect: AspectRatio;
  captionsEnabled: boolean;
}

function KitDialog({
  open,
  onOpenChange,
  initial,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: KitDraft;
  onSave: (draft: KitDraft) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<KitDraft>(initial);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial.name ? "Edit brand kit" : "New brand kit"}</DialogTitle>
          <DialogDescription>
            A reusable caption look + default frame for every clip.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.name.trim()) return;
            onSave({ ...draft, name: draft.name.trim() });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input
              autoFocus
              value={draft.name}
              placeholder="e.g. My channel look"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>

          {/* live preview */}
          <div className="relative flex aspect-video items-end justify-center overflow-hidden rounded-2xl bg-black/85 p-4">
            <span
              className="block rounded-lg px-3 py-1.5 text-center text-sm font-extrabold"
              style={{
                fontFamily: getCaptionStyle(draft.captionStyle).fontFamily,
                color: getCaptionStyle(draft.captionStyle).color,
                background: draft.captionsEnabled
                  ? "rgba(0,0,0,0.55)"
                  : "transparent",
              }}
            >
              <span style={{ color: draft.primaryColor }}>
                {draft.captionsEnabled ? "THIS" : "—"}
              </span>{" "}
              is a clip moment
            </span>
            <span
              className="absolute left-3 top-3 rounded-full px-2 py-0.5 text-[9px] font-bold"
              style={{ background: draft.primaryColor, color: "#fff" }}
            >
              {draft.aspect}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Accent color</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setDraft({ ...draft, primaryColor: c })}
                  className={cn(
                    "clay-press size-7 rounded-full transition-transform",
                    draft.primaryColor === c && "scale-110 ring-2 ring-ring ring-offset-2",
                  )}
                  style={{ background: c }}
                  aria-label={`Color ${c}`}
                />
              ))}
              <label className="clay-inset flex size-7 cursor-pointer items-center justify-center overflow-hidden rounded-full">
                <input
                  type="color"
                  value={draft.primaryColor}
                  onChange={(e) => setDraft({ ...draft, primaryColor: e.target.value })}
                  className="size-10 cursor-pointer"
                />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Caption style</Label>
              <Select
                value={draft.captionStyle}
                onValueChange={(v) => setDraft({ ...draft, captionStyle: v })}
              >
                <SelectTrigger className="clay-inset border-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CAPTION_STYLES.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Default aspect</Label>
              <Select
                value={draft.aspect}
                onValueChange={(v) => setDraft({ ...draft, aspect: v as AspectRatio })}
              >
                <SelectTrigger className="clay-inset border-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASPECTS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-2xl bg-accent/40 px-3 py-2.5">
            <div>
              <p className="text-sm font-semibold">Captions on by default</p>
              <p className="text-xs text-muted-foreground">New clips start with captions enabled</p>
            </div>
            <Switch
              checked={draft.captionsEnabled}
              onCheckedChange={(v) => setDraft({ ...draft, captionsEnabled: v })}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" className="clay-press gap-2" disabled={saving || !draft.name.trim()}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {initial.name ? "Save changes" : "Create kit"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Template editor
// ---------------------------------------------------------------------------
interface TemplateDraft {
  name: string;
  emoji: string;
  description: string;
  strategy: ClipStrategy;
  durationMs: number;
  aspect: AspectRatio;
  captionsEnabled: boolean;
}

function TemplateDialog({
  open,
  onOpenChange,
  initial,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: TemplateDraft;
  onSave: (draft: TemplateDraft) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<TemplateDraft>(initial);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial.name ? "Edit template" : "New template"}</DialogTitle>
          <DialogDescription>
            A reusable recipe — strategy, target length and output shape.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.name.trim()) return;
            onSave({ ...draft, name: draft.name.trim() });
          }}
        >
          <div className="flex gap-2">
            <div className="flex w-16 flex-col gap-1.5">
              <Label>Icon</Label>
              <Input
                value={draft.emoji}
                onChange={(e) => setDraft({ ...draft, emoji: e.target.value })}
                className="text-center"
                maxLength={4}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label>Name</Label>
              <Input
                autoFocus
                value={draft.name}
                placeholder="e.g. 30s viral hook"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <Textarea
              value={draft.description}
              placeholder="What is this template for?"
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="min-h-16 resize-none"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Strategy</Label>
            <Select
              value={draft.strategy}
              onValueChange={(v) => setDraft({ ...draft, strategy: v as ClipStrategy })}
            >
              <SelectTrigger className="clay-inset border-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STRATEGIES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.emoji} {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Target length</Label>
              <Select
                value={String(draft.durationMs)}
                onValueChange={(v) => setDraft({ ...draft, durationMs: Number(v) })}
              >
                <SelectTrigger className="clay-inset border-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_PRESETS.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d / 1000}s
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Aspect</Label>
              <Select
                value={draft.aspect}
                onValueChange={(v) => setDraft({ ...draft, aspect: v as AspectRatio })}
              >
                <SelectTrigger className="clay-inset border-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASPECTS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-2xl bg-accent/40 px-3 py-2.5">
            <div>
              <p className="text-sm font-semibold">Captions enabled</p>
              <p className="text-xs text-muted-foreground">Clips created from this template keep captions</p>
            </div>
            <Switch
              checked={draft.captionsEnabled}
              onCheckedChange={(v) => setDraft({ ...draft, captionsEnabled: v })}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" className="clay-press gap-2" disabled={saving || !draft.name.trim()}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {initial.name ? "Save changes" : "Create template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function SettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const usage = useQuery(api.usage.usageStats);
  const brandKits = useQuery(api.brandKits.listBrandKits);
  const templates = useQuery(api.templates.listTemplates);
  const aiStatus = useQuery(api.status.aiStatus);

  const createBrandKit = useMutation(api.brandKits.createBrandKit);
  const updateBrandKit = useMutation(api.brandKits.updateBrandKit);
  const deleteBrandKit = useMutation(api.brandKits.deleteBrandKit);
  const createTemplate = useMutation(api.templates.createTemplate);
  const updateTemplate = useMutation(api.templates.updateTemplate);
  const deleteTemplate = useMutation(api.templates.deleteTemplate);

  const [kitOpen, setKitOpen] = useState(false);
  const [kitEditingId, setKitEditingId] = useState<Id<"brandKits"> | null>(null);
  const [kitInitial, setKitInitial] = useState<KitDraft>({
    name: "",
    primaryColor: "#F97316",
    captionStyle: "pulse",
    aspect: "9:16",
    captionsEnabled: true,
  });
  const [savingKit, setSavingKit] = useState(false);

  const [tplOpen, setTplOpen] = useState(false);
  const [tplEditingId, setTplEditingId] = useState<Id<"templates"> | null>(null);
  const [tplInitial, setTplInitial] = useState<TemplateDraft>({
    name: "",
    emoji: "🎬",
    description: "",
    strategy: "viral",
    durationMs: 30_000,
    aspect: "9:16",
    captionsEnabled: true,
  });
  const [savingTpl, setSavingTpl] = useState(false);

  const openKitDialog = (kit?: NonNullable<typeof brandKits>[number]) => {
    setKitEditingId(kit?._id ?? null);
    setKitInitial(
      kit
        ? {
            name: kit.name,
            primaryColor: kit.primaryColor,
            captionStyle: kit.captionStyle,
            aspect: kit.aspect,
            captionsEnabled: kit.captionsEnabled,
          }
        : { name: "", primaryColor: "#F97316", captionStyle: "pulse", aspect: "9:16", captionsEnabled: true },
    );
    setKitOpen(true);
  };

  const openTemplateDialog = (tpl?: NonNullable<typeof templates>[number]) => {
    setTplEditingId(tpl?._id ?? null);
    setTplInitial(
      tpl
        ? {
            name: tpl.name,
            emoji: tpl.emoji,
            description: tpl.description ?? "",
            strategy: tpl.strategy,
            durationMs: tpl.durationMs,
            aspect: tpl.aspect,
            captionsEnabled: tpl.captionsEnabled,
          }
        : { name: "", emoji: "🎬", description: "", strategy: "viral", durationMs: 30_000, aspect: "9:16", captionsEnabled: true },
    );
    setTplOpen(true);
  };

  const handleSaveKit = async (draft: KitDraft) => {
    setSavingKit(true);
    try {
      if (kitEditingId) {
        await updateBrandKit({ brandKitId: kitEditingId, ...draft });
      } else {
        await createBrandKit(draft);
      }
      setKitOpen(false);
      toast({ title: kitEditingId ? "Brand kit updated" : "Brand kit created" });
    } catch (err) {
      toast({
        title: "Could not save brand kit",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setSavingKit(false);
    }
  };

  const handleSaveTemplate = async (draft: TemplateDraft) => {
    setSavingTpl(true);
    try {
      if (tplEditingId) {
        await updateTemplate({
          templateId: tplEditingId,
          ...draft,
          description: draft.description || undefined,
        });
      } else {
        await createTemplate({ ...draft, description: draft.description || undefined });
      }
      setTplOpen(false);
      toast({ title: tplEditingId ? "Template updated" : "Template created" });
    } catch (err) {
      toast({
        title: "Could not save template",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setSavingTpl(false);
    }
  };

  const storagePct = usage && usage.limits.storageBytes > 0
    ? Math.min(100, (usage.storageBytes / usage.limits.storageBytes) * 100)
    : 0;
  const exportPct = usage && usage.limits.exports > 0
    ? Math.min(100, (usage.exportCount / usage.limits.exports) * 100)
    : 0;

  return (
    <AppShell title="Settings">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Settings</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Usage, brand kits, templates and AI providers.
            </p>
          </div>
          <Badge variant="secondary" className="clay-chip ml-auto gap-1">
            <Sparkles className="size-3 text-primary" />
            {usage?.plan ?? "free"} plan
          </Badge>
        </div>

        <Tabs defaultValue="usage">
          <TabsList className="grid w-full max-w-md grid-cols-4">
            <TabsTrigger value="usage">Usage</TabsTrigger>
            <TabsTrigger value="brandkits">Brand kits</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="providers">Providers</TabsTrigger>
          </TabsList>

          {/* USAGE */}
          <TabsContent value="usage" className="flex flex-col gap-4 pt-4">
            {usage == null ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {[
                    { label: "Storage used", value: formatBytes(usage.storageBytes), icon: <HardDrive className="size-5" />, tint: "clay-peach" },
                    { label: "Videos", value: usage.videoCount, icon: <FileVideo className="size-5" />, tint: "clay-sky" },
                    { label: "Clips generated", value: usage.clipCount, icon: <Scissors className="size-5" />, tint: "clay-mint" },
                    { label: "Exports", value: usage.exportCount, icon: <Clapperboard className="size-5" />, tint: "clay-lilac" },
                  ].map((s) => (
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

                <div className="clay flex flex-col gap-5 p-5">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold">Storage</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatBytes(usage.storageBytes)} / {formatBytes(usage.limits.storageBytes)}
                      </span>
                    </div>
                    <Progress value={storagePct} className="h-3" />
                    <p className="text-[11px] text-muted-foreground">
                      {storagePct >= 90 ? "You're close to the cap — archive projects to free space." : "Uploads and rendered exports count toward storage."}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold">Exports</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {usage.exportCount} / {usage.limits.exports}
                      </span>
                    </div>
                    <Progress value={exportPct} className="h-3" />
                    <p className="text-[11px] text-muted-foreground">
                      Every completed render counts. Renders are computed locally — nothing is queued server-side.
                    </p>
                  </div>
                </div>

                <div className="clay-inset rounded-3xl p-5 text-sm text-muted-foreground">
                  <p className="font-semibold text-foreground">Account</p>
                  <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                    <span>Email: <span className="font-medium text-foreground">{user?.email ?? "—"}</span></span>
                    <span>Plan: <span className="font-medium text-foreground">{usage.plan}</span></span>
                    <span>Projects: <span className="font-medium text-foreground">{usage.projectCount}</span></span>
                    <span>Brand kits: <span className="font-medium text-foreground">{usage.brandKitCount}</span></span>
                    <span>Templates: <span className="font-medium text-foreground">{usage.templateCount}</span></span>
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          {/* BRAND KITS */}
          <TabsContent value="brandkits" className="flex flex-col gap-4 pt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Saved looks applied in the studio — one click sets captions, accent color and aspect.
              </p>
              <Button size="sm" className="clay-press gap-2" onClick={() => openKitDialog()}>
                <Plus className="size-4" /> New kit
              </Button>
            </div>
            {brandKits === undefined ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : brandKits.length === 0 ? (
              <div className="clay-inset flex flex-col items-center gap-3 rounded-3xl p-10 text-center">
                <div className="clay clay-lilac flex size-14 items-center justify-center rounded-full">
                  <Palette className="size-7" />
                </div>
                <p className="font-semibold">No brand kits yet</p>
                <p className="max-w-xs text-sm text-muted-foreground">
                  Create a kit to keep a consistent caption look and frame across every clip.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {brandKits.map((kit) => {
                  const style = getCaptionStyle(kit.captionStyle);
                  return (
                    <div key={kit._id} className="clay flex flex-col gap-3 p-4">
                      <div className="flex items-center gap-2">
                        <span
                          className="clay-inset flex size-9 items-center justify-center rounded-xl"
                          style={{ background: `${kit.primaryColor}22` }}
                        >
                          <span className="size-3.5 rounded-full" style={{ background: kit.primaryColor }} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold">{kit.name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {style.name} · {kit.aspect} · captions {kit.captionsEnabled ? "on" : "off"}
                          </p>
                        </div>
                        <div className="flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => openKitDialog(kit)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive">
                                <Trash2 className="size-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete “{kit.name}”?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Existing clips keep their current captions — this only removes the saved kit.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-white hover:bg-destructive/90"
                                  onClick={async () => {
                                    await deleteBrandKit({ brandKitId: kit._id });
                                    toast({ title: "Brand kit deleted" });
                                  }}
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                      <div className="relative flex aspect-video items-end justify-center overflow-hidden rounded-2xl bg-black/85 p-3">
                        <span
                          className="block rounded-lg px-2 py-1 text-center text-[11px] font-extrabold"
                          style={{
                            fontFamily: style.fontFamily,
                            color: style.color,
                            background: kit.captionsEnabled ? "rgba(0,0,0,0.55)" : "transparent",
                          }}
                        >
                          <span style={{ color: kit.primaryColor }}>
                            {kit.captionsEnabled ? "THIS" : "—"}
                          </span>{" "}
                          is a clip moment
                        </span>
                        <span
                          className="absolute left-2.5 top-2.5 rounded-full px-2 py-0.5 text-[9px] font-bold text-white"
                          style={{ background: kit.primaryColor }}
                        >
                          {kit.aspect}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* TEMPLATES */}
          <TabsContent value="templates" className="flex flex-col gap-4 pt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                One-tap discovery recipes — strategy, target length and output shape.
              </p>
              <Button size="sm" className="clay-press gap-2" onClick={() => openTemplateDialog()}>
                <Plus className="size-4" /> New template
              </Button>
            </div>
            {templates === undefined ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : templates.length === 0 ? (
              <div className="clay-inset flex flex-col items-center gap-3 rounded-3xl p-10 text-center">
                <div className="clay clay-peach flex size-14 items-center justify-center rounded-full">
                  <LayoutTemplate className="size-7" />
                </div>
                <p className="font-semibold">No templates yet</p>
                <p className="max-w-xs text-sm text-muted-foreground">
                  Save a discovery recipe and apply it with one tap from any project.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {templates.map((tpl) => (
                  <div key={tpl._id} className="clay flex flex-col gap-3 p-4">
                    <div className="flex items-center gap-2">
                      <div className="clay-inset flex size-9 items-center justify-center rounded-xl text-lg">
                        {tpl.emoji}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">{tpl.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {STRATEGIES.find((s) => s.id === tpl.strategy)?.label} · {tpl.durationMs / 1000}s · {tpl.aspect}
                        </p>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openTemplateDialog(tpl)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive">
                              <Trash2 className="size-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete “{tpl.name}”?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Existing clips are unaffected — this only removes the saved template.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-white hover:bg-destructive/90"
                                onClick={async () => {
                                  await deleteTemplate({ templateId: tpl._id });
                                  toast({ title: "Template deleted" });
                                }}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                    {tpl.description && (
                      <p className="line-clamp-2 rounded-xl bg-accent/40 px-3 py-2 text-xs text-muted-foreground">
                        {tpl.description}
                      </p>
                    )}
                    <div className="mt-auto flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <Clock className="size-3" /> target {tpl.durationMs / 1000}s
                      <span className="ml-auto">captions {tpl.captionsEnabled ? "on" : "off"}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* PROVIDERS */}
          <TabsContent value="providers" className="flex flex-col gap-4 pt-4">
            <div className="clay flex flex-col gap-3 p-5">
              {[
                {
                  name: "Deepgram",
                  icon: <Mic className="size-5" />,
                  configured: aiStatus?.transcriptionConfigured,
                  env: "DEEPGRAM_API_KEY",
                  unlocks: "Word-level captions, speaker diarization and AI hooks grounded in the transcript.",
                },
                {
                  name: "OpenAI",
                  icon: <Wand2 className="size-5" />,
                  configured: aiStatus?.llmConfigured,
                  env: "OPENAI_API_KEY",
                  unlocks: "AI-generated hook angles, platform titles, hashtags and keywords.",
                },
              ].map((p) => (
                <div key={p.env} className="flex items-center gap-3 rounded-2xl bg-accent/30 p-3">
                  <div className="clay-inset flex size-10 shrink-0 items-center justify-center rounded-xl">
                    {p.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold">{p.name}</p>
                      {p.configured === undefined ? (
                        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                      ) : p.configured ? (
                        <Badge variant="secondary" className="clay-chip gap-1 text-[10px]">
                          <CheckCircle2 className="size-3 text-emerald-600" /> Connected
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-[10px]">
                          <XCircle className="size-3 text-muted-foreground" /> Not configured
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{p.unlocks}</p>
                  </div>
                  <code className="clay-chip hidden bg-background px-2 py-1 font-mono text-[10px] sm:block">
                    {p.env}
                  </code>
                </div>
              ))}
              <div className="rounded-2xl bg-accent/30 p-3 text-xs text-muted-foreground">
                <p className="flex items-center gap-1.5 font-semibold text-foreground">
                  <KeyRound className="size-3.5" /> Where do keys go?
                </p>
                <p className="mt-1">
                  Paste your API keys into the project's <span className="font-semibold">Keys / API keys</span> panel
                  using the env var names above. Clip discovery, trimming, reframing and rendering work without any key —
                  the keys unlock transcription and AI-written copy.
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <KitDialog
        open={kitOpen}
        onOpenChange={setKitOpen}
        initial={kitInitial}
        onSave={handleSaveKit}
        saving={savingKit}
      />
      <TemplateDialog
        open={tplOpen}
        onOpenChange={setTplOpen}
        initial={tplInitial}
        onSave={handleSaveTemplate}
        saving={savingTpl}
      />
    </AppShell>
  );
}
