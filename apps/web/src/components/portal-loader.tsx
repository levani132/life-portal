/**
 * The boot loader: the app's own mark, animated.
 *
 * The logo is a portal ring that doubles as a progress gauge (see `public/icon.svg`), so the
 * loading state is that same drawing with the gauge actually moving — it sweeps to 100%, holds for
 * a beat, then empties in the same clockwise direction and repeats, so it laps the ring rather than
 * rewinding. Nothing here reports real progress: the boot is one
 * `/auth/me` round trip with no measurable stages, and a percentage readout would be a number the
 * app cannot stand behind.
 *
 * The keyframes live in `global.css` (`.portal-sweep`, `.portal-bar`), which is also where they are
 * switched off under `prefers-reduced-motion`.
 */
export function PortalLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    // A boot state has nothing else on the page, so it takes the whole viewport and centres in it.
    // `100dvh`, not `100vh`: with browser chrome visible the mark otherwise sits low enough to look
    // accidental rather than centred.
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-6 px-6 py-10">
      <PortalMark />
      <p className="text-sm text-ink-muted">{label}</p>
    </div>
  );
}

/** The animated mark on its own, for a caller that supplies its own layout. */
export function PortalMark({ size = 88 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      role="img"
      aria-label="Loading"
      className="shrink-0"
    >
      {/* The gauge track, and the arc that fills it. r=150 → circumference 942.5, which is the dash
          length the keyframes count up to. Rotated so 0% starts at twelve o'clock. */}
      <circle cx="256" cy="256" r="150" fill="none" stroke="rgb(var(--border))" strokeWidth="34" />
      <circle
        cx="256"
        cy="256"
        r="150"
        fill="none"
        className="portal-sweep stroke-sky-400"
        strokeWidth="34"
        strokeLinecap="round"
      />
      {/* The three rising bars, breathing in sequence behind the ring. */}
      <g className="fill-emerald-400">
        <rect x="188" y="286" width="34" height="62" rx="14" className="portal-bar" />
        <rect x="239" y="248" width="34" height="100" rx="14" className="portal-bar [animation-delay:160ms]" />
        <rect x="290" y="200" width="34" height="148" rx="14" className="portal-bar [animation-delay:320ms]" />
      </g>
    </svg>
  );
}
