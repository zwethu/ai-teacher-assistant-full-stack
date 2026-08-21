import { describe, expect, it } from 'vitest'

import { emailFromStudentId, parseCsv, STUDENT_EMAIL_DOMAIN } from './parseCsv'

describe('a class list with an email column', () => {
  it('reads the addresses as given', () => {
    expect(parseCsv('name,email\nJohn Carter,john@example.com')).toEqual([
      { name: 'John Carter', email: 'john@example.com' },
    ])
  })

  it('accepts the header spellings that turn up in exports', () => {
    expect(parseCsv('student_name,student_email\nJohn Carter,john@example.com')).toEqual([
      { name: 'John Carter', email: 'john@example.com' },
    ])
  })
})

describe('a class list with only a student id', () => {
  /** The real shape of `docs/fake_student_data.csv`. */
  it('builds the university address from the id', () => {
    const csv = [
      'name,student_id,major',
      'John Carter,6731503087,Software Engineering',
      'Emma Wilson,6731504126,Computer Science',
    ].join('\n')

    expect(parseCsv(csv)).toEqual([
      { name: 'John Carter', email: `6731503087@${STUDENT_EMAIL_DOMAIN}` },
      { name: 'Emma Wilson', email: `6731504126@${STUDENT_EMAIL_DOMAIN}` },
    ])
  })

  it('falls back to the id as the name when the file has no name column', () => {
    expect(parseCsv('student_id\n6731503087')).toEqual([
      { name: '6731503087', email: `6731503087@${STUDENT_EMAIL_DOMAIN}` },
    ])
  })

  it('fills in only the rows whose email cell is blank', () => {
    const csv = [
      'name,student_id,email',
      'John Carter,6731503087,',
      'Emma Wilson,6731504126,emma@personal.example',
    ].join('\n')

    expect(parseCsv(csv)).toEqual([
      { name: 'John Carter', email: `6731503087@${STUDENT_EMAIL_DOMAIN}` },
      { name: 'Emma Wilson', email: 'emma@personal.example' },
    ])
  })

  it('names the id column in the error when the file has neither', () => {
    expect(() => parseCsv('name,major\nJohn Carter,Software Engineering')).toThrow(/student_id/)
  })
})

describe('building an address from an id', () => {
  it('appends the domain to a plain id', () => {
    expect(emailFromStudentId('6731503087')).toBe(`6731503087@${STUDENT_EMAIL_DOMAIN}`)
  })

  it('does not append twice when the id column already holds an address', () => {
    expect(emailFromStudentId('6731503087@lamduan.mfu.ac.th')).toBe('6731503087@lamduan.mfu.ac.th')
  })

  it('drops an id that would build a malformed address', () => {
    // A row that is really a note, a merged cell, or a stray heading. Better no
    // student than a mailbox nobody reads.
    expect(emailFromStudentId('67315 03087')).toBe('')
    expect(emailFromStudentId('')).toBe('')
    expect(parseCsv('name,student_id\nJohn Carter,not an id')).toEqual([])
  })
})

describe('a bare "id" column', () => {
  it('is not treated as a student id', () => {
    // Add-to-existing-batch imports with no preview, so guessing here would mint a
    // class full of wrong addresses from what is often just a row number.
    expect(() => parseCsv('name,id\nJohn Carter,1')).toThrow(/must include an "email" column/)
  })
})
