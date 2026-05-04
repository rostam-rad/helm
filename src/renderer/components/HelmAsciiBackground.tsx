import { useEffect, useRef, useState } from 'react';
import { frames } from '../assets/animation.js';

// 45fps is the source cadence. We slow it to ~22fps for an ambient feel —
// the wheel still rotates clearly but no longer competes with foreground UI.
const FPS = 22;
const FRAME_MS = 1000 / FPS;

/**
 * Decorative ASCII steering-wheel animation, sized to fill its parent and
 * positioned behind content. The parent must be `position: relative` and
 * `overflow: hidden`. Pointer events are disabled so it never interferes
 * with clicks underneath.
 */
export function HelmAsciiBackground() {
  const [i, setI] = useState(0);
  const last = useRef(performance.now());
  const raf = useRef<number | null>(null);

  // rAF + delta-time stepping keeps the cadence at ~45fps even when the
  // browser throttles intervals (e.g. backgrounded window).
  useEffect(() => {
    function tick(now: number) {
      const elapsed = now - last.current;
      if (elapsed >= FRAME_MS) {
        const advance = Math.floor(elapsed / FRAME_MS);
        last.current += advance * FRAME_MS;
        setI(prev => (prev + advance) % frames.length);
      }
      raf.current = requestAnimationFrame(tick);
    }
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current !== null) cancelAnimationFrame(raf.current); };
  }, []);

  // Radial mask centered on the wheel itself, fading to transparent so the
  // art's rectangular boundary disappears into the page.
  const mask =
    'radial-gradient(ellipse 55% 75% at 50% 50%, black 45%, transparent 90%)';

  return (
    <div
      aria-hidden
      // Right-half of the viewport only — keeps the wheel clear of the
      // left-anchored content column. The container itself is positioned
      // right; the mask handles the visual fade.
      className="pointer-events-none absolute inset-y-0 right-0 flex items-center justify-center overflow-hidden"
      style={{
        // Reserve the left half of the viewport for the modal column.
        // clamp keeps the wheel from getting cramped on narrow windows.
        width: 'clamp(360px, 55vw, 900px)',
        WebkitMaskImage: mask,
        maskImage: mask,
      }}
    >
      <pre
        className="m-0 whitespace-pre"
        style={{
          fontFamily: '"Courier New", monospace',
          // 1ch per column; line-height 1 keeps the glyph grid square so the
          // wheel reads as round at any viewport size.
          fontSize: '14px',
          lineHeight: 1,
          opacity: 0.45,
          // Tint in the brand accent — turns the wheel from generic grey
          // noise into Helm's own mark.
          color: 'var(--accent)',
          userSelect: 'none',
        }}
      >
        {frames[i]}
      </pre>
    </div>
  );
}
