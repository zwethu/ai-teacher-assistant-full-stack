import {
  BookOpen,
  FileQuestion,
  FlaskConical,
  Gamepad2,
  GraduationCap,
  Mail,
  type LucideIcon,
} from 'lucide-react'

/**
 * One icon per thing MILA makes, for every surface that draws one.
 *
 * These five icons were already the convention — the composer's mode menu, the
 * sign-in page's capability list, the Games list and the chat cards had each
 * arrived at them independently. Independently is the problem: the course plan
 * had picked up three different marks (GraduationCap in the composer, a Map pin
 * on the preview card, and BookOpen on the approval card, which is the lesson
 * plan's), and the Lesson Plans page drew a lesson plan two ways within four
 * lines of itself. A lecturer learns these shapes; they have to mean one thing.
 *
 * Icons only. Labels are deliberately not here — the same artifact is "Lab",
 * "Lab Preview" and "Lab Outline" depending on where it appears, and that is
 * correct.
 */
export type ArtifactKind =
  | 'course_blueprint'
  | 'lesson_plan'
  | 'lab'
  | 'assessment'
  | 'game'
  | 'email'

export const ARTIFACT_ICONS: Record<ArtifactKind, LucideIcon> = {
  course_blueprint: GraduationCap,
  lesson_plan: BookOpen,
  lab: FlaskConical,
  assessment: FileQuestion,
  game: Gamepad2,
  // Already the mark for email in the sidebar and the composer's mode menu;
  // it only reached this table when the batch tab started drawing an icon per
  // row, and an email was falling through to the lesson plan's book.
  email: Mail,
}

/** `quiz` is the artifact_type the agent writes; `assessment` is the composer
 *  mode and the page name. They are the same artifact. */
const ALIASES: Record<string, ArtifactKind> = { quiz: 'assessment' }

export function artifactKind(type: string): ArtifactKind | null {
  const key = ALIASES[type] ?? (type as ArtifactKind)
  return key in ARTIFACT_ICONS ? key : null
}

/**
 * The icon for an artifact type, falling back to the lesson plan's — the
 * default artifact everywhere else in the app, and what every call site here
 * already fell through to.
 */
export function artifactIcon(type: string): LucideIcon {
  return ARTIFACT_ICONS[artifactKind(type) ?? 'lesson_plan']
}
