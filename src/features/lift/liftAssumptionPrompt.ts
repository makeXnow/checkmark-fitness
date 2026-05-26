import { localDateISO } from '../../lib/localDate'

function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10))
  return new Date(y, m - 1, d)
}

/** "today", "yesterday", or "Monday, July 3rd" when more than 2 calendar days ago. */
export function formatAssumptionWhenLabel(localDate: string, today = new Date()): string {
  const todayISO = localDateISO(today)
  if (localDate === todayISO) return 'today'

  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (localDate === localDateISO(yesterday)) return 'yesterday'

  const target = parseLocalDate(localDate)
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  const diffDays = Math.round((startOfToday.getTime() - startOfTarget.getTime()) / 86_400_000)

  if (diffDays <= 2) {
    return target.toLocaleDateString('en-US', { weekday: 'long' })
  }

  const weekday = target.toLocaleDateString('en-US', { weekday: 'long' })
  const month = target.toLocaleDateString('en-US', { month: 'long' })
  return `${weekday}, ${month} ${ordinal(target.getDate())}`
}

export function assumptionPromptMessage(dayName: string, localDate: string): string {
  const when = formatAssumptionWhenLabel(localDate)
  return `Did you do a ${dayName} workout ${when}?`
}
