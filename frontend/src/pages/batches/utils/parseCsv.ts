import type { StudentRow } from '../types'

export function parseCsv(text: string): StudentRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) {
    throw new Error('CSV must have a header row and at least one data row.')
  }

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase())
  const nameIdx = headers.indexOf('name')
  const emailIdx = headers.indexOf('email')
  if (nameIdx === -1 || emailIdx === -1) {
    throw new Error('CSV must include "name" and "email" columns.')
  }

  return lines
    .slice(1)
    .map((line) => {
      const cols = line.split(',').map((c) => c.trim())
      return { name: cols[nameIdx] ?? '', email: cols[emailIdx] ?? '' }
    })
    .filter((r) => r.name && r.email)
}
