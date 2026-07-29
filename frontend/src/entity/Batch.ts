export type Batch = {
  id: string
  batch_name: string
  course_name: string
  lecturer_id: string
  lecturer_email: string
  datastore_id: string
  storage_prefix: string
  academic_year: string
  term: string
  student_count: number
  status: string
  createdAt: Date | null
  updatedAt: Date | null
  /** Alias for batch_name — kept for backward compat until UI fully migrated. */
  label: string
}

export type BatchStudent = {
  id: string
  batch_id: string
  lecturer_id: string
  name: string
  email: string
  email_normalized: string
  status: string
  createdAt: Date | null
  updatedAt: Date | null
}
