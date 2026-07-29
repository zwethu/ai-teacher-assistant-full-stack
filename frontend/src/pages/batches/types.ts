import type { Batch } from '../../entity/Batch'

export type DetailTab = 'students' | 'materials' | 'artifacts' | 'planning'
export type CreateStep = 'details' | 'method' | 'manual' | 'csv'
export type StudentRow = { name: string; email: string }
export type BatchWithCount = Batch

export type BatchDetails = {
  batch_name: string
  course_name: string
  academic_year: string
  term: string
}
