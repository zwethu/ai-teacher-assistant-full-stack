import type { StudentRow } from '../types'

/**
 * MFU issues every student an address of `<student id>@lamduan.mfu.ac.th`, but the
 * class lists lecturers export carry the id and not the address — `name,student_id,major`
 * is the shape that actually arrives. Requiring an `email` column rejected those files
 * and left the lecturer retyping a column the university already derives by rule.
 */
export const STUDENT_EMAIL_DOMAIN = 'lamduan.mfu.ac.th'

const NAME_HEADERS = ['name', 'student_name', 'student name', 'fullname', 'full_name', 'full name']
const EMAIL_HEADERS = [
  'email', 'student_email', 'student email', 'e-mail', 'email_address', 'email address', 'mail',
]
/* Only headers that unambiguously mean "the university's student id". A bare `id`
   is deliberately absent: on the add-to-existing-batch path the rows are imported
   with no preview, and a row-number column named `id` would silently mint a class
   full of wrong addresses. */
const ID_HEADERS = [
  'student_id', 'student id', 'studentid', 'student-id', 'student_no', 'student no', 'studentno',
]

/** The id as the registry issues it — no spaces, no stray punctuation. */
const ID_PATTERN = /^[A-Za-z0-9._-]+$/

function findColumn(headers: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const index = headers.indexOf(candidate)
    if (index !== -1) return index
  }
  return -1
}

/**
 * Build the university address for a student id.
 *
 * Returns '' for anything that would produce a malformed address, so the row is
 * dropped rather than imported as a mailbox nobody reads.
 */
export function emailFromStudentId(studentId: string): string {
  const id = studentId.trim()
  if (!id) return ''
  // Someone put the address itself under the id column. Take it as given rather
  // than producing `6731503088@lamduan.mfu.ac.th@lamduan.mfu.ac.th`.
  if (id.includes('@')) return id.toLowerCase()
  return ID_PATTERN.test(id) ? `${id}@${STUDENT_EMAIL_DOMAIN}`.toLowerCase() : ''
}

export function parseCsv(text: string): StudentRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) {
    throw new Error('CSV must have a header row and at least one data row.')
  }

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase())
  const nameIdx = findColumn(headers, NAME_HEADERS)
  const emailIdx = findColumn(headers, EMAIL_HEADERS)
  const idIdx = findColumn(headers, ID_HEADERS)

  if (emailIdx === -1 && idIdx === -1) {
    throw new Error(
      `CSV must include an "email" column, or a "student_id" column to build @${STUDENT_EMAIL_DOMAIN} addresses from.`,
    )
  }
  if (nameIdx === -1 && idIdx === -1) {
    throw new Error('CSV must include a "name" column.')
  }

  return lines
    .slice(1)
    .map((line) => {
      const cols = line.split(',').map((c) => c.trim())
      const studentId = idIdx === -1 ? '' : (cols[idIdx] ?? '')
      /* An address in the file always wins; the id is the fallback. Written as
         `||` rather than a branch on the header so that a file which has an email
         column with some cells left blank fills those rows in too. */
      const email = (emailIdx === -1 ? '' : (cols[emailIdx] ?? '')) || emailFromStudentId(studentId)
      const name = (nameIdx === -1 ? '' : (cols[nameIdx] ?? '')) || studentId
      return { name, email }
    })
    .filter((row) => row.name && row.email)
}
