import type { CreateStep } from '../types'

export function modalTitle(step: CreateStep): string {
  switch (step) {
    case 'details':
      return 'Create New Batch — Details'
    case 'csv':
      return 'Create Batch — Upload CSV'
    case 'manual':
      return 'Create Batch — Add Manually'
    default:
      return 'Create New Batch'
  }
}
