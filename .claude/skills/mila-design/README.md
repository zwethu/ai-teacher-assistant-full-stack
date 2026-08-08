# MILA — Royal Purple · Gold Design System

> ✅ **Name locked: MILA** — *MFU Intelligent Lecturer Assistant*. The identity is finalized:
> the Malai beads-loop mark + golden-pillar MILA caps in the MLII royal purple · gold
> palette (see `guidelines/logo-mila-final.card.html`). The earlier shortlist below is
> kept for the archive:
>
> - **MILA** — MFU Intelligent Lecturer Assistant
> - **MATA** — MFU AI Teaching Assistant
> - **MALA** — MFU Academic Lecturer Assistant
> - **SATA (MFU)** — Smart Academic Teacher Assistant
> - **SATI Studio (MFU)** — Smart Academic Teacher Intelligence
> - **LCAI Studio (MFU)** — Lecturer's Course AI
> - **LAI Studio (MFU)** — Lecturer's AI Studio

**MILA is v3 of the system** — the finalized identity. It keeps everything that made
earlier versions recognizable (the dotted academic canvas — now lavender — glass chrome,
Inter body, calm educator-first voice) and locks in: **MLII royal purple #5F489C** as the
functional primary, **MLII gold #FCC018** as the insight accent, **Plus Jakarta Sans** for
display/headings (no serif anywhere), the **Malai beads-loop logo** with golden-pillar
MILA caps, and the **MLII robot avatar** as the chat persona. Legacy `--azure-*` token
names alias into the purple ramp so older surfaces repaint automatically.

MILA is an **AI teaching-assistant platform for Mae Fah Luang University (MFU)
lecturers**: lesson planning, assessment generation, email drafting, student batches
("spaces"), and lecturer wellness — with an agentic chat at its core (course files,
web search, Google Workspace export). This system covers the **lecturer-facing
product only**. Built under the **MLII Innovation Development Grant** (MFU Learning
Innovation Institute, mlii.mfu.ac.th).

---

## Sources

- **MAIA v1/v2 design systems** (emerald, then blue eras) — direct ancestors; MILA v3
  keeps the identical component inventory and APIs.
- **GitHub:** `zwethu/ai-teacher-assistant-full-stack` @ branch `agent-wire`
  (`frontend/` — React 19 + Vite + Tailwind v4; prototyped under the placeholder
  brand "PNai / Pyin Nyar AI", since renamed to MILA).
- **MLII (grantor):** https://mlii.mfu.ac.th/en/

---

## Logo & brand assets (production)

Locked identity: **Malai beads-loop mark** (7 beads Ø15 on a Ø60 thread, ⅓ ratio,
gold insight bead at 1–2 o'clock) + **golden-pillar MILA caps** (monoline stroke 12,
the M's right stem IS the gold I). Compact lockup: caps at **0.40× ring height**,
tucked **−0.10× mark width** into the ring's clear margin, vertically centred.
Clear space = 1 bead diameter. Full spec + live motion demos:
`guidelines/logo-mila-final.card.html`.

`assets/logo/` — ready to ship:

| File | Use |
| --- | --- |
| `mila-mark.svg` · `-white` · `-mono` | mark alone (color / knockout / one-colour) |
| `mila-wordmark.svg` · `-white` | caps alone (certificates, formal) |
| `mila-lockup-horizontal.svg` · `-white` | primary lockup (140×84 viewBox) |
| `mila-lockup-stacked.svg` · `-white` | badge lockup (168×130 viewBox) |
| `favicon.svg`, `favicon-16/32/48.png` | 3-bead reduction on a violet tile |
| `mila-app-icon-192/512.png` | app icon (white mark on #5F489C) |
| `mila-mark-1024.png`, `mila-lockup-1024.png` (1680×1008), `mila-lockup-stacked-1024.png` | transparent PNG masters |
| `mila-social-preview-1200x630.png` | OG / social card |

`guidelines/assets/mlii-avatar.png` (chat persona, circle-crop the visor) and
`guidelines/assets/mlii-robot.png` (transparent cut-out, onboarding art only) —
neither ever replaces the logo.

## Content fundamentals — how MILA writes

Unchanged from v1. **Voice:** warm, plain-spoken, respectful of lecturers'
expertise. "Smart support for educators, by educators." Calm and concrete, never hype.

- **Casing:** sentence case everywhere ("Generate outline", "Saved assessments").
- **Person:** second person ("How can I help you teach today?"); the assistant says "I" sparingly.
- **Helper text:** every page heading gets one calm explanatory line underneath.
- **Verbs:** action-first — *Generate, Create, Send, Schedule, Refine, Export*.
- **Punctuation:** ellipses for in-progress states ("Saving…"). Minimal exclamation marks.
- **Emoji:** only the Wellness mood picker (😊 🙂 😴 😟 😰). Never in chrome.
- **Domain nouns:** *space* / *batch*, *artifact*, *course files*, *outline*, *run*.
- **Avoid:** hype words, robot/AI clichés, childish tone.

---

## Visual foundations

**Overall feel:** a bright, airy academic workspace with a **liquid-glass** finish —
frosted panels floating over a pale-blue dotted canvas with ambient color blobs.
Trustworthy, cool, optimistic; never dark or heavy.

- **Signature backdrop:** `.maia-academic-bg` — pale lavender `#efe9fb` with a 32px
  dotted grid of `#d9ccf1`. App wash `.maia-app-bg` is a soft lavender diagonal.
  (Utility class names keep the historical `maia-` prefix — they are API, not brand.)
- **Color:** **MLII royal purple** is the functional primary — `violet-600 #5f489c` at rest,
  `700` on hover; primary CTAs use a `500→600` vertical gradient with an inner
  white highlight. **Cyan `#22d3ee` and indigo `#4f46e5`** bracket azure in the
  liquid gradients (`--brand-gradient`, `--liquid-gradient`) — accents only.
  **Sky** owns backgrounds/info. **Slate** is the neutral ramp. Semantic: success =
  emerald (its only remaining role), info = sky, warning = amber, danger = red.
  **MFU maroon is retired.**
- **Liquid glass:** the defining v2 motif. `.maia-glass` = white/55 +
  `blur(24px) saturate(1.6)` + white hairline + specular top edge
  (`--shadow-glass`). `.maia-glass-strong` (white/75, blur 28) for modals & login;
  `.maia-glass-header` for thin header strips; `.maia-glass-tint` for violet-tinted
  selected surfaces; `.maia-liquid-pill` for composer bars and floating toolbars.
  Always over the canvas or blobs — never over plain white.
- **Ambient blobs:** `.maia-blob--azure / --cyan / --indigo`, `blur(64px)`, behind chat and heroes.
- **Typography:** **Inter** for all UI/body (controls 14/600, body 14/400, page
  headings 24/700); **Plus Jakarta Sans** for display/headings — no serif anywhere.
  Uppercase 10px micro-labels with `0.2em` tracking.
- **Radii (one step rounder than v1):** controls `md 10px`; tiles `lg 12px`; cards &
  nav `xl 16px`; panels `2xl 20px`; modals `3xl 28px`; pills/avatars `full`.
- **Shadows:** blue-tinted (`rgba(30,58,138,…)`), `xs → 2xl`; `--shadow-primary` is
  an azure glow for CTAs; `--shadow-glass` / `--shadow-glass-lg` carry the specular
  glass highlights.
- **Cards:** white (or `glass`), `radius-xl`, slate-100 border, `shadow-sm`; header
  row = 36px azure-50 icon tile + title + muted meta; interactive cards lift `-2px`.
- **Buttons:** primary = azure gradient fill, `radius-md`, 44px min height, azure
  glow on hover, `translateY(1px)` press. Secondary = frosted white with slate
  border. Ghost = text. Danger = red.
- **Inputs:** white, slate-300 border → **azure-500 border + 3px azure ring** on focus.
- **Nav items:** `radius-xl`; active = `violet-100 → white` gradient, violet-300
  border, lifted; hover = faint violet wash.
- **Motion:** quiet — `120–200ms` ease on color/shadow/transform; bars ease width
  over `700ms`; modals fade + pop. No bounces or decorative motion.
- **Brand motion (the two loaders, both built from the logo):**
  **Loading** = `Spinner` / `PageSpinner` / `Button loading` — the bead garland
  strings itself (thread draws, six purple beads pop in order, gold bead lands
  last, 3.2 s); sizes under 28 px simply rotate the ring. **Agent thinking** =
  `Thinking` / `ThinkingRow` — the garland stays whole and alive: gold insight
  bead steps bead-to-bead (1.2 s a step, 7.2 s walk) dimming the bead it lands on,
  all beads ripple on a wave that circles the garland once per step (on beat), the garland breathes 1→1.07, and the thread
  takes a random new form at each arrival from a shuffled bag of six bead-anchored
  shapes (ring, taut hexagon, deep scallop, big bloom, alternating wave, lobed
  pairs) — once each per walk, never twice in a row. Both honour
  `prefers-reduced-motion` by falling back to the static mark. Never use the
  thinking animation for plain loading, or vice-versa.
- **Status signal (wellness):** stress bars shift emerald-500 (low) → orange-500 → red-500.

---

## Iconography

Unchanged: [**Lucide**](https://lucide.dev) line icons, ~1.75px stroke, round
caps/joins; 16px inline, 20px in nav; `loader-2` spins. In kits: CDN
(`https://unpkg.com/lucide@0.544.0`) via `<i data-lucide="name">` +
`lucide.createIcons()`. Emoji only in the Wellness mood picker.
**The logo is final** — the Malai beads-loop mark + golden-pillar MILA caps (gold I).
App icon = the bead loop on a violet tile; favicon = the 3-bead reduction.
Full spec: `guidelines/logo-mila-final.card.html`.

---

## Index / manifest

- `styles.css` — single entry point (import-only manifest).
- `tokens/` — `colors.css`, `typography.css`, `spacing.css`, `radii.css`,
  `shadows.css`, `effects.css` (glass/canvas/blob utilities), `fonts.css` (note).
- `guidelines/` — foundation specimen cards: Colors (Primary Azure, Liquid Accents,
  Academic Canvas, Neutral, Semantic), Type (Display, Body, Labels), Spacing (Scale,
  Radii, Elevation), Brand (Wordmark, Voice, Liquid Glass, Iconography).
- `components/` — same inventory as v1, restyled:
  **forms/** `Button`, `IconButton`, `Input` (+`Textarea`, `Select`), `Checkbox` (+`Switch`);
  **display/** `Card`, `Badge`, `Chip`, `Avatar`, `ProgressBar`;
  **feedback/** `Modal`, `Toast`, `Spinner` (+`PageSpinner`), `Thinking` (+`ThinkingRow`);
  every component ships `.jsx`, `.d.ts` and `.prompt.md` beside it;
  **navigation/** `NavItem`.
- `ui_kits/webapp/` — interactive lecturer web app recreation: login → agentic chat →
  assessments → wellness, in the liquid-glass skin.
- `thumbnail.html`, `SKILL.md`, `readme.md` (this file).

### Intentional additions
Carried over from v1: `Switch` and `IconButton` codify repeated product markup with
no single named counterpart in the source. New in v2: the liquid-glass utility set
(`.maia-glass-tint`, `.maia-liquid-pill`) generalizes glass patterns v1 used ad hoc.

---

## Caveats
None blocking — name (MILA), logo, palette, and type are locked. If MFU/MLII supply
additional official brand values, swap them into `tokens/colors.css`.
3. No logo art exists; the wordmark is typographic.
