import { STRATEGIES } from "@/lib/video/scoring";
import type { ClipStrategy } from "@/lib/video/types";
import { cn } from "@/lib/utils";

export function StrategyPicker({
  value,
  onChange,
}: {
  value: ClipStrategy;
  onChange: (s: ClipStrategy) => void;
}) {
  const current = STRATEGIES.find((s) => s.id === value);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {STRATEGIES.map((s) => (
          <button
            key={s.id}
            onClick={() => onChange(s.id)}
            className={cn(
              "clay-press clay-chip flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition-all",
              value === s.id
                ? "bg-primary text-primary-foreground shadow-md"
                : "bg-card text-foreground hover:bg-accent",
            )}
          >
            <span>{s.emoji}</span>
            {s.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{current?.description}</p>
    </div>
  );
}
