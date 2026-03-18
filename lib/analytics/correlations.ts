import { getDb } from '@/lib/db'
import { computeDailyBodyBattery } from '@/lib/analytics/bodyBattery'
import { computeVO2maxEstimates } from '@/lib/analytics/vo2maxEstimator'
import { isTagMetric, getTagText, needsWorkoutJoin } from '@/lib/analytics/metricPool'

/** Add one calendar day to a YYYY-MM-DD string using local time (avoids UTC shift). */
function localAddDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

export function pearsonR(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n < 2) return 0
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, dx2 = 0, dy2 = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my
    num += dx * dy
    dx2 += dx * dx
    dy2 += dy * dy
  }
  const denom = Math.sqrt(dx2 * dy2)
  return denom === 0 ? 0 : num / denom
}

export function rollingAverage(values: number[], window: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < window - 1) return null
    const slice = values.slice(i - window + 1, i + 1)
    return slice.reduce((a, b) => a + b, 0) / window
  })
}

export interface CorrelationPoint {
  date: string
  x: number
  y: number
  activity_type?: string
  training_effect_label?: string
}

// ---------- unified day map ----------

interface DayData {
  day: string
  // daily health
  sleep_score: number | null
  readiness_score: number | null
  hrv: number | null
  resting_hr: number | null
  activity_score: number | null
  body_battery: number | null
  // sleep stages
  deep_sleep_min: number | null
  deep_sleep_pct: number | null
  rem_sleep_min: number | null
  rem_sleep_pct: number | null
  light_sleep_min: number | null
  light_sleep_pct: number | null
  efficiency: number | null
  total_sleep_min: number | null
  // tags (dynamic keys: tag:xyz = 0 | 1)
  [key: string]: number | string | null
}

interface WorkoutData {
  day: string
  activity_type: string
  training_effect_label: string | null
  average_hr: number | null
  aerobic_training_effect: number | null
  anaerobic_training_effect: number | null
  calories: number | null
  duration_min: number | null
  vo2max: number | null
  estimated_vo2max: number | null
}

function buildDayMap(startDate: string, endDate: string, tagIds: string[]): Map<string, DayData> {
  const db = getDb()

  const rawRows = db.prepare(`
    SELECT ds.day,
           ds.score as sleep_score,
           dr.score as readiness_score,
           s.average_hrv as hrv,
           s.lowest_heart_rate as resting_hr,
           da.score as activity_score,
           s.deep_sleep_duration,
           s.rem_sleep_duration,
           s.light_sleep_duration,
           s.total_sleep_duration,
           s.efficiency
    FROM oura_daily_sleep ds
    LEFT JOIN oura_daily_readiness dr ON ds.day = dr.day
    LEFT JOIN oura_sleep s ON ds.day = s.day AND s.sleep_type = 'long_sleep'
    LEFT JOIN oura_daily_activity da ON ds.day = da.day
    WHERE ds.day BETWEEN ? AND ?
    ORDER BY ds.day
  `).all(startDate, endDate) as {
    day: string; sleep_score: number | null; readiness_score: number | null
    hrv: number | null; resting_hr: number | null; activity_score: number | null
    deep_sleep_duration: number | null; rem_sleep_duration: number | null
    light_sleep_duration: number | null; total_sleep_duration: number | null
    efficiency: number | null
  }[]

  // Body battery
  const batteryMap = new Map(
    computeDailyBodyBattery(startDate, endDate).map(b => [b.day, b.body_battery])
  )

  // Tag presence maps
  const tagPresenceMaps: Map<string, Set<string>> = new Map()
  for (const tagId of tagIds) {
    const tagText = getTagText(tagId)
    const isWorkout = tagText.startsWith('workout_')
    let days: { day: string }[]
    if (isWorkout) {
      const actType = tagText.replace('workout_', '')
      days = db.prepare('SELECT DISTINCT start_day as day FROM garmin_activities WHERE activity_type = ?').all(actType) as { day: string }[]
    } else {
      days = db.prepare('SELECT DISTINCT start_day as day FROM oura_tags WHERE tag_text = ?').all(tagText) as { day: string }[]
    }
    tagPresenceMaps.set(tagId, new Set(days.map(d => d.day)))
  }

  const map = new Map<string, DayData>()
  for (const r of rawRows) {
    const total = r.total_sleep_duration
    const data: DayData = {
      day: r.day,
      sleep_score: r.sleep_score,
      readiness_score: r.readiness_score,
      hrv: r.hrv,
      resting_hr: r.resting_hr,
      activity_score: r.activity_score,
      body_battery: batteryMap.get(r.day) ?? null,
      deep_sleep_min: r.deep_sleep_duration != null ? r.deep_sleep_duration / 60 : null,
      deep_sleep_pct: r.deep_sleep_duration != null && total && total > 0 ? (r.deep_sleep_duration / total) * 100 : null,
      rem_sleep_min: r.rem_sleep_duration != null ? r.rem_sleep_duration / 60 : null,
      rem_sleep_pct: r.rem_sleep_duration != null && total && total > 0 ? (r.rem_sleep_duration / total) * 100 : null,
      light_sleep_min: r.light_sleep_duration != null ? r.light_sleep_duration / 60 : null,
      light_sleep_pct: r.light_sleep_duration != null && total && total > 0 ? (r.light_sleep_duration / total) * 100 : null,
      efficiency: r.efficiency,
      total_sleep_min: total != null ? total / 60 : null,
    }
    // Add tag presence
    tagPresenceMaps.forEach((daySet, tagId) => {
      data[tagId] = daySet.has(r.day) ? 1 : 0
    })
    map.set(r.day, data)
  }
  return map
}

function buildWorkoutRows(startDate: string, endDate: string, activityType?: string): WorkoutData[] {
  const db = getDb()
  let query = `
    SELECT start_day as day, activity_type, training_effect_label,
           average_hr, aerobic_training_effect, anaerobic_training_effect,
           calories, duration_sec, vo2max
    FROM garmin_activities
    WHERE start_day BETWEEN ? AND ?
  `
  const params: unknown[] = [startDate, endDate]
  if (activityType) {
    query += ' AND activity_type = ?'
    params.push(activityType)
  }
  query += ' ORDER BY start_day'

  const rows = db.prepare(query).all(...params) as {
    day: string; activity_type: string; training_effect_label: string | null
    average_hr: number | null; aerobic_training_effect: number | null
    anaerobic_training_effect: number | null; calories: number | null
    duration_sec: number | null; vo2max: number | null
  }[]

  // Estimated VO2max
  const vo2Result = computeVO2maxEstimates(startDate, endDate)
  const vo2Map = new Map(
    vo2Result.series.map(d => [d.day, d.actual_vo2max ?? d.estimated_vo2max])
  )

  return rows.map(r => ({
    day: r.day,
    activity_type: r.activity_type,
    training_effect_label: r.training_effect_label,
    average_hr: r.average_hr,
    aerobic_training_effect: r.aerobic_training_effect,
    anaerobic_training_effect: r.anaerobic_training_effect,
    calories: r.calories,
    duration_min: r.duration_sec != null ? r.duration_sec / 60 : null,
    vo2max: r.vo2max,
    estimated_vo2max: vo2Map.get(r.day) ?? null,
  }))
}

// ---------- unified correlation builder ----------

export function buildCorrelationData(
  xId: string,
  yId: string,
  startDate: string,
  endDate: string,
  activityType?: string,
): { points: CorrelationPoint[], r: number, xMeanWith?: number, xMeanWithout?: number } {
  const xIsWorkout = needsWorkoutJoin(xId)
  const yIsWorkout = needsWorkoutJoin(yId)
  const xIsTag = isTagMetric(xId)
  const yIsTag = isTagMetric(yId)

  // Collect tag metric IDs we need to resolve
  const tagIds = [xId, yId].filter(isTagMetric)

  // When workout is on X, we need next-day sleep data → extend dayMap by one extra day
  const dayMapEndDate = (xIsWorkout && !yIsWorkout) ? localAddDay(endDate) : endDate

  // Build day map (always needed for daily/sleep_stage/tag metrics)
  const dayMap = buildDayMap(startDate, dayMapEndDate, tagIds)

  // Build workout rows if either axis needs workout data
  const workoutRows = (xIsWorkout || yIsWorkout)
    ? buildWorkoutRows(startDate, endDate, activityType)
    : []

  const points: CorrelationPoint[] = []

  if (xIsWorkout && yIsWorkout) {
    // Workout vs Workout: pair within same activity row
    for (const w of workoutRows) {
      const x = w[xId as keyof WorkoutData] as number | null
      const y = w[yId as keyof WorkoutData] as number | null
      if (x == null || y == null) continue
      points.push({
        date: w.day, x, y,
        activity_type: w.activity_type,
        training_effect_label: w.training_effect_label ?? undefined,
      })
    }
  } else if (xIsWorkout && !yIsWorkout) {
    // Workout (X) → next night's sleep/daily (Y): workout day D → DayData[D+1]
    for (const w of workoutRows) {
      const day = dayMap.get(localAddDay(w.day))
      if (!day) continue
      const x = w[xId as keyof WorkoutData] as number | null
      const y = (yId in day ? day[yId] : null) as number | null
      if (x == null || y == null) continue
      points.push({
        date: w.day, x, y,
        activity_type: w.activity_type,
        training_effect_label: w.training_effect_label ?? undefined,
      })
    }
  } else if (!xIsWorkout && yIsWorkout) {
    // Sleep/daily (X) → same-day workout (Y): DayData[D] → workout day D
    for (const w of workoutRows) {
      const day = dayMap.get(w.day)
      if (!day) continue
      const x = (xId in day ? day[xId] : null) as number | null
      const y = w[yId as keyof WorkoutData] as number | null
      if (x == null || y == null) continue
      points.push({
        date: w.day, x, y,
        activity_type: w.activity_type,
        training_effect_label: w.training_effect_label ?? undefined,
      })
    }
  } else {
    // Daily/sleep_stage/tag vs Daily/sleep_stage/tag: pair by day
    dayMap.forEach((day) => {
      const x = (xId in day ? day[xId] : null) as number | null
      const y = (yId in day ? day[yId] : null) as number | null
      if (x == null || y == null) return
      points.push({ date: day.day, x, y })
    })
  }

  const r = pearsonR(points.map(p => p.x), points.map(p => p.y))

  // For tag-based correlations, compute mean comparison
  let xMeanWith: number | undefined
  let xMeanWithout: number | undefined
  if (xIsTag || yIsTag) {
    const tagAxis = xIsTag ? 'x' : 'y'
    const valAxis = xIsTag ? 'y' : 'x'
    const withTag = points.filter(p => p[tagAxis] === 1).map(p => p[valAxis])
    const withoutTag = points.filter(p => p[tagAxis] === 0).map(p => p[valAxis])
    if (withTag.length > 0) xMeanWith = withTag.reduce((a, b) => a + b, 0) / withTag.length
    if (withoutTag.length > 0) xMeanWithout = withoutTag.reduce((a, b) => a + b, 0) / withoutTag.length
  }

  return { points, r: Math.round(r * 100) / 100, xMeanWith, xMeanWithout }
}

// ---------- legacy exports (backward compat) ----------

export interface DayRow {
  day: string
  sleep_score: number | null
  readiness_score: number | null
  hrv: number | null
  resting_hr: number | null
  activity_score: number | null
  stress_high: number | null
  recovery_high: number | null
  body_battery: number | null
}

export interface ActivityRow {
  start_day: string
  activity_type: string
  average_hr: number | null
  aerobic_training_effect: number | null
  anaerobic_training_effect: number | null
  training_effect_label: string | null
  calories: number | null
  duration_sec: number | null
  vo2max: number | null
  estimated_vo2max: number | null
}

/** @deprecated Use buildCorrelationData instead */
export function buildSleepToPerformanceData(
  sleepRows: DayRow[],
  activityRows: ActivityRow[],
  xMetric: keyof DayRow,
  yMetric: keyof ActivityRow,
): { points: CorrelationPoint[], r: number } {
  const sleepMap = new Map(sleepRows.map(r => [r.day, r]))
  const points: CorrelationPoint[] = []

  for (const act of activityRows) {
    const sleep = sleepMap.get(act.start_day)
    if (!sleep) continue

    const x = sleep[xMetric] as number | null
    const y = act[yMetric] as number | null
    if (x == null || y == null) continue

    points.push({
      date: act.start_day,
      x,
      y,
      activity_type: act.activity_type ?? undefined,
      training_effect_label: act.training_effect_label ?? undefined,
    })
  }

  const r = pearsonR(points.map(p => p.x), points.map(p => p.y))
  return { points, r }
}
