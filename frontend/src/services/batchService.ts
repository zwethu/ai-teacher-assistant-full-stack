import api from '../lib/api'
import type { Batch, BatchStudent } from '../entity/Batch'

export type CreateBatchPayload = {
  batch_name: string
  course_name: string
  academic_year: string
  term: string
  students: Array<{ name: string; email: string }>
}

function _apiBatchToBatch(data: Record<string, unknown>, id: string): Batch {
  const createdRaw = data.created_at as string | null | undefined
  const updatedRaw = data.updated_at as string | null | undefined
  const batchName = String(data.batch_name ?? '')
  return {
    id,
    batch_name: batchName,
    course_name: String(data.course_name ?? ''),
    lecturer_id: String(data.lecturer_id ?? ''),
    lecturer_email: String(data.lecturer_email ?? ''),
    datastore_id: String(data.datastore_id ?? ''),
    storage_prefix: String(data.storage_prefix ?? ''),
    academic_year: String(data.academic_year ?? ''),
    term: String(data.term ?? ''),
    student_count: Number(data.student_count ?? 0),
    status: String(data.status ?? 'active'),
    createdAt: createdRaw ? new Date(createdRaw) : null,
    updatedAt: updatedRaw ? new Date(updatedRaw) : null,
    label: batchName,
  }
}

export async function createBatch(payload: CreateBatchPayload): Promise<string> {
  const res = await api.post<{ batch_id: string }>('/batches', payload)
  return res.data.batch_id
}

export async function listBatches(): Promise<Batch[]> {
  const res = await api.get<Record<string, unknown>[]>('/batches')
  return res.data.map((d) => _apiBatchToBatch(d, String(d.batch_id ?? d.id ?? '')))
}

export async function deleteBatch(batchId: string): Promise<void> {
  await api.delete(`/batches/${batchId}`)
}

export async function getBatchStudentCount(batchId: string): Promise<number> {
  const batch = await getBatchById(batchId)
  return batch?.student_count ?? 0
}

export async function getBatchById(batchId: string): Promise<Batch | null> {
  try {
    const res = await api.get<Record<string, unknown>>(`/batches/${batchId}`)
    return _apiBatchToBatch(res.data, String(res.data.batch_id ?? batchId))
  } catch {
    return null
  }
}

export async function listBatchStudents(batchId: string): Promise<BatchStudent[]> {
  const res = await api.get<Record<string, unknown>[]>(`/batches/${batchId}/students`)
  return res.data.map((d) => ({
    id: String(d.id ?? ''),
    batch_id: String(d.batch_id ?? batchId),
    lecturer_id: String(d.lecturer_id ?? ''),
    name: String(d.name ?? ''),
    email: String(d.email ?? ''),
    email_normalized: String(d.email_normalized ?? ''),
    status: String(d.status ?? 'active'),
    createdAt: d.created_at ? new Date(d.created_at as string) : null,
    updatedAt: d.updated_at ? new Date(d.updated_at as string) : null,
  }))
}

export async function addStudentToBatch(
  batchId: string,
  name: string,
  email: string,
): Promise<void> {
  await api.post(`/batches/${batchId}/students`, { name, email })
}

export async function removeStudentFromBatch(
  batchId: string,
  studentId: string,
): Promise<void> {
  await api.delete(`/batches/${batchId}/students/${studentId}`)
}
