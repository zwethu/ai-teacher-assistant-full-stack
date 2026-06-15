import type { BatchFile } from '../entity/File'
import api from '../lib/api'

export async function uploadBatchFile(
  batchId: string,
  file: File,
  fileTitle: string = '',
): Promise<BatchFile> {
  const form = new FormData()
  form.append('file', file)
  form.append('file_title', fileTitle || file.name)
  const res = await api.post<BatchFile>(`/batches/${batchId}/files`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

export async function listBatchFiles(batchId: string): Promise<BatchFile[]> {
  const res = await api.get<BatchFile[]>(`/batches/${batchId}/files`)
  return res.data
}

export async function deleteBatchFile(batchId: string, fileId: string): Promise<void> {
  await api.delete(`/batches/${batchId}/files/${fileId}`)
}
