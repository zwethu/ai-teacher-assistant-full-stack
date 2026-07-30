import { FileCode, FileText, FileType, type LucideIcon } from 'lucide-react'
import type { ChatExportFormat } from '../../../services/chatService'

/**
 * One icon per export format, shared by the chat menu and the per-response
 * action bar so the same format never appears under two different marks.
 *
 * Lucide has no brand-specific file icons, so these are chosen for what each
 * format *is*: PDF a laid-out document, Markdown a plain-text markup source,
 * DOCX a typeset word-processor file.
 */
export const EXPORT_FORMAT_ICONS: Record<ChatExportFormat, LucideIcon> = {
  pdf: FileText,
  markdown: FileCode,
  docx: FileType,
}

/** Menu order — PDF first: it is the one lecturers hand to students. */
export const EXPORT_FORMATS: ChatExportFormat[] = ['pdf', 'markdown', 'docx']
