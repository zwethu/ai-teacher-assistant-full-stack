import type { Timestamp } from 'firebase/firestore'
import type { FirestoreTimestamp } from '../types'

type TimestampLike = Timestamp | { toDate: () => Date }

export function toDate(input: FirestoreTimestamp | TimestampLike | unknown): Date | null {
  if (input == null) return null

  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input
  }

  if (
    typeof input === 'object' &&
    input !== null &&
    'toDate' in input &&
    typeof (input as TimestampLike).toDate === 'function'
  ) {
    const d = (input as TimestampLike).toDate()
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null
  }

  if (typeof input === 'number') {
    const d = new Date(input)
    return Number.isNaN(d.getTime()) ? null : d
  }

  if (typeof input === 'string') {
    const d = new Date(input.includes('T') ? input : `${input}T12:00:00`)
    return Number.isNaN(d.getTime()) ? null : d
  }

  return null
}

export function formatDate(timestamp: FirestoreTimestamp | unknown): string {
  const date = toDate(timestamp)
  if (!date) return '—'
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatDateTime(timestamp: FirestoreTimestamp | unknown): string {
  const date = toDate(timestamp)
  if (!date) return '—'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function timeAgo(timestamp: FirestoreTimestamp | unknown): string {
  const date = toDate(timestamp)
  if (!date) return '—'

  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'Just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }

  const days = Math.floor(hours / 24)
  if (days < 30) {
    return `${days} day${days === 1 ? '' : 's'} ago`
  }

  return formatDate(date)
}

/** @deprecated Use timeAgo */
export const timeago = timeAgo
