/**
 * The application's two families, loaded through `next/font/google` so the files
 * are downloaded and self-hosted at build time. No runtime request to a font
 * CDN, and `next/font` emits a size-adjusted local fallback so the layout does
 * not shift when the webfont paints.
 *
 * `src/app/layout.tsx` (task 2.5) is the only consumer: it puts both `variable`
 * class names on the document element, which is what makes `--font-grotesk` and
 * `--font-mono` resolve to real faces. Until then these are declared and unused,
 * which is expected.
 */
import { Archivo, JetBrains_Mono, Orbitron } from 'next/font/google';

/**
 * Archivo, for prose and interface text. The `wdth` axis is requested because
 * the `ruling` type step carries `font-stretch: 96%` — the only use of a width
 * axis anywhere in the application. Without the axis loaded the browser would
 * synthesise the condensed width, which on a 52px word is visible.
 */
export const grotesk = Archivo({
  subsets: ['latin'],
  display: 'swap',
  // `wdth` for the ruling step's 96% stretch — the only ADDITIONAL axis this
  // needs. `wght` is not listed here because a variable font already carries
  // its full weight range by default; `axes` is only for axes beyond that
  // default, and Next's type for Archivo does not accept `wght` as one — it
  // is not a valid member of the additional-axes list, which is exactly the
  // type error this caused. The scale still leans on weight hard in both
  // directions: body text sits at 420 rather than 400 to hold its optical
  // weight against halation, while the display and ruling steps run at 350
  // and 300, because light-on-dark type gains apparent weight and a display
  // face that reads correct on paper reads heavy and smeared once inverted.
  // None of that requires `wght` in this array — it works because the
  // default variable range already covers it.
  axes: ['wdth'],
  variable: '--font-grotesk',
});

/**
 * JetBrains Mono, for machine identity data only. Chosen for disambiguation at
 * small sizes: slashed zero, distinct `1`/`l`/`I`, tall lowercase, so a
 * 66-character keccak hash stays comparable character by character at the 13px
 * `record` step. Referenced by `MachineValue` and nothing else.
 */
export const mono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains',
});

/**
 * Orbitron, for the wordmark ALONE — not exported as a `--variable` and not
 * consumed through the type scale, because it is not a type-scale step. It is
 * the one place the interface matches the logo's own lettering: the mark's
 * chamfered, geometric strokes, echoed in the "Arbitra" text that sits beside
 * it in the masthead.
 *
 * Applied via `wordmark.className` directly at the one call site rather than
 * through a CSS custom property, on purpose. A `--font-wordmark` token would
 * need a confinement rule of its own the moment a second file reached for it,
 * and this mark has exactly one legitimate use. Scoping it to a generated
 * class instead makes "one file, one use" the default rather than something
 * `check-design.mjs` has to enforce.
 */
export const wordmark = Orbitron({
  subsets: ['latin'],
  weight: ['700'],
  display: 'swap',
});
