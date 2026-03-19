import { getDb } from '@/lib/db'
import { addDays, format } from 'date-fns'
import { computeDailyBodyBattery } from '@/lib/analytics/bodyBattery'

/** Parse a yyyy-MM-dd string as LOCAL midnight to avoid UTC-shift timezone bug. */
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

type MetricDelta = { before: number | null, after: number | null, delta: number | null }

export interface TagImpactResult {
  tag: string
  occurrences: number
  window: number
  metrics: {
    sleep_score:     MetricDelta
    resting_hr:      MetricDelta
    hrv:             MetricDelta
    readiness_score: MetricDelta
    body_battery:    MetricDelta
    deep_sleep_min:  MetricDelta
    deep_sleep_pct:  MetricDelta
    rem_sleep_min:   MetricDelta
    rem_sleep_pct:   MetricDelta
    efficiency:      MetricDelta
  }
  dailyPattern: {
    offset: number
    avg_sleep:      number | null
    avg_rhr:        number | null
    avg_hrv:        number | null
    avg_readiness:  number | null
    avg_battery:    number | null
    avg_deep_min:   number | null
    avg_deep_pct:   number | null
    avg_rem_min:    number | null
    avg_rem_pct:    number | null
    avg_efficiency: number | null
  }[]
}

function avg(nums: (number | null)[]): number | null {
  const valid = nums.filter((n): n is number => n != null)
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null
}

export function computeTagImpact(tagCode: string, daysBefore = 1, daysAfter = 3, workoutType?: string): TagImpactResult {
  const db = getDb()

  const isWorkoutTag = tagCode.startsWith('workout_')

  let tagDays: { day: string }[]

  if (workoutType && !isWorkoutTag) {
    // Intersection: days where lifestyle tag AND workout type both occurred (Garmin OR Oura)
    const activityType = workoutType.replace(/^workout_/, '')
    const garminDays = db.prepare(`
      SELECT DISTINCT ot.start_day AS day
      FROM oura_tags ot
      JOIN garmin_activities ga ON ga.start_day = ot.start_day
      WHERE ot.tag_text = ? AND ga.activity_type = ?
    `).all(tagCode, activityType) as { day: string }[]
    const ouraDays = db.prepare(`
      SELECT DISTINCT ot.start_day AS day
      FROM oura_tags ot
      JOIN oura_workouts ow ON ow.day = ot.start_day
      WHERE ot.tag_text = ? AND ow.activity = ?
    `).all(tagCode, activityType) as { day: string }[]
    const merged = Array.from(new Set([...garminDays.map(d => d.day), ...ouraDays.map(d => d.day)])).sort()
    tagDays = merged.map(day => ({ day }))
  } else if (isWorkoutTag) {
    const actType = tagCode.replace('workout_', '')
    const garminDays = db.prepare(`SELECT DISTINCT start_day AS day FROM garmin_activities WHERE activity_type = ?`).all(actType) as { day: string }[]
    const ouraDays = db.prepare(`SELECT DISTINCT day FROM oura_workouts WHERE activity = ?`).all(actType) as { day: string }[]
    const merged = Array.from(new Set([...garminDays.map(d => d.day), ...ouraDays.map(d => d.day)])).sort()
    tagDays = merged.map(day => ({ day }))
  } else {
    tagDays = db.prepare(`
        SELECT DISTINCT start_day as day FROM oura_tags WHERE tag_text = ? ORDER BY start_day
      `).all(tagCode) as { day: string }[]
  }

  const empty: TagImpactResult = {
    tag: tagCode, occurrences: 0, window: daysAfter,
    metrics: {
      sleep_score:     { before: null, after: null, delta: null },
      resting_hr:      { before: null, after: null, delta: null },
      hrv:             { before: null, after: null, delta: null },
      readiness_score: { before: null, after: null, delta: null },
      body_battery:    { before: null, after: null, delta: null },
      deep_sleep_min:  { before: null, after: null, delta: null },
      deep_sleep_pct:  { before: null, after: null, delta: null },
      rem_sleep_min:   { before: null, after: null, delta: null },
      rem_sleep_pct:   { before: null, after: null, delta: null },
      efficiency:      { before: null, after: null, delta: null },
    },
    dailyPattern: []
  }
  if (tagDays.length === 0) return empty

  // Pre-compute body battery for the full relevant date range
  const earliest = format(addDays(parseLocalDate(tagDays[0].day), -daysBefore), 'yyyy-MM-dd')
  const latest   = format(addDays(parseLocalDate(tagDays[tagDays.length - 1].day), daysAfter), 'yyyy-MM-dd')
  const batteryMap = new Map(
    computeDailyBodyBattery(earliest, latest).map(b => [b.day, b.body_battery])
  )

  type OffsetBucket = {
    sleep: number[], rhr: number[], hrv: number[], readiness: number[], battery: number[],
    deep_min: number[], deep_pct: number[], rem_min: number[], rem_pct: number[], efficiency: number[]
  }
  const offsetData: Record<number, OffsetBucket> = {}
  for (let o = -daysBefore; o <= daysAfter; o++) {
    offsetData[o] = { sleep: [], rhr: [], hrv: [], readiness: [], battery: [], deep_min: [], deep_pct: [], rem_min: [], rem_pct: [], efficiency: [] }
  }

  for (const { day } of tagDays) {
    const anchor = parseLocalDate(day)
    for (let o = -daysBefore; o <= daysAfter; o++) {
      const d = format(addDays(anchor, o), 'yyyy-MM-dd')
      const s  = db.prepare('SELECT score FROM oura_daily_sleep WHERE day = ?').get(d) as { score: number } | undefined
      const r  = db.prepare('SELECT score FROM oura_daily_readiness WHERE day = ?').get(d) as { score: number } | undefined
      const sl = db.prepare("SELECT average_hrv, lowest_heart_rate, deep_sleep_duration, rem_sleep_duration, total_sleep_duration, efficiency FROM oura_sleep WHERE day = ? AND sleep_type = 'long_sleep'").get(d) as {
        average_hrv: number, lowest_heart_rate: number,
        deep_sleep_duration: number | null, rem_sleep_duration: number | null,
        total_sleep_duration: number | null, efficiency: number | null
      } | undefined
      const bb = batteryMap.get(d)

      if (s?.score  != null) offsetData[o].sleep.push(s.score)
      if (r?.score  != null) offsetData[o].readiness.push(r.score)
      if (sl?.average_hrv        != null) offsetData[o].hrv.push(sl.average_hrv)
      if (sl?.lowest_heart_rate  != null) offsetData[o].rhr.push(sl.lowest_heart_rate)
      if (bb != null) offsetData[o].battery.push(bb)

      // Sleep stage metrics
      if (sl?.deep_sleep_duration != null) {
        offsetData[o].deep_min.push(sl.deep_sleep_duration / 60)
        if (sl.total_sleep_duration && sl.total_sleep_duration > 0) {
          offsetData[o].deep_pct.push((sl.deep_sleep_duration / sl.total_sleep_duration) * 100)
        }
      }
      if (sl?.rem_sleep_duration != null) {
        offsetData[o].rem_min.push(sl.rem_sleep_duration / 60)
        if (sl.total_sleep_duration && sl.total_sleep_duration > 0) {
          offsetData[o].rem_pct.push((sl.rem_sleep_duration / sl.total_sleep_duration) * 100)
        }
      }
      if (sl?.efficiency != null) offsetData[o].efficiency.push(sl.efficiency)
    }
  }

  const dailyPattern = Object.entries(offsetData).map(([offset, data]) => ({
    offset: parseInt(offset),
    avg_sleep:      avg(data.sleep),
    avg_rhr:        avg(data.rhr),
    avg_hrv:        avg(data.hrv),
    avg_readiness:  avg(data.readiness),
    avg_battery:    avg(data.battery),
    avg_deep_min:   avg(data.deep_min),
    avg_deep_pct:   avg(data.deep_pct),
    avg_rem_min:    avg(data.rem_min),
    avg_rem_pct:    avg(data.rem_pct),
    avg_efficiency: avg(data.efficiency),
  })).sort((a, b) => a.offset - b.offset)

  type PatternKey = keyof typeof dailyPattern[number]
  function deltas(key: PatternKey) {
    const before = avg(dailyPattern.filter(d => d.offset < 0).map(d => d[key]))
    const after  = avg(dailyPattern.filter(d => d.offset > 0).map(d => d[key]))
    return { before, after, delta: before != null && after != null ? after - before : null }
  }

  return {
    tag: tagCode,
    occurrences: tagDays.length,
    window: daysAfter,
    metrics: {
      sleep_score:     deltas('avg_sleep'),
      resting_hr:      deltas('avg_rhr'),
      hrv:             deltas('avg_hrv'),
      readiness_score: deltas('avg_readiness'),
      body_battery:    deltas('avg_battery'),
      deep_sleep_min:  deltas('avg_deep_min'),
      deep_sleep_pct:  deltas('avg_deep_pct'),
      rem_sleep_min:   deltas('avg_rem_min'),
      rem_sleep_pct:   deltas('avg_rem_pct'),
      efficiency:      deltas('avg_efficiency'),
    },
    dailyPattern
  }
}
