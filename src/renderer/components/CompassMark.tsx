interface Props {
  size?: number;
  className?: string;
}

/**
 * Modern boat helm (steering wheel): 8 spokes, cylindrical handle knobs,
 * outer rim, and a layered center boss — all stroked/filled in --accent.
 */
export function HelmMark({ size = 64, className }: Props) {
  // 8 evenly-spaced spokes starting from 12-o'clock, rotating clockwise.
  // SVG y-axis points down, so: x = cx + r·sin(θ), y = cy − r·cos(θ)
  const spokes = Array.from({ length: 8 }, (_, i) => {
    const θ = (i * Math.PI * 2) / 8;
    const sin = Math.sin(θ);
    const cos = Math.cos(θ);
    const p = (r: number) => ({ x: +(32 + r * sin).toFixed(2), y: +(32 - r * cos).toFixed(2) });
    return { inner: p(7.5), outer: p(21), knob: p(24.5) };
  });

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ color: 'var(--accent)' }}
      aria-hidden
    >
      {/* ── Outer rim ── */}
      <circle cx="32" cy="32" r="22" stroke="currentColor" strokeWidth="2.5" />

      {/* ── Spokes ── */}
      {spokes.map((s, i) => (
        <line
          key={i}
          x1={s.inner.x} y1={s.inner.y}
          x2={s.outer.x} y2={s.outer.y}
          stroke="currentColor"
          strokeWidth="1.75"
        />
      ))}

      {/* ── Handle knobs (cylindrical grips at spoke tips) ── */}
      {spokes.map((s, i) => (
        <circle
          key={i}
          cx={s.knob.x}
          cy={s.knob.y}
          r="2.8"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="1"
          strokeOpacity="0.35"
        />
      ))}

      {/* ── Hub boss — outer raised ring ── */}
      <circle cx="32" cy="32" r="8.5" stroke="currentColor" strokeWidth="1" strokeOpacity="0.3" />

      {/* ── Hub boss — main disc ── */}
      <circle cx="32" cy="32" r="6.5" fill="currentColor" />

      {/* ── Hub boss — inset ring detail ── */}
      <circle cx="32" cy="32" r="3.5" stroke="currentColor" strokeWidth="1" strokeOpacity="0.45" fillOpacity="0" />

      {/* ── Hub center bolt ── */}
      <circle cx="32" cy="32" r="1.5" fill="currentColor" fillOpacity="0.5" />
    </svg>
  );
}
