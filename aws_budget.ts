export interface TrafficBudgetSnapshot {
  monthKey: string
  remainingGB: number
}

export interface DailyTrafficBudget {
  remainingDays: number
  dailyAvailableGB: number
}

export function getDailyBudget(
  data: TrafficBudgetSnapshot | null | undefined,
  now: Date = new Date()
): DailyTrafficBudget | null {
  if (!data || !Number.isFinite(now.getTime()) || !Number.isFinite(data.remainingGB)) {
    return null
  }

  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`
  if (data.monthKey !== monthKey) return null

  // Count UTC calendar days including today, not rolling 24-hour periods.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const remainingDays = lastDay - now.getUTCDate() + 1
  return {
    remainingDays,
    dailyAvailableGB: Math.max(0, data.remainingGB) / remainingDays
  }
}
