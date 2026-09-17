# Brand sources

Direction **1b "Full Frame"**. The mark is a 3:2 rectangle with a centred
aperture dot — the smallest possible drawing of "a photograph". Amber is a
safelight, not a paint: it marks what is active and nothing else.

The marks ship from `public/`; this folder holds the things that need a render step.

| File | Ships as | Notes |
| --- | --- | --- |
| `../public/icon.svg` | installed app / apple-touch icon | safelight tile, frame + dot knocked out |
| `../public/icon-maskable.svg` | Android maskable icon | full bleed, art inside the 80% safe zone |
| `../public/favicon.svg` | browser tab | the 16px cut — solid tile, bare frame, no dot |
| `og.html` | `../public/og.png` | social card, needs rasterising |
| `../src/app/Mark.tsx` | in-product mark | same construction, three cuts by size |

Every cut is geometry — no type, no `<text>`. Icons render outside the page,
where the webfont has never loaded, so a typeset numeral would fall back to
whatever the OS happens to have.

## Lockups

Four variants, each with one job. Don't substitute.

| Variant | Where |
| --- | --- |
| Primary (mark + `35mm` / `PHOTO`) | the social card, launch screens |
| Stacked | square-ish slots: avatars, sponsor walls, merch |
| Single line (`35mm.photo`) | site header, email signature, docs — **and the product top bar** |
| Mark only | anywhere the name is already on screen |

The product top bar is **single line**, at a 32px-wide mark against a 24px
wordmark — the sheet's own 40-against-30 ratio. Clear space is one frame-height
on every side; nothing enters it, which is what `--frame-h` on `.topbar` sets
the bar's padding and its gap out to the rule to.

## Minimum sizes

Sizes are given as the mark's **width**, which is how the sheet labels its scale
(48×32, 32×21, 24×16, 16×16). Below 24px the aperture dot silts up. `Mark.tsx`
switches cuts on the `size` prop so this is enforced rather than remembered:

| Size | Cut |
| --- | --- |
| ≥ 32px | frame + aperture dot |
| 24–31px | frame alone |
| < 24px | solid safelight tile, bare frame |

## Regenerating the social card

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --hide-scrollbars \
  --screenshot=public/og.png --window-size=1200,630 \
  --virtual-time-budget=6000 "file://$PWD/brand/og.html"
```

Chrome rather than a plain SVG rasteriser, so the card is set in the real
Alegreya Sans / IBM Plex Mono rather than a fallback.

## Colours

Straight from `src/styles/tokens.css` — the mark has no palette of its own.
Six values, each with exactly one job.

| Token | Value | Sheet | Role | Use |
| --- | --- | --- | --- | --- |
| `--bg-canvas` | `#0A0A09` | `#100E0C` | Ground | behind the image; never a text colour |
| `--bg-panel` | `#141312` | `#1B1712` | Chrome | bars, rails, panels |
| `--line` / `--track` | `#272523` | `#2A2118` | Edge | dividers, borders, slider tracks |
| `--accent` | `#C9A227` | — | Safelight | active state, primary button, the mark |
| `--text` | `#F2EADC` | — | Paper | text |
| `--text-muted` | `#9B948A` | — | Muted | secondary text |

**The three grounds ship darker and much closer to neutral than the sheet's
warm-black swatches.** That is the tradeoff the direction card names on 1b
itself — "the most darkroom of the three, least neutral for judging colour" —
and an editor has to be a neutral surround, or every photo picks up the room's
cast. Safelight, Paper and Muted are unchanged, and the safelight keeps all the
chroma, which is the point of it: amber is the only saturated thing on screen,
so it can only ever mean "this is active".

## Type

Alegreya Sans — humanist with calligraphic bones. 800 for the wordmark and
primary buttons, 700 for headings, 500/400 for interface copy. It has no 600;
use 700. IBM Plex Mono carries every readout: exposure, temperature, aperture,
file names.
