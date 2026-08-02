import { describe, expect, it } from 'vitest'
import { BookOpen, FileQuestion, FlaskConical, Gamepad2, GraduationCap, Mail } from 'lucide-react'

import { ARTIFACT_ICONS, artifactIcon, artifactKind } from './artifactIcons'
import { GENERATE_MODES } from '../pages/chat/components/ComposerSurface'

/**
 * Five surfaces draw these icons — the composer menu, the chat cards, the three
 * standalone pages, the sidebar and the sign-in list. They drifted apart once
 * already: the course plan had three different marks, one of them the lesson
 * plan's. This is the pin.
 */
describe('artifact icons', () => {
  it('gives each artifact its own mark', () => {
    const marks = Object.values(ARTIFACT_ICONS)
    expect(new Set(marks).size).toBe(marks.length)
  })

  it('holds the marks the app already taught lecturers', () => {
    expect(ARTIFACT_ICONS).toEqual({
      course_blueprint: GraduationCap,
      lesson_plan: BookOpen,
      lab: FlaskConical,
      assessment: FileQuestion,
      game: Gamepad2,
      // The sidebar's and the composer's mark for email, which only needed to
      // be here once a surface drew an icon per artifact row.
      email: Mail,
    })
  })

  it('treats the quiz artifact and the assessment mode as one thing', () => {
    expect(artifactKind('quiz')).toBe('assessment')
    expect(artifactIcon('quiz')).toBe(artifactIcon('assessment'))
  })

  it('falls back to the lesson plan for anything unrecognised', () => {
    expect(artifactKind('')).toBeNull()
    expect(artifactIcon('something_new')).toBe(ARTIFACT_ICONS.lesson_plan)
  })

  it('agrees with the composer, which is where lecturers meet each one first', () => {
    for (const spec of GENERATE_MODES) {
      const kind = artifactKind(spec.mode)
      if (!kind) continue // `email` is not an artifact
      expect(spec.icon, `${spec.mode} chip`).toBe(ARTIFACT_ICONS[kind])
    }
  })
})
