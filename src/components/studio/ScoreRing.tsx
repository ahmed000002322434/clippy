export function ScoreRing({
  score,
  size = 56,
}: {
  score: number;
  size?: number;
}) {
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const offset = circumference * (1 - clamped / 100);

  const color =
    clamped >= 85
      ? "oklch(0.62 0.16 155)"
      : clamped >= 65
        ? "oklch(0.7 0.14 85)"
        : "oklch(0.72 0.12 40)";

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="oklch(0.42 0.05 60 / 0.12)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: "stroke-dashoffset 0.8s cubic-bezier(0.22,1,0.36,1)",
          }}
        />
      </svg>
      <span
        className="absolute font-extrabold tabular-nums"
        style={{ fontSize: size * 0.28, color }}
      >
        {clamped}
      </span>
    </div>
  );
}
