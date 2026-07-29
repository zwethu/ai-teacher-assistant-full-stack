import { Fragment } from 'react'
import { Check } from 'lucide-react'
import { ACCENT, type GenAccent } from './generationTheme'
import type { GenerationStage } from './generationStage'
import { Spinner } from '../../design-system'

const STEPS = ['Outline', 'Review', 'Full preview', 'Done'] as const

// active = index currently in progress; done = number of fully-completed steps.
const STAGE_MAP: Record<GenerationStage, { active: number; done: number; busy: boolean }> = {
  idle: { active: 0, done: 0, busy: false },
  generating_outline: { active: 0, done: 0, busy: true },
  outline_review: { active: 1, done: 1, busy: false },
  generating_full: { active: 2, done: 2, busy: true },
  preview: { active: 3, done: 3, busy: false },
  done: { active: 3, done: 4, busy: false },
  failed: { active: -1, done: 0, busy: false },
  cancelled: { active: -1, done: 0, busy: false },
}

export function GenerationStepper({
  stage,
  accent,
}: {
  stage: GenerationStage
  accent: GenAccent
}) {
  const theme = ACCENT[accent]
  const solidBg = theme.solid.split(' ')[0]
  const { active, done, busy } = STAGE_MAP[stage]

  return (
    <ol className="flex items-center gap-2 text-xs font-medium">
      {STEPS.map((label, index) => {
        const isDone = index < done
        const isActive = index === active
        return (
          <Fragment key={label}>
            <li className="flex flex-shrink-0 items-center gap-1.5">
              <span
                className={[
                  'flex h-6 w-6 items-center justify-center rounded-full border text-[11px] transition-colors',
                  isDone
                    ? `border-transparent text-white ${solidBg}`
                    : isActive
                      ? `${theme.softBg} ${theme.softBorder} ${theme.text} ring-2 ${theme.ring}`
                      : 'border-slate-200 bg-white text-slate-400',
                ].join(' ')}
              >
                {isDone ? (
                  <Check className="h-3.5 w-3.5" />
                ) : isActive && busy ? (
                  <Spinner size={14} />
                ) : (
                  index + 1
                )}
              </span>
              <span className={isDone || isActive ? theme.text : 'text-slate-400'}>{label}</span>
            </li>
            {index < STEPS.length - 1 && (
              <span className={`h-px flex-1 ${isDone ? solidBg : 'bg-slate-200'}`} />
            )}
          </Fragment>
        )
      })}
    </ol>
  )
}
