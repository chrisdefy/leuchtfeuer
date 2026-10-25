/**
 * The Leuchtfeuer mark: a light, its beam and the horizon, the way through in the dark.
 * Theme colors, so it fits light and dark. `id` keeps the gradient unique when the mark is on screen twice.
 */
export function BeaconMark({ size, id, className }: { size: number; id: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-beam`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="var(--out)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--in)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="beacon-beam" d="M10 14 29 6.5V21.5Z" fill={`url(#${id}-beam)`} />
      <path
        className="beacon-horizon"
        d="M4 24.5c4-1.6 8-1.6 12 0s8 1.6 12 0"
        stroke="var(--in)"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        pathLength={1}
      />
      <circle className="beacon-light" cx="10" cy="14" r="3.2" fill="var(--ink)" />
      <circle className="beacon-core" cx="10" cy="14" r="1.5" fill="var(--out)" />
    </svg>
  );
}
