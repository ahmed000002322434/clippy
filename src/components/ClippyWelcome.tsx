import { ClippyLogo } from "@/components/ClippyLogo";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Session key — the welcome animation plays at most once per browser tab/session.
 * A page refresh or SPA navigation keeps the flag, so the animation never replays
 * mid-visit. A brand-new tab/session has fresh sessionStorage and may play it again.
 */
export const CLIPPY_WELCOME_SESSION_KEY = "clippyWelcomeShown";

/** Self-hosted copy of the generated 8s Clippy intro (2.1 MB, served from /public). */
export const CLIPPY_WELCOME_VIDEO_URL = "/clippy-welcome.mp4";

/** Remote fallback (Streamable) in case the self-hosted file is unavailable. */
export const CLIPPY_WELCOME_VIDEO_FALLBACK_URL =
  "https://cdn-cf-east.streamable.com/video/mp4/tqqc4p.mp4?Expires=1786611327126&Key-Pair-Id=APKAIEYUVEN4EVB2OKEQ&Signature=CIvR4HdYIh~YDP02yZSH2I0vJXNuRdyo81mB9ajHR4lx11SZleYtIj53Hpoh6AKaqL0p-Hy3IjKo3Fd7JEqemA1HsXwObLwemJjd0hNPzQpk5vgnjDvyl7sxXs2osF6k6RY0F2~1ornOOCsXSH6xa3QSLkwPvtld2qFZgd6mADkye6HPncoZmzFpMQBArlUQaXxuQD6VFRo8tmWjAYRp2nWe~0GyxEYgtUFp5x1O9NwX0PbFzJWptuAWYvX3dAbe3mZA-ZixZGEyRPSVFPaFRPzTTYH0DQk2wmQj6a3xx~bqofjNSI302G4vFS~C7hWyqAU6wyqaLNMp9q2QYPOOCQ__";

/** How long the static logo is shown for reduced-motion users. */
const REDUCED_MOTION_HOLD_MS = 1400;
/** Overlay fade-out duration. */
const FADE_MS = 650;
/** Absolute safety valve — the app must never be stuck behind the intro. */
const SAFETY_TIMEOUT_MS = 12000;

type Phase = "playing" | "static" | "fading" | "done";

function hasShownWelcome(): boolean {
  try {
    return window.sessionStorage.getItem(CLIPPY_WELCOME_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function markWelcomeShown(): void {
  try {
    window.sessionStorage.setItem(CLIPPY_WELCOME_SESSION_KEY, "1");
  } catch {
    /* storage unavailable — treat as best-effort */
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function initialPhase(): Phase {
  if (hasShownWelcome()) return "done";
  return prefersReducedMotion() ? "static" : "playing";
}

/**
 * Full-screen brand intro, mounted once at the very top of the application so it
 * is independent of routing — SPA navigation can never replay it. The app mounts
 * and renders behind the overlay (content stays crawlable); the overlay is purely
 * a visual presentation layer that fades out and unmounts.
 */
export function ClippyWelcome({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const finishedRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    markWelcomeShown();
    setPhase("done");
  };

  // Phase timers: reduced-motion hold, playback safety valve, and fade-out.
  useEffect(() => {
    if (phase === "done") return;
    let timer = 0;
    if (phase === "static") {
      timer = window.setTimeout(finish, REDUCED_MOTION_HOLD_MS);
    } else if (phase === "playing") {
      timer = window.setTimeout(finish, SAFETY_TIMEOUT_MS);
    } else if (phase === "fading") {
      timer = window.setTimeout(() => setPhase("done"), FADE_MS);
    }
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Kick off playback once the video element is mounted; autoplay rejection
  // (e.g. browser blocking) falls back gracefully to the app.
  useEffect(() => {
    if (phase !== "playing") return;
    const video = videoRef.current;
    if (!video) return;
    const playPromise = video.play();
    playPromise?.catch(() => finish());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  if (phase === "done") return <>{children}</>;

  const showVideo = phase === "playing";

  return (
    <>
      <div
        aria-hidden="true"
        className={cn(
          "fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-[var(--background)]",
          "transition-opacity duration-[650ms] ease-out",
          phase === "fading" && "pointer-events-none opacity-0",
        )}
      >
        {showVideo ? (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            preload="auto"
            disablePictureInPicture
            disableRemotePlayback
            controls={false}
            tabIndex={-1}
            aria-hidden="true"
            className="h-full max-h-[86vh] w-full max-w-[96vw] object-contain"
            onEnded={() => {
              markWelcomeShown();
              setPhase("fading");
            }}
            onError={() => finish()}
          >
            {/* Self-hosted copy first; remote Streamable source as fallback. */}
            <source src={CLIPPY_WELCOME_VIDEO_URL} type="video/mp4" />
            <source src={CLIPPY_WELCOME_VIDEO_FALLBACK_URL} type="video/mp4" />
          </video>
        ) : (
          <div className="flex flex-col items-center gap-5 px-6">
            <ClippyLogo size={120} alt="Clippy" />
          </div>
        )}
      </div>
      {children}
    </>
  );
}
