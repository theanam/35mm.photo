import { useCallback, useEffect, useId, useState } from 'react'

export interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  /** Value the fill grows from. Defaults to 0 when the range spans it. */
  origin?: number
  /** Value restored on double-click / Alt-click. */
  resetTo?: number
  /** CSS gradient for the track, used by the warmth and tint sliders. */
  trackGradient?: string
  format?: (value: number) => string
  onChange: (value: number) => void
  disabled?: boolean
  /** Compact row used inside the colour mixer. */
  dense?: boolean
  /**
   * Turns the readout into a field you can type an exact number into. For
   * controls where the number is the point rather than the feel of it — a
   * border of exactly 64px is a thing to ask for; an exposure of exactly
   * +0.7314 is not.
   */
  editable?: boolean
  /** Shown after an editable field, e.g. '%' or 'px'. */
  unit?: string
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  origin,
  resetTo,
  trackGradient,
  format,
  onChange,
  disabled,
  dense,
  editable,
  unit,
}: SliderProps) {
  const id = useId()

  /*
   * Held as text while it is being typed.
   *
   * Writing straight through on every keystroke would fight the typist: "6" on
   * the way to "64" is a valid number, so it would be applied, clamped and
   * reformatted under the caret — and an empty field, or a lone "-", is not a
   * number at all. The model is written on Enter or on leaving the field, and
   * until then this is the only thing that knows what is in it.
   */
  const [draft, setDraft] = useState<string | null>(null)

  const span = max - min || 1
  const pct = ((value - min) / span) * 100
  const originValue = origin ?? (min < 0 && max > 0 ? 0 : min)
  const originPct = ((originValue - min) / span) * 100

  const fillLeft = Math.min(pct, originPct)
  const fillWidth = Math.abs(pct - originPct)

  const target = resetTo ?? originValue
  /* Nothing to go back to, so the readout stays a readout. */
  const atOrigin = Math.abs(value - target) < (step || 1) / 2

  const reset = useCallback(() => {
    if (disabled) return
    onChange(target)
  }, [disabled, onChange, target])

  const clamp = useCallback((v: number) => Math.min(max, Math.max(min, v)), [min, max])

  /** Take what was typed, or put the field back if it was not a number. */
  const commit = useCallback(() => {
    if (draft === null) return
    const n = Number(draft.replace(',', '.').trim())
    setDraft(null)
    if (draft.trim() !== '' && Number.isFinite(n)) onChange(clamp(n))
  }, [draft, onChange, clamp])

  // A value changed from elsewhere — a preset, a link mode, a unit switch —
  // must show through rather than be hidden behind a stale draft.
  useEffect(() => {
    setDraft(null)
  }, [value])

  return (
    <div className={dense ? 'slider slider--dense' : 'slider'} data-disabled={disabled || undefined}>
      <label className="slider__label" htmlFor={id}>
        {label}
      </label>

      <div
        className="slider__track"
        style={trackGradient ? { background: trackGradient } : undefined}
        onDoubleClick={reset}
      >
        {!trackGradient && (
          <div className="slider__fill" style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }} />
        )}
        <div className="slider__thumb" style={{ left: `${pct}%` }} />
        <input
          id={id}
          className="slider__input"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerDown={(e) => {
            // Alt-click is the Lightroom habit for zeroing a slider.
            if (e.altKey) {
              e.preventDefault()
              reset()
            }
          }}
        />
      </div>

      {editable ? (
        <span className="slider__entry">
          <input
            className="slider__field mono"
            type="text"
            inputMode="decimal"
            value={draft ?? String(Math.round(value * 100) / 100)}
            disabled={disabled}
            aria-label={`${label}${unit ? ` in ${unit}` : ''}`}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => commit()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commit(); e.currentTarget.blur() }
              // Escape abandons the edit rather than committing half of it.
              if (e.key === 'Escape') { e.preventDefault(); setDraft(null); e.currentTarget.blur() }
              // The arrows step the value, the way they would on the slider.
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault()
                const by = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1) * (step || 1)
                setDraft(null)
                onChange(clamp(value + by))
              }
            }}
          />
          {unit && <span className="slider__unit">{unit}</span>}
        </span>
      ) : (
      /*
        The readout doubles as the reset.
        
        Double-click and alt-click were the only ways to zero a slider, and a
        phone has neither — leaving the exact origin to be found by dragging,
        which on a −100..100 range across a finger's width is a target about a
        pixel wide. The number is already sitting there saying what would be
        undone, so it is the obvious thing to press, and it costs the desktop
        nothing: the two habits above still work.
      */
      <button
        type="button"
        className="slider__value mono"
        onClick={reset}
        disabled={disabled || atOrigin}
        title={atOrigin ? undefined : `Reset ${label.toLowerCase()}`}
        aria-label={atOrigin ? undefined : `Reset ${label.toLowerCase()}`}
      >
        {format ? format(value) : formatSigned(value, step)}
      </button>
      )}
    </div>
  )
}

function digitsFor(step: number): number {
  return step < 1 ? (String(step).split('.')[1]?.length ?? 2) : 0
}

export function formatSigned(value: number, step = 1): string {
  const digits = digitsFor(step)
  const rounded = Number(value.toFixed(digits))
  if (rounded === 0) return '0'
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(digits)}`
}

export function formatPlain(value: number, step = 1): string {
  return value.toFixed(digitsFor(step))
}
