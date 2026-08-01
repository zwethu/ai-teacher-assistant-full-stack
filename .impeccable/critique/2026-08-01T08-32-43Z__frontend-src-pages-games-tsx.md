---
target: the game generation page (whole page except sidebar)
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 3
p1_count: 3
timestamp: 2026-08-01T08-32-43Z
slug: frontend-src-pages-games-tsx
---
Method: dual-agent (A: design review · B: detector + static evidence). Browser automation unavailable — no overlay was injected; visual layer supplied by three user-provided desktop screenshots. Mobile unverified.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Creating a game never refreshes the list — "Game created · 30 pairs" and "No games in this space yet." on screen together. Open games have no badge; status is signalled by absence. |
| 2 | Match System / Real World | 2 | "Space (batch)" ships the internal name; the required source file is labelled "Reference files (optional)"; deadline defaults to 2:45 AM. |
| 3 | User Control and Freedom | 1 | Delete is irreversible behind `window.confirm`; switching source tab silently destroys the other side's selection; generated pairs are readable but not editable. |
| 4 | Consistency and Standards | 2 | The DS `Button` is used once; ~10 sibling buttons are hand-rolled at three heights (44px / ~34px / ~26px) in one viewport. |
| 5 | Error Prevention | 2 | Clipboard failure is swallowed, and the URL it told you to fall back on was removed from the DOM. Deleting a game breaks a link already pasted into an LMS. |
| 6 | Recognition Rather Than Recall | 2 | The saved-work row does not read as selectable. Rows show title + count + date — not source, modes, round length, or plays. Two identical titles distinguishable only by date. |
| 7 | Flexibility and Efficiency | 2 | No search/filter/sort; `max-h-56` shows ~4 of up to 42 artifacts; no bulk actions; segmented control has no arrow-key support. |
| 8 | Aesthetic and Minimalist Design | 2 | Seven targets per game row across two bands; an identical decorative Gamepad2 tile on every row encoding nothing. |
| 9 | Error Recovery | 2 | "The generation run failed before finishing" with no reason and no retry; list error banner is a dead end with `refresh` one call away. |
| 10 | Help and Documentation | 3 | Strong inline help (play-time estimate, deadline explainer, "leave this page, it keeps running"). Missing the one line that matters: what a student sees. |
| **Total** | | **20/40** | **Bottom of the normal band** |

## Design Specificity Verdict

**Authored composition, generic skin.**

The information architecture is specific to teaching. `gameTimeLimitMinutes(pairs)` → "About 15 min to play" converts a machine number into the only unit a lecturer thinks in, and it imports the same module the player runs on, so it cannot drift. Space-as-scope-not-field, killing the raw URL, dropping `expiresAt` because two dates raised "which one are students held to?" — those are decisions someone made about a lecturer.

The surface is stock Tailwind admin. `Games.tsx` contains zero `maia-*` classes. `maia-app-bg` paints the lavender gradient one DOM level up; this page lays flat opaque white cards over it and covers the signature. `.maia-glass` exists and is unused. Gold `#FCC018` — half the brand — appears nowhere except inside the DS Button's spinner bead, visible only while loading. The `h1` runs Inter, not Plus Jakarta Sans. Swap "Games" for "Campaigns" and "pairs" for "recipients" and the file ships unchanged in any B2B SaaS product.

Radii are the exception and it is accidental: `radii.css` is unlayered so `rounded-md/lg/xl` resolve to MILA's 10/12/16px rather than Tailwind's defaults. Nothing in the code knows this.

**Deterministic scan:** 2 findings, 1 rule (`gray-on-color`), both in `Games.tsx` (:289, :399). **Both are false positives** — the rule's regex is variant-blind, pairing a base gray with a `hover:`/`disabled:` background that never coexists with it. Both flagged lines carry a real defect one state over: 2.63:1 for the trash icon at rest, 2.13:1 for the disabled Save button.

The clean-ish detector output means very little. It ran in regex-only mode with no browser, so its accurate contrast passes never executed. Static analysis found 13 failing contrast pairs and a dead focus-ring pattern that produced zero automated findings.

**Visual overlays:** none. No Chrome MCP tool, no Playwright, no Puppeteer. No overlay exists in any browser tab.

## Overall Impression

The page thinks clearly about a lecturer and then abandons them at every edge. The build flow is coherent and the copy is genuinely warm. But the completion moment contradicts itself, the primary output can fail silently, the destructive action is guarded by an OS dialog, and after the link goes out the product never tells the lecturer whether a single student played — despite already holding that data.

Biggest opportunity: `gameModeStats` is fetched and rendered nowhere. Surfacing it turns a file manager for games into a teaching instrument.

## What's Working

**Space moved into the page header, not the form.** The batch decides what the whole page is about — builder and list — so making it the form's first question was a category error. Sibling `Assessments.tsx:163` still gets this wrong.

**Pair count answers in minutes.** Wired to the same timing module the game engine uses, so the estimate can't drift. The hint slot doubles as the error slot, so validation costs zero vertical space.

**The play link reduced to two verbs.** Copy and open are the only two things anyone does with a share URL. The 2-second `Copied` state with the emerald check is the right weight of feedback.

## Priority Issues

**[P0] The completion moment is broken and self-contradicting.**
`GenerationRunView.tsx:165` wires `onDelivered` to the run view's local `deliver`; `Games.tsx:611` only calls `onCreated()` from "Build another". Creating a game never refreshes the list, so "Game created · 30 pairs" sits above "No games in this space yet." Separately `deadlineIso` (`:623`) is `GameGenerator` state that dies on unmount — while the run view explicitly invites the lecturer to leave the page. Follow the app's own advice and your deadline is silently dropped.
*Fix:* call `onCreated()` from the create path; lift deadline out of component state (sessionStorage keyed by `run.currentRunId`, or pass it to `run.generate`). Then make completion a real beat — collapse the run panel, scroll the new row in, flash it with the existing `.mila-thought-flash`.
*Command:* `/impeccable harden the Games create→list handoff and deadline persistence`

**[P0] The link students depend on can fail silently and unrecoverably.**
`handleCopy` catches clipboard rejection and does nothing, reasoning in its own comment that "the link is on screen and selectable". The restructure removed the URL from the screen — the comment is now false. On an insecure origin or a locked-down university machine, the page's primary output becomes unobtainable with no error shown.
*Fix:* toast on catch, reveal a selectable read-only input with the URL. Add the missing reassurance: "Students open this on any device — no sign-in needed."
*Command:* `/impeccable harden the GamePlayLink copy fallback`

**[P0] The saved-work item doesn't read as selectable.** *(screenshot evidence)*
On "Use saved work" with one artifact listed, Generate stays disabled and the hint says "pick saved work to continue" — while the row is styled as a white card with a hairline border, visually identical to the information panels above it. Nothing says radio option. With exactly one artifact, why is it not preselected?
*Fix:* give unselected rows a real affordance (radio dot or a tinted resting state), raise the selected state to MILA's violet ring, and auto-select when exactly one artifact exists.
*Command:* `/impeccable clarify the saved-work selection affordance`

**[P1] Keyboard focus is invisible across the page.**
Every `focus:ring-violet-500` is written without a width utility. In Tailwind v4 `ring-<color>` sets `--tw-ring-color` only — no ring is emitted. Six inputs affected (`:179, 393, 735, 759, 777, 797`), and `AppLayout.tsx:38` sets `focus:outline-none` on `<main>` with no replacement. No hand-rolled button has any `focus-visible` style. The only control with a real focus ring is the DS `Button`. This is app-wide and it is a staffed accessibility requirement at a university.
*Fix:* add `ring-2` companions; route buttons through the DS `Button`, which already ships a correct `:focus-visible`.
*Command:* `/impeccable audit focus states across MILA`

**[P1] Destroying a live game is guarded by an OS dialog and nothing else.**
`window.confirm` at `:135`, no undo, no distinction between an unplayed game and one currently linked in a course announcement. Ten of these exist across the codebase, so fixing it once fixes the house.
*Fix:* DS `Modal` with a danger button naming the game and its play count; 6-second undo on the success toast (the row is already removed optimistically).
*Command:* `/impeccable harden destructive confirmations across MILA`

**[P1] The row carries no evidence anyone played.**
`gameModeStats` and `modes` are fetched by `listGames` and rendered nowhere. The row spends its leading 40px on an identical decorative tile repeated on every game. A lecturer's question is never "does this game exist" — they made it. It's "did my students use it".
*Fix:* replace the tile with the play count as the row's leading numeral, or a second line: "48 plays · matching, bucket". Sort by recent activity.
*Command:* `/impeccable shape the Games list row around play activity`

**[P2] Three names for one field, two button systems, two label systems.**
The tab says "Upload a document", the hint says "A PDF, slide deck, or notes file", the field says "Reference files (optional)" — and `hasSource` requires it. `Space (batch)` is a 10px tracked eyebrow while every other label is `text-sm font-semibold`. `artifactTypeLabel` returns Title Case against a sentence-case brand rule.
*Fix:* give `GenerationAttachments` a `label` prop so Games can say "Document" and mean it; unify labels; sentence-case the artifact types.
*Command:* `/impeccable polish the Games page onto the MILA design system`

**[P2] The page paints over its own brand.**
No `maia-*` class anywhere in the file. Flat white cards occlude the lavender canvas. No gold. `h1` in Inter, not Plus Jakarta Sans. The builder shares `rounded-xl` with the list rows and loses its hierarchy step (panels are 20px).
*Fix:* `.maia-glass` on the builder and rows, `rounded-2xl` on the builder, `font-display` on the h1, and one honest job for gold — the deadline-passed state currently uses a foreign `amber-600` where `--gold-600` is the brand's own "notice this".
*Command:* `/impeccable colorize the Games page in MILA glass and gold`

## Contrast failures (13 pairs)

The page heading block sits on the `maia-app-bg` gradient, not white. `text-slate-500` measures **3.14–4.39:1** across the gradient's three stops — failing everywhere. That covers the page description and the `SPACE (BATCH)` eyebrow. Also failing: trash icon at rest 2.63:1, disabled Save 2.13:1, the pairs em-dash separator 2.56:1, `text-amber-600` body text 3.20:1, empty-state icons at 1.49:1.

## Persona Red Flags

**Dr. Somchai — non-technical lecturer, 200 students, 10 minutes between classes.** The space silently resets to whichever batch sorts first (`useBatchSelection` has no persistence), so he builds for the wrong section and finds out from students. The field says "(optional)" so he skips it and Generate is disabled — the blocking reason sits *left* of the button in a `justify-end` row, reading as a caption rather than a blocker. Copy link fails silently on the lab machine. He sees "No games in this space yet" after creating one and generates a second.

**Ajarn Pim — returning three weeks later to extend a deadline.** Twelve identical violet tiles, twelve truncated agent-written titles, no source, no week, no plays. Open games have no badge — she has to know that nothing means open. She finds the row, clicks "Change", and gets a bare `datetime-local` with no "currently due Fri 12 Sep" and no "extend by a week" shortcut. `Remove` is styled `text-slate-400` — quieter than `Cancel`, though it's the destructive one.

**Keyboard / screen-reader lecturer.** The segmented control is two `aria-pressed` buttons announcing as independent toggles — no `role="radiogroup"`, no arrow keys, no group label. The artifact list has the same problem at up to 42 items. Tabbing produces no visible focus (see P1). The pairs disclosure has `aria-expanded` but no `aria-controls`, and the panel it reveals isn't the next tab stop. The delete button never sets `aria-busy`, and the toast in `Games.tsx` never auto-dismisses — unlike `Assessments.tsx:90`, same app.

## Minor Observations

- Deadline defaults to `now + 7 days` and inherits the current time — "Due Aug 8, 2:45 AM". Should land on end-of-day.
- The Space selector is pinned to the page's right edge while the builder stops ~500px short. Three right edges on one page; the header sides with the list and abandons the form.
- The native select truncates its own text under the chevron — no reserved right padding.
- The segmented control's active pill is white on `slate-50`: the selected state is nearly invisible.
- `text-[11px]` is off the type scale entirely (the system defines 10px and 12px).
- Toast never auto-dismisses in `Games.tsx`; `Assessments.tsx` clears at 5s.
- Empty saved-work state is a dead-end sentence with no link to the pages that would fix it.
- At narrow widths `min-w-0 flex-1` on the title plus `flex-shrink-0` on both button clusters truncates the title to nothing while three buttons keep full size.
- Delete sits ~8px from Copy link with no separator — most-used and most-destructive as neighbours.
- `min-h-[20rem]` exceeds `max-h-[70vh]` on viewports under ~457px tall.
- No `lg:`/`xl:` breakpoints anywhere; `GenerationAttachments` and `GenerationRunView` have no responsive classes at all.

## Questions to Consider

1. If `gameModeStats` were the row's headline instead of the title, what would this page become? "Week 3 terms: 8 of 200 played, closes Friday" is a page a lecturer opens on purpose.
2. Why does a lecturer choose the number of pairs at all? They know the document and the class length; the machine knows the term count and the round length. "Make a 15-minute game from this" is the lecturer's sentence. You already own the conversion — you're running it in the wrong direction.
3. The run view says "feel free to leave this page" and the deadline dies if you do. Which is the product's actual promise?
4. If a lecturer's link is what 200 students hold, why is it the least protected object in the app — one click to delete, no undo, no rotation, no expiry warning?
5. What is gold for? On the page where an AI reads a lecturer's document and finds the terms worth studying — the most insight-shaped thing MILA does — it appears zero times.
