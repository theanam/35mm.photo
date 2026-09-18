/** 16px stroke icons, sized by the button they sit in. */

type Props = { size?: number }

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
})

export const IconLooks = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M8 1.8 14.2 5 8 8.2 1.8 5 8 1.8Z" />
    <path d="M1.8 8.4 8 11.6l6.2-3.2M1.8 11.4 8 14.6l6.2-3.2" />
  </svg>
)

export const IconLight = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <circle cx="8" cy="8" r="3.1" />
    <path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3.1 3.1l1.1 1.1M11.8 11.8l1.1 1.1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1" />
  </svg>
)

export const IconCurves = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M1.8 14.2 14.2 1.8" strokeDasharray="2 2" opacity=".45" />
    <path d="M1.8 14.2c3.4 0 3.6-8.1 6.2-8.1s2.8 3.6 6.2 3.6" />
    <circle cx="8" cy="6.1" r="1.5" fill="currentColor" stroke="none" />
  </svg>
)

export const IconMixer = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M8 1.8v12.4M2.6 4.9l10.8 6.2M2.6 11.1l10.8-6.2" />
  </svg>
)

/** Three overlapping discs: the shadow, midtone and highlight wheels. */
export const IconGrade = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <circle cx="5.6" cy="6" r="4" />
    <circle cx="10.4" cy="6" r="4" />
    <circle cx="8" cy="10.4" r="4" />
  </svg>
)

/** A frame leaning back: keystone, plus the lens element correcting it. */
export const IconLens = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M3.4 2.6 12.6 4v8L3.4 13.4V2.6Z" />
    <circle cx="8" cy="8" r="2.1" />
  </svg>
)

/**
 * The "this photo has edits" mark: a length of film in the safelight amber.
 *
 * Filled rather than stroked, and carrying its own dark plate, because it sits
 * on top of a thumbnail whose colours are anyone's guess — an outline icon
 * would vanish against half the photos in a folder.
 */
export const MarkEdited = () => (
  <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden>
    <rect width="16" height="12" rx="2.5" fill="#0b0a08" fillOpacity="0.78" />
    <rect x="2" y="2" width="12" height="8" rx="1" fill="#c9a227" />
    <g fill="#0b0a08">
      <rect x="3" y="2.9" width="1.7" height="1.3" rx="0.45" />
      <rect x="6.15" y="2.9" width="1.7" height="1.3" rx="0.45" />
      <rect x="9.3" y="2.9" width="1.7" height="1.3" rx="0.45" />
      <rect x="3" y="7.8" width="1.7" height="1.3" rx="0.45" />
      <rect x="6.15" y="7.8" width="1.7" height="1.3" rx="0.45" />
      <rect x="9.3" y="7.8" width="1.7" height="1.3" rx="0.45" />
    </g>
  </svg>
)

/** Two arrows trading places: swap the two numbers of a ratio. */
export const IconSwap = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M2.4 5.4h9.1M9.2 3.1l2.3 2.3-2.3 2.3" />
    <path d="M13.6 10.6H4.5M6.8 8.3 4.5 10.6l2.3 2.3" />
  </svg>
)

export const IconInfo = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <circle cx="8" cy="8" r="6.4" />
    <path d="M8 7.2v4" />
    <path d="M8 4.7h.01" strokeWidth="1.8" />
  </svg>
)

/* One per section of the EXIF viewer, so a group is findable by shape. */
export const IconCamera = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M1.8 4.9h2.9l1-1.7h4.6l1 1.7h2.9v7.9H1.8V4.9Z" />
    <circle cx="8" cy="8.6" r="2.4" />
  </svg>
)

export const IconExposure = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M8 1.8v12.4M3.6 3.6l8.8 8.8" />
  </svg>
)

export const IconPlace = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M8 14.2s4.6-4 4.6-7.4a4.6 4.6 0 1 0-9.2 0c0 3.4 4.6 7.4 4.6 7.4Z" />
    <circle cx="8" cy="6.8" r="1.7" />
  </svg>
)

export const IconFile = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M9 1.8H4.2v12.4h7.6V4.6L9 1.8Z" />
    <path d="M8.9 1.9v2.8h2.8" />
  </svg>
)

export const IconHelp = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <circle cx="8" cy="8" r="6.4" />
    <path d="M6.1 6.1a1.95 1.95 0 1 1 2.6 1.85c-.45.16-.7.6-.7 1.08v.32" />
    <path d="M8 11.9h.01" strokeWidth="1.8" />
  </svg>
)

/*
 * The GitHub mark is a filled silhouette, not a stroked outline like the rest
 * of this set — it is a trademark with a fixed shape, so it keeps its own
 * geometry rather than being redrawn to match.
 */
export const IconGitHub = ({ size = 16 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
      0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01
      1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95
      0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0
      1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0
      3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01
      8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
)

export const IconCrop = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M4.2 1v10.8H15" />
    <path d="M1 4.2h10.8V15" />
  </svg>
)

export const IconDetail = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M1.6 11.4 5.4 4.2l2.6 4.6 1.8-2.4 4.6 5" />
    <path d="M1.6 14.2h12.8" opacity=".45" />
  </svg>
)

export const IconGrain = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <rect x="1.8" y="1.8" width="12.4" height="12.4" rx="2" />
    <g fill="currentColor" stroke="none">
      <circle cx="5" cy="5.2" r=".85" />
      <circle cx="9.4" cy="4.4" r=".7" />
      <circle cx="11.6" cy="7.4" r=".85" />
      <circle cx="6.6" cy="8.4" r=".7" />
      <circle cx="4.4" cy="11" r=".85" />
      <circle cx="9" cy="11.4" r=".7" />
    </g>
  </svg>
)

export const IconRaw = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M8 1.8 4.6 7.6M14.2 8l-6.7.2M11.4 13.4 8.1 7.6" />
  </svg>
)

export const IconCheck = ({ size = 16 }: Props) => (
  <svg {...base(size)} strokeWidth={1.8}>
    <path d="M3 8.4 6.4 12 13 4.6" />
  </svg>
)

export const IconCross = ({ size = 16 }: Props) => (
  <svg {...base(size)} strokeWidth={1.8}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
)

export const IconUndo = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M2.4 6.4h7.2a3.6 3.6 0 0 1 0 7.2H6" />
    <path d="M5.2 3.2 2 6.4l3.2 3.2" />
  </svg>
)

export const IconRedo = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M13.6 6.4H6.4a3.6 3.6 0 0 0 0 7.2H10" />
    <path d="M10.8 3.2 14 6.4l-3.2 3.2" />
  </svg>
)

export const IconReset = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M13.8 8a5.8 5.8 0 1 1-1.9-4.3" />
    <path d="M14 1.6v3.6h-3.6" />
  </svg>
)

export const IconCopy = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <rect x="5.4" y="5.4" width="8.8" height="8.8" rx="1.6" />
    <path d="M10.6 5.4V3.4a1.6 1.6 0 0 0-1.6-1.6H3.4a1.6 1.6 0 0 0-1.6 1.6v5.6a1.6 1.6 0 0 0 1.6 1.6h2" />
  </svg>
)

export const IconPaste = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M6 2.6H4.2a1.6 1.6 0 0 0-1.6 1.6v9.2a1.6 1.6 0 0 0 1.6 1.6h7.6a1.6 1.6 0 0 0 1.6-1.6V4.2a1.6 1.6 0 0 0-1.6-1.6H10" />
    <rect x="5.8" y="1" width="4.4" height="3.2" rx="1" />
  </svg>
)

export const IconSplit = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <rect x="1.8" y="3" width="12.4" height="10" rx="1.6" />
    <path d="M8 3v10" />
    <path d="M4 6.4h1.8M4 9.6h1.8" opacity=".5" />
  </svg>
)

export const IconHistogram = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M1.8 13.4V9.8M5.3 13.4V5.4M8.8 13.4V2.6M12.3 13.4V7.6" strokeWidth={1.6} />
  </svg>
)

export const IconMinus = ({ size = 16 }: Props) => (
  <svg {...base(size)} strokeWidth={1.7}>
    <path d="M3.4 8h9.2" />
  </svg>
)

export const IconPlus = ({ size = 16 }: Props) => (
  <svg {...base(size)} strokeWidth={1.7}>
    <path d="M8 3.4v9.2M3.4 8h9.2" />
  </svg>
)

export const IconChevron = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M4.6 6.4 8 9.8l3.4-3.4" />
  </svg>
)
