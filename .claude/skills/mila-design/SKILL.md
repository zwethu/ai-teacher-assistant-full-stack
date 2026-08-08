---
name: mila-design
description: Use this skill to generate well-branded interfaces and assets for MILA (MFU Intelligent Lecturer Assistant, royal purple · gold identity), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.
If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Brand motion & logo assets

- Two loaders, both drawn from the logo, never interchangeable:
  `Spinner`/`PageSpinner`/`Button loading` for **loading** (garland strings
  itself, 3.2 s) and `Thinking`/`ThinkingRow` for **agent work** (gold bead
  steps bead-to-bead over a 7.2 s walk while the thread takes a random new
  bead-anchored form at each arrival). Both fall back to the static mark under
  `prefers-reduced-motion`.
- Production logo files live in `assets/logo/` (SVG + PNG, color / white / mono,
  horizontal + stacked lockups, favicons, app icons, social preview). Use them
  as-is; do not redraw the mark or retype the wordmark.
- Compact lockup geometry is fixed: caps 0.40× ring height, tucked −0.10× mark
  width into the ring's clear margin, vertically centred; clear space = 1 bead Ø.

---

## Where these files live in the MILA repo

*(Added during the import — the paths above are the design-system project's own
layout; below is where each piece actually landed here.)*

| Design-system path | In this repo |
| --- | --- |
| `styles.css`, `tokens/*.css` | `ai-teacher-assistant-full-stack/frontend/src/design-system/` |
| `components/**` (`.jsx` + `.d.ts` + `.prompt.md`) | `ai-teacher-assistant-full-stack/frontend/src/design-system/components/` |
| `assets/logo/**` | `ai-teacher-assistant-full-stack/frontend/public/brand/` (served at `/brand/…`) |
| `guidelines/**`, `overview.html`, `ui_kits/**` | `docs/design-system/` |
| `readme.md` | `README.md` beside this file, and `docs/design-system/README.md` |

**Using components in the React app** — import from the barrel; tokens are
already loaded globally via `src/index.css`:

```tsx
import { Button, Card, ThinkingRow } from './design-system'
```

Components are plain `.jsx` that inject their own CSS and read design tokens as
CSS custom properties — they have **no Tailwind dependency** and coexist with
the app's Tailwind v4 setup.

**Known gap:** the existing app pages still use Tailwind `emerald-*` utilities
from the pre-MILA palette (~450 occurrences). Those are Tailwind's own colors
and do **not** repaint from MILA tokens. When editing an existing page, migrate
the emerald utilities you touch to the violet ramp (`var(--violet-600)` etc.),
and keep emerald only for genuine success states.
