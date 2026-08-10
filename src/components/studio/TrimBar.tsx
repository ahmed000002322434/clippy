import type { AnalysisSignals } from "@/lib/video/types";
import { useMemo, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Clickable energy waveform with draggable trim handles.
 * All coordinates are absolute ms in the source video.
 */
export function TrimBar({
  signals,
  startMs,
  endMs,
  currentMs,
  onSeek,
  onTrim,
}: {
  signals: AnalysisSignals;
  startMs: number;
  endMs: number;
  currentMs: number;
  onSeek: (ms: number) => void;
  onTrim: (startMs: number, endMs: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<null | "start" | "end" | "seek">(null);

  const bars = useMemo(() => {
    const { energy, windowMs } = signals;
    const N = 140;
    const out: { x: number; h: number; voiced: boolean }[] = [];
    const step = Math.max(1, Math.floor(energy.length / N));
    for (let i = 0; i < energy.length; i += step) {
      out.push({
        x: i * windowMs,
        h: Math.max(0.04, energy[i] ?? 0.02),
        voiced: signals.voiced[i] ?? false,
      });
    }
    return out;
  }, [signals]);

  const duration = signals.durationMs;

  const xToMs = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return pct * duration;
  };

  const onPointerDown = (e: React.PointerEvent, kind: "start" | "end" | "seek") => {
    e.preventDefault();
    dragging.current = kind;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const ms = xToMs(e.clientX);
    if (kind === "seek") onSeek(ms);
    if (kind === "start") onTrim(Math.max(0, Math.min(ms, endMs - 2000)), endMs);
    if (kind === "end") onTrim(startMs, Math.min(duration, Math.max(ms, startMs + 2000)));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || dragging.current === "seek") return;
    const ms = xToMs(e.clientX);
    if (dragging.current === "start") {
      onTrim(Math.max(0, Math.min(ms, endMs - 2000)), endMs);
    } else {
      onTrim(startMs, Math.min(duration, Math.max(ms, startMs + 2000)));
    }
  };

  const onPointerUp = () => {
    dragging.current = null;
  };

  const rangePct = duration > 0 ? ((endMs - startMs) / duration) * 100 : 0;
  const startPct = duration > 0 ? (startMs / duration) * 100 : 0;
  const currentPct = duration > 0 ? (currentMs / duration) * 100 : 0;

  return (
    <div
      ref={barRef}
      className="relative h-20 w-full touch-none select-none"
      onPointerDown={(e) => onPointerDown(e, "seek")}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="clay-inset flex h-full w-full items-end gap-px overflow-hidden rounded-2xl px-1 py-1.5">
        {bars.map((b, i) => (
          <div
            key={i}
            className="flex-1 rounded-full"
            style={{
              height: `${Math.max(8, b.h * 100)}%`,
              background: b.voiced
                ? "oklch(0.7 0.13 35 / 0.8)"
                : "oklch(0.7 0.03 70 / 0.25)",
            }}
          />
        ))}
      </div>

      {/* selection range */}
      <div
        className="pointer-events-none absolute inset-y-0 rounded-2xl bg-primary/15 ring-2 ring-primary/60"
        style={{ left: `${startPct}%`, width: `${rangePct}%` }}
      />

      {/* playhead */}
      <div
        className="pointer-events-none absolute inset-y-0 w-0.5 bg-foreground"
        style={{ left: `${currentPct}%` }}
      />

      {/* start handle */}
      <button
        className={cn(
          "clay absolute top-1/2 z-10 flex h-9 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground",
        )}
        style={{ left: `${startPct}%` }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onPointerDown(e, "start");
        }}
        title="Drag to trim start"
      >
        <div className="h-4 w-0.5 rounded-full bg-current" />
      </button>
      {/* end handle */}
      <button
        className="clay absolute top-1/2 z-10 flex h-9 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground"
        style={{ left: `${endPct(duration, endMs)}%` }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onPointerDown(e, "end");
        }}
        title="Drag to trim end"
      >
        <div className="h-4 w-0.5 rounded-full bg-current" />
      </button>
    </div>
  );
}

function endPct(duration: number, endMs: number): number {
  return duration > 0 ? (endMs / duration) * 100 : 0;
}
