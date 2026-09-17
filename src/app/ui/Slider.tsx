import { useCallback, useId } from 'react'

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
}: SliderProps) {
  const id = useId()

  const span = max - min || 1
  const pct = ((value - min) / span) * 100
  const originValue = origin ?? (min < 0 && max > 0 ? 0 : min)
  const originPct = ((originValue - min) / span) * 100

  const fillLeft = Math.min(pct, originPct)
  const fillWidth = Math.abs(pct - originPct)

  const reset = useCallback(() => {
    if (disabled) return
    onChange(resetTo ?? originValue)
  }, [disabled, onChange, resetTo, originValue])

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

      <output className="slider__value" htmlFor={id}>
        {format ? format(value) : formatSigned(value, step)}
      </output>
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
