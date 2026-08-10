import { cn } from "@/lib/utils";

/**
 * Single source of truth for the official Clippy brand mark.
 * The actual logo asset lives in /public/clippy-logo.svg and is referenced
 * from every surface of the app — navbar, footer, auth, favicon, manifest.
 * Never inline a recreated logo; always go through this component.
 */
export const CLIPPY_LOGO_URL = "/clippy-logo.svg";

export interface ClippyLogoProps {
  /**
   * - "icon"    → mark only (default, 30px)
   * - "compact" → smaller mark (24px)
   * - "full"    → mark + wordmark (34px)
   */
  variant?: "icon" | "compact" | "full";
  /** Pixel size of the mark. Overrides the variant default. */
  size?: number;
  className?: string;
  alt?: string;
  wordmarkClassName?: string;
}

export function ClippyLogo({
  variant = "icon",
  size,
  className,
  alt = "Clippy",
  wordmarkClassName,
}: ClippyLogoProps) {
  const markSize = size ?? (variant === "compact" ? 24 : variant === "full" ? 34 : 30);

  return (
    <span className={cn("inline-flex select-none items-center gap-2", className)}>
      <img
        src={CLIPPY_LOGO_URL}
        alt={alt}
        width={markSize}
        height={markSize}
        draggable={false}
        className="shrink-0 object-contain"
      />
      {variant === "full" && (
        <span className={cn("text-base font-extrabold tracking-tight", wordmarkClassName)}>
          Clippy
        </span>
      )}
    </span>
  );
}
