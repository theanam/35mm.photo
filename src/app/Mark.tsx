/**
 * The 35mm mark — a 3:2 rectangle with a centred aperture dot, the smallest
 * possible drawing of "a photograph".
 *
 * `size` is the frame *width*, which is how the brand sheet labels its size
 * scale (48×32, 32×21, 24×16, 16×16). The mark is always 3:2, so it is never a
 * square logo squeezed into a square box. Three cuts, per that scale:
 *
 *   ≥ 32px  frame + aperture dot
 *   ≥ 24px  frame alone — below 32 the dot silts up
 *   < 24px  solid safelight tile with a bare frame knocked out of it
 *
 * Geometry only, no type: the mark also renders in `public/icon.svg`, where no
 * webfont has ever loaded.
 */
export function Mark({ size = 32 }: { size?: number }) {
  const common = {
    className: 'topbar__mark',
    'aria-hidden': true,
    focusable: 'false' as const,
  }

  // Tab- and chip-size: the outline collapses, so the tile carries the colour.
  if (size < 24) {
    return (
      <svg {...common} viewBox="0 0 32 32" width={size} height={size}>
        <rect width="32" height="32" rx="6" fill="var(--accent)" />
        <rect
          x="7"
          y="10"
          width="18"
          height="12"
          fill="none"
          stroke="var(--bg-app)"
          strokeWidth="2"
        />
      </svg>
    )
  }

  return (
    <svg {...common} viewBox="0 0 96 64" width={size} height={size / 1.5}>
      <rect
        x="2"
        y="2"
        width="92"
        height="60"
        rx="4"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="4"
      />
      {size >= 32 && <circle cx="48" cy="32" r="7.8" fill="var(--accent)" />}
    </svg>
  )
}
