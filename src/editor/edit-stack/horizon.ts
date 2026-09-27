/** How far the straighten slider reaches either way, in degrees. */
export const STRAIGHTEN_LIMIT = 15

/** Shorter than this, in screen pixels, and a drag is a slip, not a line. */
export const MIN_HORIZON_PX = 12

/**
 * The straighten angle that levels a line drawn over the picture.
 *
 * `dx`/`dy` are the line in screen pixels, y down, drawn over the picture as it
 * is currently shown — already turned by `current`. The line's own tilt is how
 * far off level the picture still is, so it comes off the current angle.
 * Positive straighten turns the picture clockwise on screen, which is also the
 * way a line tilts when its right end is lower, so the two subtract.
 *
 * A line nearer vertical than horizontal is taken as an upright — the edge of
 * a building, a doorframe — and made plumb instead. Which end was drawn first
 * does not matter. Returns null for a line too short to mean anything.
 */
export function horizonAngle(current: number, dx: number, dy: number): number | null {
  if (Math.hypot(dx, dy) < MIN_HORIZON_PX) return null
  let tilt = (Math.atan2(dy, dx) * 180) / Math.PI
  // Direction does not matter: fold into (-90, 90].
  if (tilt > 90) tilt -= 180
  else if (tilt <= -90) tilt += 180
  // An upright: measure its lean from vertical instead.
  if (tilt > 45) tilt -= 90
  else if (tilt < -45) tilt += 90
  const next = current - tilt
  const clamped = Math.min(STRAIGHTEN_LIMIT, Math.max(-STRAIGHTEN_LIMIT, next))
  // The slider's own step, so the readout and the value agree.
  return Math.round(clamped * 10) / 10 || 0
}
