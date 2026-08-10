import { useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { formatDuration } from "@/lib/video/format";
import { Clapperboard } from "lucide-react";

export interface PreviewableVideo {
  _id: string;
  name: string;
  url: string | null;
  proxyUrl?: string | null;
  durationMs?: number;
  width?: number;
  height?: number;
}

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "Space", action: "Play / pause" },
  { keys: "← / →", action: "Seek 5s" },
  { keys: "J / L", action: "Back 10s / Forward 10s" },
  { keys: "K", action: "Pause" },
  { keys: "M", action: "Mute" },
  { keys: "F", action: "Fullscreen" },
];

/**
 * Reliable browser preview player. Plays the generated proxy when one exists
 * (falling back to the original), with native transport controls plus global
 * keyboard shortcuts (Space, ←/→, J/K/L, M, F).
 */
export function PreviewPlayer({
  video,
  open,
  onOpenChange,
}: {
  video: PreviewableVideo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const src = video?.proxyUrl || video?.url || null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      // Let the native controls handle keys when the video itself is focused,
      // and never hijack typing in inputs.
      if (el === videoRef.current) return;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      const v = videoRef.current;
      if (!v) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          if (v.paused) void v.play().catch(() => undefined);
          else v.pause();
          break;
        case "ArrowLeft":
          e.preventDefault();
          v.currentTime = Math.max(0, v.currentTime - 5);
          break;
        case "ArrowRight":
          e.preventDefault();
          v.currentTime = Math.min(v.duration || 0, v.currentTime + 5);
          break;
        case "j":
        case "J":
          v.currentTime = Math.max(0, v.currentTime - 10);
          break;
        case "k":
        case "K":
          v.pause();
          break;
        case "l":
        case "L":
          v.currentTime = Math.min(v.duration || 0, v.currentTime + 10);
          break;
        case "m":
        case "M":
          v.muted = !v.muted;
          break;
        case "f":
        case "F":
          void v.requestFullscreen?.().catch(() => undefined);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl gap-3 p-0 sm:max-w-4xl">
        <DialogHeader className="sr-only">
          <DialogTitle>Preview {video?.name}</DialogTitle>
          <DialogDescription>Video preview player</DialogDescription>
        </DialogHeader>
        <div className="clay-inset overflow-hidden rounded-t-2xl bg-black">
          {src ? (
            <video
              ref={videoRef}
              src={src}
              controls
              playsInline
              className="mx-auto max-h-[70vh] w-full bg-black"
              poster={video?.proxyUrl ? undefined : undefined}
            />
          ) : (
            <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Clapperboard className="size-5" />
              Preview is not available yet — wait for processing to finish.
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
          <p className="truncate text-sm font-bold">{video?.name}</p>
          {video?.proxyUrl ? (
            <Badge variant="secondary" className="clay-chip text-[10px]">
              Proxy
            </Badge>
          ) : (
            video?.url && (
              <Badge variant="secondary" className="clay-chip text-[10px]">
                Original
              </Badge>
            )
          )}
          {video?.durationMs ? (
            <span className="text-xs text-muted-foreground">
              {formatDuration(video.durationMs)}
              {video.width && video.height
                ? ` · ${video.width}×${video.height}`
                : ""}
            </span>
          ) : null}
          <div className="ml-auto hidden flex-wrap justify-end gap-x-3 gap-y-1 sm:flex">
            {SHORTCUTS.map((s) => (
              <span key={s.keys} className="text-[10px] text-muted-foreground">
                <kbd className="clay-chip rounded-md px-1.5 py-0.5 font-mono text-[9px]">
                  {s.keys}
                </kbd>{" "}
                {s.action}
              </span>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
