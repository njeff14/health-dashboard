import { getDb } from '@/lib/db'
import { format, subDays } from 'date-fns'
import { estimateWorkoutMetrics } from '@/lib/analytics/workoutEstimator'

// ── Types ──────────────────────────────────────────────────────────────
export interface DailyBodyBattery {
  day: string
  body_battery: number | null
  readiness: number | null
  training_readiness: number | null
  atl_norm: number | null
  recovery_ratio: number | null
  stress_weight: number | null
}

const TR_WEIGHTS = { hrv: 0.25, rhr: 0.35, recovery: 0.20, prev_night: 0.20 }

function calcTrainingReadiness(
  hrv: number | null,
  rhr: number | null,
  recovery: number | null,
  prevNight: number | null,
): number | null {
  const vals: [number | null, number][] = [
    [hrv,      TR_WEIGHTS.hrv],
    [rhr,      TR_WEIGHTS.rhr],
    [recovery, TR_WEIGHTS.recovery],
    [prevNight, TR_WEIGHTS.prev_night],
  ]
  const valid = vals.filter(([v]) => v != null) as [number, number][]
  if (!valid.length) return null
  const totalWeight = valid.reduce((s, [, w]) => s + w, 0)
  const raw = valid.reduce((s, [v, w]) => s + v * (w / totalWeight), 0)
  return Math.round(Math.max(0, Math.min(100, ((raw - 40) / 60) * 100)))
}

interface ReadinessRow {
  day: string
  score: number | null
  contributor_hrv_balance: number | null
  contributor_resting_heart_rate: number | null
  contributor_recovery_index: number | null
  contributor_previous_night: number | null
}
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
    SELECT day, score,
           contributor_hrv_balance, contributor_resting_heart_rate,
           contributor_recovery_index, contributor_previous_night
    FROM oura_daily_readiness
    WHERE day BETWEEN ? AND ?
    ORDER BY day
  `).all(startDate, endDate) as ReadinessRow[]

  const stressRows = db.prepare(`
    SELECT day, stress_high, recovery_high FROM oura_daily_stress
    WHERE day BETWEEN ? AND ?
    ORDER BY day
  `).all(startDate, endDate) as StressRow[]

  // Garmin activities (have real TE values)
  const garminRows = db.prepare(`
    SELECT start_day, duration_sec, aerobic_training_effect, anaerobic_training_effect
    FROM garmin_activities
    WHERE start_day BETWEEN ? AND ?
  `).all(atlLookbackStart, endDate) as ActivityRow[]

  // Oura workouts — estimate TE when Garmin data absent
  const settings = db.prepare(`SELECT key, value FROM user_settings WHERE key IN ('hr_max','hr_resting')`).all() as { key: string; value: string }[]
  const hrMax     = parseInt(settings.find(s => s.key === 'hr_max')?.value     ?? '190')
  const hrResting = parseInt(settings.find(s => s.key === 'hr_resting')?.value ?? '60')

  const garminDays = new Set(garminRows.map(r => r.start_day))
  const ouraWorkoutRows = db.prepare(`
    SELECT day as start_day, duration_sec, average_hr, intensity
    FROM oura_workouts
    WHERE day BETWEEN ? AND ? AND average_hr IS NOT NULL AND duration_sec IS NOT NULL
  `).all(atlLookbackStart, endDate) as { start_day: string; duration_sec: number; average_hr: number; intensity: string | null }[]

  // Only use Oura estimates for days that have no Garmin activity
  const ouraEstimated: ActivityRow[] = ouraWorkoutRows
    .filter(r => !garminDays.has(r.start_day))
    .map(r => {
      const est = estimateWorkoutMetrics({
        avgHr: r.average_hr,
        maxHr: hrMax,
        restingHr: hrResting,
        durationMin: r.duration_sec / 60,
        intensity: r.intensity,
      })
      return {
        start_day: r.start_day,
        duration_sec: r.duration_sec,
        aerobic_training_effect: est.aerobic_training_effect,
        anaerobic_training_effect: est.anaerobic_training_effect,
      }
    })

  const activityRows: ActivityRow[] = [...garminRows, ...ouraEstimated]

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
    const trainingReadiness = readiness
      ? calcTrainingReadiness(
          readiness.contributor_hrv_balance,
          readiness.contributor_resting_heart_rate,
          readiness.contributor_recovery_index,
          readiness.contributor_previous_night,
        )
      : null
    // Use training readiness for body battery; fall back to Oura readiness if contributors missing
    const readinessForBB = trainingReadiness ?? readinessScore

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

    if (readinessForBB == null) {
      results.push({ day, body_battery: null, readiness: readinessScore, training_readiness: null, atl_norm: null, recovery_ratio: null, stress_weight: null })
      continue
    }

    const recoveryComponent = recoveryRatio != null
      ? recoveryRatio * 100 * 0.20 * stressWeight
      : 10 * stressWeight // fallback: assume 50% recovery ratio

    const bb = (readinessForBB * 0.50) + ((100 - atlNorm) * 0.30) + recoveryComponent

    results.push({
      day,
      body_battery: Math.round(Math.min(100, Math.max(0, bb)) * 10) / 10,
      readiness: readinessScore,
      training_readiness: trainingReadiness,
      atl_norm: Math.round(atlNorm * 10) / 10,
      recovery_ratio: recoveryRatio != null ? Math.round(recoveryRatio * 1000) / 1000 : null,
      stress_weight: Math.round(stressWeight * 100) / 100,
    })
  }

  return results
}
