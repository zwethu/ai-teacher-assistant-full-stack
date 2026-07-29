import type { ReactNode } from 'react'
import {
  BookOpen,
  FileQuestion,
  FlaskConical,
  Gamepad2,
  Globe,
  GraduationCap,
  History,
  Mail,
  Paperclip,
  Plus,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Spinner, Switch } from '../../../design-system'

/**
 * The composer's chrome, shared by the chat page and "start a new chat" on a
 * batch. Both are the same control doing the same job, so they share one
 * definition of the glass surface, the textarea metrics, the control row and
 * the hint line rather than two copies that drift apart.
 *
 * Only the chrome lives here. What goes in the control row is the caller's
 * business — chat has attachments, workflow modes and a stop button; the batch
 * page has none of that.
 */

/**
 * MILA's glass surface at composer radius. `.maia-glass` is the design system's
 * own white/55 + hairline + 32px shadow, plus the saturate and specular top
 * edge. Radius stays at 22px rather than `.maia-liquid-pill`'s full round,
 * because the box grows with the textarea and attachments.
 */
export function ComposerSurface({ children }: { children: ReactNode }) {
  return <div className="maia-glass rounded-[22px] px-2 pb-1.5 pt-0.5">{children}</div>
}

/**
 * Web search armed → the composer nests inside a tinted violet shell with a
 * strip saying why, rather than just glowing.
 */
export function ComposerTint({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div
      className={
        active
          ? 'rounded-[26px] border border-violet-200/70 bg-violet-50/60 p-1 transition-colors'
          : 'transition-colors'
      }
    >
      {children}
    </div>
  )
}

/** Textarea metrics: one line to start, growing to ~6 before it scrolls. */
export const COMPOSER_TEXTAREA_CLASS =
  'block max-h-40 min-h-[38px] w-full resize-none overflow-y-auto bg-transparent px-3 pb-0.5 pt-2.5 text-[15px] leading-6 text-slate-800 placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed'

/** Bottom row of the box: leading controls, a spacer, then the send button. */
export function ComposerControls({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2 px-1">{children}</div>
}

/** Pushes whatever follows it to the right edge of the control row. */
export function ComposerSpacer() {
  return <span className="min-w-0 flex-1" />
}

export function ComposerHint({ children }: { children: ReactNode }) {
  return <p className="mt-2.5 text-center text-xs text-slate-400">{children}</p>
}

/**
 * Web-search toggle. A real left-right switch, not a tap-to-arm pill — the
 * design system's own Switch, whose prompt names "Web Search" as its example.
 * The outer <label htmlFor> lets the icon and text toggle it too; an input may
 * have more than one label.
 */
export function WebSearchToggle({
  id,
  checked,
  disabled,
  onChange,
}: {
  id: string
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div
      className={`inline-flex flex-shrink-0 items-center gap-2 rounded-full py-1 pl-3 pr-2.5 text-sm transition-colors ${
        checked
          ? 'maia-glass-tint font-medium text-violet-900'
          : 'border border-slate-200/90 font-medium text-slate-600'
      }`}
    >
      <Globe className="h-4 w-4 flex-shrink-0" />
      <label htmlFor={id} className="cursor-pointer select-none">
        Web search
      </label>
      {/* DS Switch is an <input type="checkbox">, so unwrap the event. */}
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Generation modes
// ---------------------------------------------------------------------------

export type GenerateMode =
  | 'lesson_plan'
  | 'lab'
  | 'assessment'
  | 'course_blueprint'
  | 'email'
  | 'game'

type ModeSpec = {
  mode: GenerateMode
  label: string
  icon: LucideIcon
  placeholder: string
  /** Email is not a preview workflow, so it sits below a rule. */
  separatorBefore?: boolean
}

/**
 * One table drives the + menu, the active chip's label and icon, and the
 * textarea placeholder. They used to be three parallel ternary chains, which is
 * exactly the kind of thing that goes out of sync when a mode is added.
 */
export const GENERATE_MODES: ModeSpec[] = [
  {
    mode: 'course_blueprint',
    label: 'Course Plan',
    icon: GraduationCap,
    placeholder:
      'Describe the course plan you want, e.g. a 12-week plan focused on applied data skills...',
  },
  {
    mode: 'lesson_plan',
    label: 'Lesson Plan Preview',
    icon: BookOpen,
    placeholder: 'Describe the lesson plan preview you want, e.g. Week 1 intro to Power BI...',
  },
  {
    mode: 'lab',
    label: 'Lab Preview',
    icon: FlaskConical,
    placeholder: 'Describe the lab preview you want, e.g. Week 3 Firebase guestbook lab...',
  },
  {
    mode: 'assessment',
    label: 'Assessment Preview',
    icon: FileQuestion,
    placeholder:
      'Describe the assessment preview you want, e.g. Week 3 mixed quiz, 10 questions...',
  },
  {
    mode: 'game',
    label: 'Study Game',
    icon: Gamepad2,
    placeholder: 'Attach a PDF, then describe the game, e.g. a matching game from these lecture notes...',
  },
  {
    mode: 'email',
    label: 'Send Email',
    icon: Mail,
    placeholder:
      'Describe the email you want, e.g. remind students about the Friday quiz deadline...',
    separatorBefore: true,
  },
]

export function modeSpec(mode: GenerateMode | null): ModeSpec | undefined {
  return GENERATE_MODES.find((spec) => spec.mode === mode)
}

/**
 * The "+" button and its menu: attach files, optionally reach earlier
 * attachments, then start a generation workflow.
 *
 * Web search is deliberately absent — it lives on the toggle in the control
 * row, and having it in both places meant two controls for one setting.
 */
export function ComposerAddMenu({
  open,
  onOpenChange,
  onAttach,
  attachDisabled = false,
  uploading = false,
  disabled = false,
  onOpenPreviousAttachments,
  onSelectMode,
  menuRef,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAttach: () => void
  attachDisabled?: boolean
  uploading?: boolean
  disabled?: boolean
  /** Omitted where there is no chat history to reach into yet. */
  onOpenPreviousAttachments?: () => void
  onSelectMode: (mode: GenerateMode) => void
  menuRef?: React.RefObject<HTMLDivElement | null>
}) {
  const item =
    'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        disabled={disabled}
        className="mb-0.5 ml-1 inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Add files, generate, or toggle web search"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {uploading ? <Spinner size={16} /> : <Plus className="h-5 w-5" />}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-30 mb-2 w-60 overflow-hidden rounded-2xl border border-white/60 bg-white/95 p-1 shadow-xl backdrop-blur-xl"
        >
          <button role="menuitem" type="button" onClick={onAttach} disabled={attachDisabled} className={item}>
            <Paperclip className="h-4 w-4 text-slate-500" />
            Add files or photos
          </button>
          {onOpenPreviousAttachments && (
            <button role="menuitem" type="button" onClick={onOpenPreviousAttachments} className={item}>
              <History className="h-4 w-4 text-slate-500" />
              Previous attachments
            </button>
          )}
          <div className="my-1 border-t border-slate-100" />
          {GENERATE_MODES.map((spec) => {
            const Icon = spec.icon
            return (
              <div key={spec.mode}>
                {spec.separatorBefore && <div className="my-1 border-t border-slate-100" />}
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => onSelectMode(spec.mode)}
                  className={item}
                >
                  <Icon className="h-4 w-4 text-violet-600" />
                  {spec.label}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Active workflow chip. Sits beside the web-search toggle rather than floating
 * above the composer, in the same tinted glass, so the two read as one row of
 * active state.
 */
export function ComposerModeChip({
  mode,
  onClear,
}: {
  mode: GenerateMode
  onClear: () => void
}) {
  const spec = modeSpec(mode)
  if (!spec) return null
  const Icon = spec.icon
  return (
    <span className="maia-glass-tint inline-flex min-w-0 shrink items-center gap-1.5 rounded-full py-1 pl-3 pr-1.5 text-sm font-medium text-violet-900">
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span className="truncate">{spec.label}</span>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-violet-700 hover:bg-violet-100"
        aria-label={`Clear ${spec.label}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  )
}
