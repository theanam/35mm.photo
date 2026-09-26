/**
 * A custom export size, in the terms the pipeline already speaks.
 *
 * Export scales by one number, the cap on the longest edge, because that is
 * what keeps a whole folder consistent. A person, though, asks for a width or
 * a height — "1200 wide for the blog" — so the two fields on the dialog are
 * turned into that one number here, using the picture's own shape. Nothing is
 * ever scaled up: a number past the natural size simply means full size.
 */

/** The long-edge cap that lands the framed picture on `width`. */
export function edgeForWidth(naturalW: number, naturalH: number, width: number): number {
  const w = clampSide(width, naturalW)
  return naturalW >= naturalH ? w : Math.round((w * naturalH) / naturalW)
}

/** The long-edge cap that lands the framed picture on `height`. */
export function edgeForHeight(naturalW: number, naturalH: number, height: number): number {
  const h = clampSide(height, naturalH)
  return naturalH >= naturalW ? h : Math.round((h * naturalW) / naturalH)
}

function clampSide(asked: number, natural: number): number {
  if (!Number.isFinite(asked)) return natural
  return Math.max(1, Math.min(natural, Math.round(asked)))
}
