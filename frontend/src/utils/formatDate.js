/**
 * Normalize Firestore Timestamp, ISO string, epoch ms, or Date to Date | null.
 * @param {unknown} input
 */
export function toDate(input) {
  if (input == null) return null

  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input
  }

  if (typeof input?.toDate === 'function') {
    const d = input.toDate()
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

/**
 * @param {unknown} timestamp
 * @returns {string}
 */
export function formatDate(timestamp) {
  const date = toDate(timestamp)
  if (!date) return '—'
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * @param {unknown} timestamp
 * @returns {string}
 */
export function formatDateTime(timestamp) {
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

/**
 * @param {unknown} timestamp
 * @returns {string}
 */
export function timeAgo(timestamp) {
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
