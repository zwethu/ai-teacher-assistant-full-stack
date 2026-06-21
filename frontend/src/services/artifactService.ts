import api from '../lib/api'

export type Artifact = {
  id: string
  type: string
  artifact_type?: string
  title: string
  batch_id: string
  batch_name?: string
  course_name?: string
  week?: number | null
  version?: number
  status?: string
  is_current?: boolean
  doc_url?: string
  doc_id?: string
  form_url?: string
  form_id?: string
  drive_file_name?: string
  drive_folder_id?: string
  drive_folder_url?: string
  metadata?: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

export type ArtifactSummary = {
  drive_root_folder_id: string
  drive_root_folder_url: string
  counts: Record<string, { current: number; total: number }>
  by_week: Array<{ week: number; artifacts: Artifact[] }>
}

export type DeleteArtifactResult = {
  artifact_id: string
  deleted_drive_file_ids: string[]
  already_missing_drive_file_ids: string[]
  delete_google: boolean
  promoted_artifact_id?: string | null
  deletion_id: string
}

export async function listArtifacts(
  batchId: string,
  filters: { type?: string; week?: number; current?: boolean; status?: string } = {},
): Promise<Artifact[]> {
  const res = await api.get<Artifact[]>(`/batches/${batchId}/artifacts`, { params: filters })
  return res.data
}

export async function getArtifact(batchId: string, artifactId: string): Promise<Artifact> {
  const res = await api.get<Artifact>(`/batches/${batchId}/artifacts/${artifactId}`)
  return res.data
}

export async function getArtifactSummary(batchId: string): Promise<ArtifactSummary> {
  const res = await api.get<ArtifactSummary>(`/batches/${batchId}/artifacts/summary`)
  return res.data
}

export async function deleteArtifact(
  batchId: string,
  artifactId: string,
  deleteGoogle = true,
): Promise<DeleteArtifactResult> {
  const res = await api.delete<DeleteArtifactResult>(`/batches/${batchId}/artifacts/${artifactId}`, {
    params: { delete_google: deleteGoogle },
  })
  return res.data
}
