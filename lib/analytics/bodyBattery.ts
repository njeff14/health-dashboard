import { getDb } from '@/lib/db'
import { format, subDays } from 'date-fns'

// ── Types ──────────────────────────────────────────────────────────────
export interface DailyBodyBattery {
  day: string
  body_battery: number | null
  readiness: number | null
  atl_norm: number | null
  recovery_ratio: number | null
  stress_weight: number | null
}

interface ReadinessRow { day: string; score: number | null }
interface StressRow { day: string; stress_high: number | null; recovery_high: number | null }
interface ActivityRow {
  start_day: string
  duration_sec: number
  aerobic_training_effect: number | null
  anaerobic_training_effect: number | null
}

// ── Helpers ────────────────────────────────────────────────────────────
function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function daysBetween(a: string, b: string): number {
  const da = parseLocalDate(a)
  const db = parseLocalDate(b)
  return Math.round((db.getTime() - da.getTime()) / 86400000)
}

const DECAY_CONSTANT = Math.LN2 / 7 // ~0.099

function computeATL(activities: ActivityRow[], targetDay: string, lookbackDays: number = 21): number {
  let atl = 0
  for (const a of activities) {
    const daysAgo = daysBetween(a.start_day, targetDay)
    if (daysAgo < 0 || daysAgo > lookbackDays) continue
    const aero = a.aerobic_training_effect ?? 0
    const anaero = a.anaerobic_training_effect ?? 0
    const sessionStress = (aero * 10) + (anaero * 15)
    atl += sessionStress * Math.exp(-DECAY_CONSTANT * daysAgo)
  }
  return atl
}

// ── Main computation ───────────────────────────────────────────────────
export function computeDailyBodyBattery(startDate: string, endDate: string): DailyBodyBattery[] {
  const db = getDb()

  // We need 21 extra days of lookback for ATL
  const atlLookbackStart = format(subDays(parseLocalDate(startDate), 21), 'yyyy-MM-dd')

  const readinessRows = db.prepare(`
    SELECT day, score FROM oura_daily_readiness
    WHERE day BETWEEN ? AND ?
    ORDER BY day
  `).all(startDate, endDate) as ReadinessRow[]

  const stressRows = db.prepare(`
    SELECT day, stress_high, recovery_high FROM oura_daily_stress
    WHERE day BETWEEN ? AND ?
    ORDER BY day
  `).all(startDate, endDate) as StressRow[]

  const activityRows = db.prepare(`
    SELECT start_day, duration_sec, aerobic_training_effect, anaerobic_training_effect
    FROM garmin_activities
    WHERE start_day BETWEEN ? AND ?
  `).all(atlLookbackStart, endDate) as ActivityRow[]

  // Build lookup maps
  const readinessMap = new Map(readinessRows.map(r => [r.day, r]))
  const stressMap = new Map(stressRows.map(r => [r.day, r]))

  // Group activities by day
  const activitiesByDay = new Map<string, ActivityRow[]>()
  for (const a of activityRows) {
    const list = activitiesByDay.get(a.start_day) || []
    list.push(a)
    activitiesByDay.set(a.start_day, list)
  }

  // Compute raw ATL for all days to find 95th percentile
  const allDays: string[] = []
  let current = parseLocalDate(startDate)
  const end = parseLocalDate(endDate)
  while (current <= end) {
    allDays.push(format(current, 'yyyy-MM-dd'))
    current = new Date(current.getTime() + 86400000)
  }

  const rawATLs = allDays.map(day => computeATL(activityRows, day))
  // Fixed cap: raw ATL a recreational athlete would hit training ~5x/week at high intensity.
  // Prevents the self-defeating p95-of-your-own-data problem where consistent training
  // makes every day look like 100% load.
  const ATL_CAP = 500

  // Compute body battery for each day
  const results: DailyBodyBattery[] = []
  for (let i = 0; i < allDays.length; i++) {
    const day = allDays[i]
    const readiness = readinessMap.get(day)
    const stress = stressMap.get(day)
    const dayActivities = activitiesByDay.get(day) || []

    const readinessScore = readiness?.score ?? null
    const atlRaw = rawATLs[i]
    const atlNorm = Math.min(100, (atlRaw / ATL_CAP) * 100)

    // Recovery ratio
    let recoveryRatio: number | null = null
    if (stress && stress.recovery_high != null && stress.stress_high != null) {
      const total = stress.stress_high + stress.recovery_high
      recoveryRatio = total > 0 ? stress.recovery_high / total : 0.5
    }

    // Stress weight: non_workout_hours / 24
    let stressWeight = 1.0
    if (dayActivities.length > 0) {
      const workoutHours = dayActivities.reduce((sum, a) => {
        return sum + (a.duration_sec / 3600) + 1 // +1hr cooldown per activity
      }, 0)
      stressWeight = Math.max(0, (24 - workoutHours) / 24)
    }

    if (readinessScore == null) {
      results.push({ day, body_battery: null, readiness: null, atl_norm: null, recovery_ratio: null, stress_weight: null })
      continue
    }

    const recoveryComponent = recoveryRatio != null
      ? recoveryRatio * 100 * 0.20 * stressWeight
      : 10 * stressWeight // fallback: assume 50% recovery ratio

    const bb = (readinessScore * 0.50) + ((100 - atlNorm) * 0.30) + recoveryComponent

    results.push({
      day,
      body_battery: Math.round(Math.min(100, Math.max(0, bb)) * 10) / 10,
      readiness: readinessScore,
      atl_norm: Math.round(atlNorm * 10) / 10,
      recovery_ratio: recoveryRatio != null ? Math.round(recoveryRatio * 1000) / 1000 : null,
      stress_weight: Math.round(stressWeight * 100) / 100,
    })
  }

  return results
}
