import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/AppShell";
import { TrimBar } from "@/components/studio/TrimBar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  buildCaptionLines,
  CAPTION_STYLES,
  drawCaptionLine as drawCaptionLineSafe,
  getCaptionStyle,
} from "@/lib/video/captions";
import { generateHooksHeuristic, generateTitlesHeuristic } from "@/lib/video/hooks";
import { ASPECT_DIMENSIONS, createPreviewDrawer, renderClip } from "@/lib/video/render";
import { uploadToStorage } from "@/lib/upload";
import type { AspectRatio, CaptionStyle } from "@/lib/video/types";
import { formatDuration, formatTimestamp } from "@/lib/video/format";
import { useNavigate, useParams } from "react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Copy,
  Download,
  Loader2,
  Mic,
  Pause,
  Play,
  RefreshCw,
  Scissors,
  Sparkles,
  Square,
  Wand2,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ASPECTS: AspectRatio[] = ["9:16", "1:1", "4:5", "16:9"];
const DURATION_PRESETS = [15_000, 30_000, 45_000, 60_000];

export default function ClipStudioPage() {
  const { clipId } = useParams<{ clipId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const clip = useQuery(
    api.clips.getClip,
    clipId ? { clipId: clipId as Id<"clips"> } : "skip",
  );
  const updateClip = useMutation(api.clips.updateClip);
  const brandKits = useQuery(api.brandKits.listBrandKits);
  const createRenderJob = useMutation(api.renderJobs.createRenderJob);
  const updateRenderJob = useMutation(api.renderJobs.updateRenderJob);
  const generateUploadUrl = useMutation(api.videos.generateUploadUrl);
  const generateHooksAction = useAction(api.ai.generateHooks);

  const [aspect, setAspect] = useState<AspectRatio>("9:16");
  const [startMs, setStartMs] = useState(0);
  const [endMs, setEndMs] = useState(30_000);
  const [currentMs, setCurrentMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [captionStyleId, setCaptionStyleId] = useState("pulse");
  const [brandKitId, setBrandKitId] = useState<string | null>(null);
  const [selectedHook, setSelectedHook] = useState<string | null>(null);
  const [generatingHooks, setGeneratingHooks] = useState(false);
  const [positionOverride, setPositionOverride] = useState<CaptionStyle["position"]>("bottom");

  // render state
  const [rendering, setRendering] = useState(false);
  const [renderPct, setRenderPct] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawerRef = useRef<ReturnType<typeof createPreviewDrawer> | null>(null);

  // sync clip bounds into local state once loaded
  useEffect(() => {
    if (clip && startMs === 0 && endMs === 30_000) {
      setStartMs(clip.startMs);
      setEndMs(clip.endMs);
      setCurrentMs(clip.startMs);
      setAspect(clip.aspect);
      setCaptionsEnabled(clip.captionsEnabled);
      if (clip.captionStyle) setCaptionStyleId(clip.captionStyle);
      setSelectedHook(clip.hook ?? null);
    }
  }, [clip, startMs, endMs]);

  // Brand kit accent color tints the emphasized caption words when active
  const activeBrandKit = brandKits?.find((k) => k._id === brandKitId) ?? null;
  const captionStyle: CaptionStyle = useMemo(
    () => ({
      ...getCaptionStyle(captionStyleId),
      position: positionOverride,
      ...(activeBrandKit
        ? { highlightColor: activeBrandKit.primaryColor }
        : {}),
    }),
    [captionStyleId, positionOverride, activeBrandKit],
  );

  const captionLines = useMemo(
    () => buildCaptionLines(clip?.transcript ?? null),
    [clip?.transcript],
  );

  const activeLineAt = useCallback(
    (t: number) => {
      if (!captionLines.length) return null;
      const line = captionLines.find((l) => t >= l.startMs && t <= l.endMs);
      if (!line) return null;
      return {
        draw: (c: CanvasRenderingContext2D, time: number) =>
          drawCaptionLineSafe(c, line, time, captionStyle),
      };
    },
    [captionLines, captionStyle],
  );

  // Rebuild preview drawer when visuals change
  useEffect(() => {
    if (!canvasRef.current || !videoRef.current) return;
    drawerRef.current = createPreviewDrawer(canvasRef.current, videoRef.current, {
      signals: clip?.videoSignals ?? null,
      captionsEnabled,
      captionStyle,
      activeLineAt,
      aspect,
    });
  }, [aspect, captionsEnabled, captionStyle, activeLineAt, clip?.videoSignals]);

  const draw = useCallback((t: number) => {
    drawerRef.current?.(t);
  }, []);

  const stopPlayback = useCallback(() => {
    setPlaying(false);
    videoRef.current?.pause();
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || !clip) return;
    if (playing) {
      stopPlayback();
      return;
    }
    const t = video.currentTime * 1000;
    if (t < startMs || t >= endMs) video.currentTime = startMs / 1000;
    setCurrentMs(startMs);
    void video.play();
    setPlaying(true);
  }, [playing, clip, startMs, endMs, stopPlayback]);

  // preview render loop
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let lastUi = 0;
    const loop = () => {
      const video = videoRef.current;
      if (video) {
        const t = video.currentTime * 1000;
        draw(t);
        if (t >= endMs) {
          stopPlayback();
          return;
        }
        const now = performance.now();
        if (now - lastUi > 100) {
          lastUi = now;
          setCurrentMs(t);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, draw, endMs, stopPlayback]);

  // scrub without playback
  const handleSeek = useCallback(
    (ms: number) => {
      const video = videoRef.current;
      const clamped = Math.max(0, Math.min(ms, (clip?.videoDurationMs ?? ms)));
      setCurrentMs(clamped);
      if (video && Number.isFinite(clamped / 1000)) {
        video.currentTime = clamped / 1000;
      }
      draw(clamped);
    },
    [clip?.videoDurationMs, draw],
  );

  const handleTrim = useCallback(
    (s: number, e: number) => {
      setStartMs(s);
      setEndMs(e);
      const video = videoRef.current;
      if (video) {
        const t = video.currentTime * 1000;
        if (t < s || t > e) {
          video.currentTime = s / 1000;
          setCurrentMs(s);
          draw(s);
        }
      }
    },
    [draw],
  );

  const commitTrim = useCallback(
    (s: number, e: number) => {
      if (!clip) return;
      void updateClip({
        clipId: clip._id,
        startMs: s,
        endMs: e,
      });
    },
    [clip, updateClip],
  );

  const handleAspect = (a: AspectRatio) => {
    setAspect(a);
    if (clip) void updateClip({ clipId: clip._id, aspect: a });
  };

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      }
      if (e.code === "ArrowLeft") {
        e.preventDefault();
        handleSeek(Math.max(0, currentMs - 5000));
      }
      if (e.code === "ArrowRight") {
        e.preventDefault();
        handleSeek(currentMs + 5000);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, handleSeek, currentMs]);

  // cleanup render on unmount
  useEffect(() => () => abortRef.current?.abort(), []);

  if (clip === undefined) {
    return (
      <AppShell>
        <div className="flex min-h-64 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  if (clip === null) {
    return (
      <AppShell>
        <div className="clay mx-auto max-w-md p-8 text-center">
          <p className="font-semibold">Clip not found</p>
          <Button className="mt-4" onClick={() => navigate("/dashboard")}>
            Back to projects
          </Button>
        </div>
      </AppShell>
    );
  }

  // hooks + titles
  const hooks =
    clip.hooks && clip.hooks.length > 0
      ? clip.hooks
      : generateHooksHeuristic(clip.transcript?.text ?? "", clip.strategy);
  const titles = clip.titles ?? generateTitlesHeuristic(clip.transcript?.text ?? "", clip.strategy);

  const handleGenerateHooks = async () => {
    setGeneratingHooks(true);
    try {
      const pack = await generateHooksAction({ videoId: clip.videoId, strategy: clip.strategy });
      if (pack && pack.hooks?.length) {
        await updateClip({
          clipId: clip._id,
          hooks: pack.hooks,
          titles: pack.titles,
        });
        toast({ title: "AI hooks generated", description: "Fresh hooks & platform titles are ready." });
      } else {
        toast({
          title: "AI provider not configured",
          description: "Add OPENAI_API_KEY to generate with AI — using heuristic hooks for now.",
        });
      }
    } catch {
      toast({
        title: "Could not generate AI hooks",
        description: "Using heuristic hooks instead.",
        variant: "destructive",
      });
    } finally {
      setGeneratingHooks(false);
    }
  };

  const handleRender = async () => {
    if (!clip.videoUrl || rendering) return;
    setRendering(true);
    setRenderPct(0);
    setRenderError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const jobId = await createRenderJob({
        clipId: clip._id,
        format: "mp4/webm",
        resolution: ASPECT_DIMENSIONS[aspect].width >= 1920 ? "1080p" : "1080p",
      });
      let lastPatch = 0;
      const result = await renderClip(
        clip.videoUrl,
        startMs,
        endMs,
        clip.transcript ?? null,
        clip.videoSignals ?? null,
        {
          aspect,
          captionsEnabled,
          captionStyle,
          fps: 30,
          signal: controller.signal,
          onProgress: (pct) => {
            setRenderPct(pct);
            if (pct - lastPatch >= 10 || pct === 99) {
              lastPatch = pct;
              void updateRenderJob({ jobId, status: "rendering", progress: pct });
            }
          },
        },
      );
      const fileName = `clippy-${clip._id.slice(0, 6)}.${result.extension}`;
      const file = new File([result.blob], fileName, { type: result.mimeType });
      const { storageId } = await uploadToStorage(file, generateUploadUrl, {
        onProgress: () => setRenderPct(97),
      });
      await updateRenderJob({
        jobId,
        status: "completed",
        progress: 100,
        storageId: storageId as Id<"_storage">,
      });
      setRenderPct(100);
      toast({ title: "Export complete", description: "Your clip has been rendered and saved." });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setRenderError("Render cancelled");
      } else {
        const message = err instanceof Error ? err.message : "Render failed";
        setRenderError(message);
        toast({ title: "Render failed", description: message, variant: "destructive" });
      }
    } finally {
      setRendering(false);
      abortRef.current = null;
    }
  };

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() =>
      toast({ title: "Copied to clipboard" }),
    );
  };

  const clipDuration = endMs - startMs;

  return (
    <AppShell title={clip.videoName}>
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        {/* header */}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/projects/${clip.projectId}`)}>
            <ArrowLeft className="size-5" />
          </Button>
          <div>
            <h1 className="text-lg font-bold leading-tight">{clip.videoName}</h1>
            <p className="text-xs text-muted-foreground">
              Clip {formatTimestamp(clip.startMs)} → {formatTimestamp(clip.endMs)} · {formatDuration(clipDuration)}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="secondary" className="clay-chip gap-1">
              <Zap className="size-3 text-primary" /> {clip.score}/100
            </Badge>
            {clip.status === "ready" && (
              <Badge variant="secondary" className="clay-chip gap-1">
                <BadgeCheck className="size-3 text-emerald-600" /> Exported
              </Badge>
            )}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          {/* LEFT: player */}
          <div className="flex flex-col gap-3">
            <div className="clay flex justify-center p-3">
              <div
                className="relative overflow-hidden rounded-2xl bg-black"
                style={{ width: "100%", maxWidth: 460, aspectRatio: ASPECT_DIMENSIONS[aspect].width / ASPECT_DIMENSIONS[aspect].height }}
              >
                <video
                  ref={videoRef}
                  src={clip.videoUrl ?? undefined}
                  preload="auto"
                  playsInline
                  className="absolute inset-0 h-full w-full opacity-0"
                />
                <canvas ref={canvasRef} className="h-full w-full" />
                {!playing && (
                  <button
                    onClick={togglePlay}
                    className="clay-press absolute inset-0 flex items-center justify-center bg-black/20"
                    title="Play (Space)"
                  >
                    <div className="clay flex size-16 items-center justify-center rounded-full">
                      <Play className="ml-1 size-8" fill="currentColor" />
                    </div>
                  </button>
                )}
              </div>
            </div>

            {/* transport */}
            <div className="clay flex flex-wrap items-center justify-center gap-2 px-4 py-3">
              <Button variant="ghost" size="icon-sm" onClick={() => handleSeek(currentMs - 5000)} title="Back 5s">
                <ArrowLeft className="size-4" />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                className="clay-press size-12 rounded-full"
                onClick={togglePlay}
                title="Play/Pause (Space)"
              >
                {playing ? <Pause className="size-5" fill="currentColor" /> : <Play className="ml-0.5 size-5" fill="currentColor" />}
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => handleSeek(currentMs + 5000)} title="Forward 5s">
                <ArrowRight className="size-4" />
              </Button>
              <span className="clay-chip bg-background px-3 py-1 text-xs font-semibold tabular-nums">
                {formatTimestamp(currentMs)} / {formatTimestamp(clipDuration)}
              </span>
              {/* aspect switcher */}
              <div className="ml-2 flex gap-1">
                {ASPECTS.map((a) => (
                  <button
                    key={a}
                    onClick={() => handleAspect(a)}
                    className={cn(
                      "clay-press clay-chip rounded-full px-2.5 py-1 text-[11px] font-bold",
                      aspect === a ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent",
                    )}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>

            {/* trim bar */}
            {clip.videoSignals ? (
              <div className="clay p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Trim · {formatDuration(clipDuration)}
                  </span>
                  <div className="flex gap-1">
                    {DURATION_PRESETS.map((d) => (
                      <button
                        key={d}
                        onClick={() => {
                          const s = startMs;
                          const e = s + d;
                          handleTrim(s, Math.min(e, clip.videoDurationMs || e));
                          commitTrim(s, Math.min(e, clip.videoDurationMs || e));
                        }}
                        className={cn(
                          "clay-press clay-chip rounded-full px-2 py-0.5 text-[10px] font-bold",
                          Math.abs(clipDuration - d) < 1500 ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent",
                        )}
                      >
                        {d / 1000}s
                      </button>
                    ))}
                    <button
                      onClick={() => {
                        // snap to nearest pause/scene boundary — real AI trim assist
                        const signals = clip.videoSignals;
                        const around = startMs;
                        let best = startMs;
                        let bestDist = Infinity;
                        for (const sc of signals?.scenes ?? []) {
                          const d = Math.abs(sc - around);
                          if (d < bestDist && d < 6000) { bestDist = d; best = sc; }
                        }
                        for (const p of signals?.pauses ?? []) {
                          const d = Math.abs(p.startMs - around);
                          if (d < bestDist && d < 6000) { bestDist = d; best = p.startMs; }
                        }
                        handleTrim(best, endMs);
                        commitTrim(best, endMs);
                      }}
                      className="clay-press clay-chip flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold hover:bg-accent"
                      title="Snap start to nearest scene/pause"
                    >
                      <Scissors className="size-3" /> Snap start
                    </button>
                  </div>
                </div>
                <TrimBar
                  signals={clip.videoSignals}
                  startMs={startMs}
                  endMs={endMs}
                  currentMs={currentMs}
                  onSeek={handleSeek}
                  onTrim={(s, e) => handleTrim(s, e)}
                />
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">Full video: {formatTimestamp(clip.videoDurationMs)}</span>
                  <button
                    className="text-[10px] font-semibold text-primary underline underline-offset-2"
                    onClick={() => {
                      const clip2 = clip;
                      void updateClip({ clipId: clip2._id, startMs, endMs });
                    }}
                    title="Save trim"
                  >
                    Save trim
                  </button>
                </div>
              </div>
            ) : (
              <div className="clay p-3 text-sm text-muted-foreground">
                No waveform available — this clip was created without signal analysis.
              </div>
            )}

            {/* reasons */}
            <div className="clay p-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Why the AI picked this moment
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {clip.reasons.map((r) => (
                  <li key={r} className="clay-chip bg-background px-2.5 py-1 text-xs font-medium">
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* RIGHT: control panel */}
          <div className="flex flex-col">
            <div className="clay flex-1 p-3">
              <Tabs defaultValue="clip">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="clip">Clip</TabsTrigger>
                  <TabsTrigger value="captions">Captions</TabsTrigger>
                  <TabsTrigger value="hooks">Hook</TabsTrigger>
                  <TabsTrigger value="export">Export</TabsTrigger>
                </TabsList>

                {/* CLIP TAB */}
                <TabsContent value="clip" className="flex flex-col gap-4 pt-4">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1 text-xs font-semibold">
                      Start
                      <input
                        type="text"
                        value={formatTimestamp(startMs)}
                        onChange={() => undefined}
                        className="clay-inset rounded-xl px-3 py-2 text-sm font-medium"
                        disabled
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-semibold">
                      End
                      <input
                        type="text"
                        value={formatTimestamp(endMs)}
                        onChange={() => undefined}
                        className="clay-inset rounded-xl px-3 py-2 text-sm font-medium"
                        disabled
                      />
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Drag the handles on the waveform to trim. Length:{" "}
                    <span className="font-semibold text-foreground">{formatDuration(clipDuration)}</span>
                  </p>
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Aspect ratio</p>
                    <div className="grid grid-cols-4 gap-2">
                      {ASPECTS.map((a) => (
                        <button
                          key={a}
                          onClick={() => handleAspect(a)}
                          className={cn(
                            "clay-press rounded-2xl border p-3 text-center",
                            aspect === a ? "border-primary bg-primary/10" : "border-transparent bg-background hover:bg-accent",
                          )}
                        >
                          <div
                            className="mx-auto mb-1.5 rounded bg-foreground/80"
                            style={{
                              width: a === "9:16" ? 10 : a === "1:1" ? 16 : a === "4:5" ? 13 : 24,
                              height: a === "9:16" ? 18 : a === "1:1" ? 16 : a === "4:5" ? 16 : 14,
                            }}
                          />
                          <span className="text-[10px] font-bold">{a}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </TabsContent>

                {/* CAPTIONS TAB */}
                <TabsContent value="captions" className="flex flex-col gap-4 pt-4">
                  {brandKits && brandKits.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Brand kit
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {brandKits.map((kit) => (
                          <button
                            key={kit._id}
                            onClick={() => {
                              const next = brandKitId === kit._id ? null : kit._id;
                              setBrandKitId(next);
                              if (next) {
                                setCaptionStyleId(kit.captionStyle);
                                setAspect(kit.aspect);
                                setCaptionsEnabled(kit.captionsEnabled);
                                void updateClip({
                                  clipId: clip._id,
                                  captionStyle: kit.captionStyle,
                                  aspect: kit.aspect,
                                  captionsEnabled: kit.captionsEnabled,
                                });
                              }
                            }}
                            className={cn(
                              "clay-press clay-chip flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all",
                              brandKitId === kit._id
                                ? "bg-primary text-primary-foreground shadow-md"
                                : "bg-background hover:bg-accent",
                            )}
                          >
                            <span
                              className="size-2.5 rounded-full"
                              style={{ background: kit.primaryColor }}
                            />
                            {kit.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {!clip.transcript ? (
                    <div className="clay-inset rounded-2xl p-5 text-center">
                      <Mic className="mx-auto mb-2 size-6 text-muted-foreground" />
                      <p className="text-sm font-semibold">No transcript yet</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Captions need word-level transcription. Run “Transcribe” on the project page
                        (requires a <code className="font-mono">DEEPGRAM_API_KEY</code>).
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">Captions</span>
                        <Switch
                          checked={captionsEnabled}
                          onCheckedChange={(v) => {
                            setCaptionsEnabled(v);
                            if (clip) void updateClip({ clipId: clip._id, captionsEnabled: v });
                          }}
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Style</p>
                        <div className="grid grid-cols-2 gap-2">
                          {CAPTION_STYLES.map((s) => (
                            <button
                              key={s.id}
                              onClick={() => {
                                setCaptionStyleId(s.id);
                                if (clip) void updateClip({ clipId: clip._id, captionStyle: s.id });
                              }}
                              className={cn(
                                "clay-press rounded-2xl border p-3 text-left transition-all",
                                captionStyleId === s.id ? "border-primary bg-primary/10" : "border-transparent bg-background hover:bg-accent",
                              )}
                            >
                              <span
                                className="block overflow-hidden rounded-lg px-2 py-1 text-[13px] font-bold text-white"
                                style={{
                                  fontFamily: s.fontFamily,
                                  textShadow: "0 1px 2px rgba(0,0,0,0.6)",
                                  background: s.backgroundColor ?? "rgba(0,0,0,0.4)",
                                }}
                              >
                                {s.name}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Position</p>
                        <Select
                          value={positionOverride}
                          onValueChange={(v) => setPositionOverride(v as CaptionStyle["position"])}
                        >
                          <SelectTrigger className="clay-inset border-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="bottom">Bottom</SelectItem>
                            <SelectItem value="middle">Middle</SelectItem>
                            <SelectItem value="top">Top</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Emphasized words are chosen semantically — cue words and rare, high-signal terms
                        get highlighted, never random words.
                      </p>
                    </>
                  )}
                </TabsContent>

                {/* HOOK TAB */}
                <TabsContent value="hooks" className="flex flex-col gap-3 pt-4">
                  <Button
                    variant="secondary"
                    className="clay-press self-start gap-2"
                    disabled={generatingHooks}
                    onClick={handleGenerateHooks}
                  >
                    {generatingHooks ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                    Generate hooks
                  </Button>
                  {!clip.transcript ? (
                    <p className="text-xs text-muted-foreground">
                      Hooks are derived from the transcript. Transcribe the video first.
                    </p>
                  ) : (
                    <>
                      <div className="flex flex-col gap-2">
                        {hooks.map((h: { label: string; text: string }) => (
                          <button
                            key={h.label}
                            onClick={() => {
                              setSelectedHook(h.text);
                              void updateClip({ clipId: clip._id, hook: h.text });
                            }}
                            className={cn(
                              "clay-press rounded-2xl border p-3 text-left transition-all",
                              selectedHook === h.text
                                ? "border-primary bg-primary/10"
                                : "border-transparent bg-background hover:bg-accent",
                            )}
                          >
                            <span className="text-[10px] font-bold uppercase tracking-wide text-primary">{h.label}</span>
                            <p className="mt-1 text-sm font-medium">{h.text}</p>
                          </button>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-col gap-2">
                        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Platform titles</p>
                        {[
                          { label: "YouTube Shorts", value: titles.shorts },
                          { label: "TikTok", value: titles.tiktok },
                          { label: "Instagram", value: titles.instagram },
                        ].map((t) => (
                          <div key={t.label} className="clay-inset flex items-center gap-2 rounded-xl px-3 py-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-bold uppercase text-muted-foreground">{t.label}</p>
                              <p className="truncate text-sm">{t.value}</p>
                            </div>
                            <Button variant="ghost" size="icon-sm" onClick={() => copy(t.value)}>
                              <Copy className="size-3.5" />
                            </Button>
                          </div>
                        ))}
                        <div className="flex flex-wrap items-center gap-1.5">
                          {(titles.hashtags ?? []).slice(0, 6).map((tag: string) => (
                            <span key={tag} className="clay-chip bg-accent px-2 py-1 text-[11px] font-semibold text-accent-foreground">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </TabsContent>

                {/* EXPORT TAB */}
                <TabsContent value="export" className="flex flex-col gap-4 pt-4">
                  <div className="clay-inset rounded-2xl p-4 text-sm">
                    <p className="font-semibold">Render settings</p>
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                      <li>• {ASPECT_DIMENSIONS[aspect].width}×{ASPECT_DIMENSIONS[aspect].height} · 1080p</li>
                      <li>• H.264/VP9 + AAC/Opus · 30 fps</li>
                      <li>• Captions {captionsEnabled ? "on" : "off"} · {captionStyle.name} style</li>
                      <li>• Smart reframing {clip.videoSignals ? "on (content-aware)" : "off (center crop)"}</li>
                    </ul>
                    <p className="mt-3 rounded-xl bg-accent/50 px-3 py-2 text-[11px] text-muted-foreground">
                      Renders locally in your browser in real time — you watch the progress bar as the
                      frames are composed. The result is saved to your project.
                    </p>
                  </div>

                  {renderError && (
                    <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">{renderError}</p>
                  )}

                  {rendering ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span className="flex items-center gap-1.5">
                          <Loader2 className="size-4 animate-spin" /> Rendering…
                        </span>
                        <span>{renderPct}%</span>
                      </div>
                      <Progress value={renderPct} className="h-3" />
                      <Button variant="ghost" size="sm" className="gap-1 text-destructive" onClick={() => abortRef.current?.abort()}>
                        <Square className="size-3.5" /> Cancel render
                      </Button>
                    </div>
                  ) : clip.renderUrl ? (
                    <div className="flex flex-col gap-2">
                      <video src={clip.renderUrl} controls className="w-full rounded-2xl bg-black" />
                      <div className="flex gap-2">
                        <Button variant="secondary" className="clay-press flex-1 gap-2" onClick={() => handleRender()}>
                          <RefreshCw className="size-4" /> Re-render
                        </Button>
                        <Button className="clay-press flex-1 gap-2" asChild>
                          <a href={clip.renderUrl} download>
                            <Download className="size-4" /> Download
                          </a>
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button size="lg" className="clay-press gap-2" onClick={handleRender}>
                      <Sparkles className="size-5" />
                      Render clip
                    </Button>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}


