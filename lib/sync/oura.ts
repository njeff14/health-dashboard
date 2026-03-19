import { getDb } from '@/lib/db'
import { format, addDays, parseISO } from 'date-fns'

const BASE = 'https://api.ouraring.com/v2'

function headers() {
  return { Authorization: `Bearer ${process.env.OURA_PERSONAL_ACCESS_TOKEN}` }
}

async function fetchAll(endpoint: string, startDate: string, endDate: string) {
  // Oura's end_date is exclusive, so add 1 day to include the requested end date
  const exclusiveEnd = format(addDays(parseISO(endDate), 1), 'yyyy-MM-dd')
  const rows: Record<string, unknown>[] = []
  let url: string | null =
    `${BASE}/usercollection/${endpoint}?start_date=${startDate}&end_date=${exclusiveEnd}`

  while (url) {
    const res = await fetch(url, { headers: headers() })
    if (!res.ok) throw new Error(`Oura ${endpoint} returned ${res.status}`)
    const json = await res.json() as { data: Record<string, unknown>[], next_token?: string }
    rows.push(...json.data)
    url = json.next_token
      ? `${BASE}/usercollection/${endpoint}?next_token=${json.next_token}`
      : null
  }
  return rows
}

/** Parse a yyyy-MM-dd string as a LOCAL midnight date (avoids UTC-shift timezone bug). */
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function expandTagDays(startDay: string, endDay: string | null): string[] {
  const days: string[] = []
  let cur = parseLocalDate(startDay)
  const end = endDay ? parseLocalDate(endDay) : parseLocalDate(startDay)
  while (cur <= end) {
    days.push(format(cur, 'yyyy-MM-dd'))
    cur = addDays(cur, 1)
  }
  return days
}

export async function syncOura(startDate: string, endDate: string) {
  const db = getDb()
  const counts: Record<string, number> = {}

  // Daily sleep scores
  try {
    const rows = await fetchAll('daily_sleep', startDate, endDate)
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO oura_daily_sleep
        (id, day, score, contributor_deep_sleep, contributor_efficiency,
         contributor_latency, contributor_rem_sleep, contributor_restfulness,
         contributor_timing, contributor_total_sleep)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `)
    const run = db.transaction((items: Record<string, unknown>[]) => {
      for (const r of items) {
        const c = r.contributors as Record<string, number> | undefined
        upsert.run(r.id, r.day, r.score,
          c?.deep_sleep, c?.efficiency, c?.latency,
          c?.rem_sleep, c?.restfulness, c?.timing, c?.total_sleep)
      }
    })
    run(rows)
    counts.daily_sleep = rows.length
  } catch (e) { counts.daily_sleep_error = 1; console.error('daily_sleep sync error', e) }

  // Detailed sleep
  try {
    const rows = await fetchAll('sleep', startDate, endDate)
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO oura_sleep
        (id, day, bedtime_start, bedtime_end, total_sleep_duration,
         deep_sleep_duration, rem_sleep_duration, light_sleep_duration,
         awake_time, efficiency, latency, average_hrv, lowest_heart_rate,
         average_heart_rate, restless_periods, sleep_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `)
    const run = db.transaction((items: Record<string, unknown>[]) => {
      for (const r of items) {
        upsert.run(r.id, r.day, r.bedtime_start, r.bedtime_end,
          r.total_sleep_duration, r.deep_sleep_duration, r.rem_sleep_duration,
          r.light_sleep_duration, r.awake_time, r.efficiency, r.latency,
          r.average_hrv, r.lowest_heart_rate, r.average_heart_rate,
          r.restless_periods, r.type)
      }
    })
    run(rows)
    counts.sleep = rows.length
  } catch (e) { counts.sleep_error = 1; console.error('sleep sync error', e) }

  // Daily readiness
  try {
    const rows = await fetchAll('daily_readiness', startDate, endDate)
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO oura_daily_readiness
        (id, day, score, temperature_deviation, temperature_trend_deviation,
         contributor_activity_balance, contributor_body_temperature,
         contributor_hrv_balance, contributor_previous_day_activity,
         contributor_previous_night, contributor_recovery_index,
         contributor_resting_heart_rate, contributor_sleep_balance)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `)
    const run = db.transaction((items: Record<string, unknown>[]) => {
      for (const r of items) {
        const c = r.contributors as Record<string, number> | undefined
        upsert.run(r.id, r.day, r.score, r.temperature_deviation,
          r.temperature_trend_deviation, c?.activity_balance, c?.body_temperature,
          c?.hrv_balance, c?.previous_day_activity, c?.previous_night,
          c?.recovery_index, c?.resting_heart_rate, c?.sleep_balance)
      }
    })
    run(rows)
    counts.daily_readiness = rows.length
  } catch (e) { counts.daily_readiness_error = 1; console.error('readiness sync error', e) }

  // Daily activity
  try {
    const rows = await fetchAll('daily_activity', startDate, endDate)
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO oura_daily_activity
        (id, day, score, active_calories, total_calories, steps,
         high_activity_time, medium_activity_time, low_activity_time,
         sedentary_time, average_met_minutes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `)
    const run = db.transaction((items: Record<string, unknown>[]) => {
      for (const r of items) {
        upsert.run(r.id, r.day, r.score, r.active_calories, r.total_calories,
          r.steps, r.high_activity_time, r.medium_activity_time,
          r.low_activity_time, r.sedentary_time, r.average_met_minutes)
      }
    })
    run(rows)
    counts.daily_activity = rows.length
  } catch (e) { counts.daily_activity_error = 1; console.error('activity sync error', e) }

  // Daily stress
  try {
    const rows = await fetchAll('daily_stress', startDate, endDate)
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO oura_daily_stress (id, day, stress_high, recovery_high, day_summary)
      VALUES (?,?,?,?,?)
    `)
    const run = db.transaction((items: Record<string, unknown>[]) => {
      for (const r of items) {
        upsert.run(r.id, r.day, r.stress_high, r.recovery_high, r.day_summary)
      }
    })
    run(rows)
    counts.daily_stress = rows.length
  } catch (e) { counts.daily_stress_error = 1; console.error('stress sync error', e) }

  // Enhanced tags
  try {
    const rows = await fetchAll('enhanced_tag', startDate, endDate)
    const upsertTag = db.prepare(`
      INSERT OR REPLACE INTO oura_tags
        (id, tag_type_code, custom_name, tag_text, start_day, end_day, start_time, end_time, comment)
      VALUES (?,?,?,?,?,?,?,?,?)
    `)
    const upsertDay = db.prepare(`
      INSERT OR REPLACE INTO oura_tag_days (tag_id, day, tag_text) VALUES (?,?,?)
    `)
    const run = db.transaction((items: Record<string, unknown>[]) => {
      for (const r of items) {
        // Resolve the best text label: custom_name for custom tags, tag_type_code for built-ins
        const tagText = (r.custom_name as string | null) ?? (r.tag_type_code as string | null) ?? 'unknown'
        upsertTag.run(r.id, r.tag_type_code, r.custom_name, tagText,
          r.start_day, r.end_day, r.start_time, r.end_time, r.comment)
        const days = expandTagDays(r.start_day as string, r.end_day as string | null)
        for (const d of days) upsertDay.run(r.id, d, tagText)
      }
    })
    run(rows)
    counts.tags = rows.length
  } catch (e) { counts.tags_error = 1; console.error('tags sync error', e) }

  // Workouts
  try {
    const rows = await fetchAll('workout', startDate, endDate)
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO oura_workouts
        (id, day, activity, start_time, end_time, duration_sec,
         calories, distance_meters, average_hr, max_hr, intensity, source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `)
    const run = db.transaction((items: Record<string, unknown>[]) => {
      for (const r of items) {
        const start = r.start_datetime as string | null
        const end = r.end_datetime as string | null
        const durationSec = start && end
          ? (new Date(end).getTime() - new Date(start).getTime()) / 1000
          : null
        upsert.run(r.id, r.day, r.activity, start, end, durationSec,
          r.calories, r.distance, r.average_heart_rate, r.max_heart_rate,
          r.intensity, r.source)
      }
    })
    run(rows)
    counts.workouts = rows.length
  } catch (e) { counts.workouts_error = 1; console.error('workouts sync error', e) }

  // SpO2
  try {
    const rows = await fetchAll('daily_spo2', startDate, endDate)
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO oura_daily_spo2 (id, day, spo2_average, breathing_disturbance_index)
      VALUES (?,?,?,?)
    `)
    const run = db.transaction((items: Record<string, unknown>[]) => {
      for (const r of items) {
        const avg = r.spo2_percentage as Record<string, number> | undefined
        upsert.run(r.id, r.day, avg?.average, r.breathing_disturbance_index)
      }
    })
    run(rows)
    counts.spo2 = rows.length
  } catch (e) { counts.spo2_error = 1; console.error('spo2 sync error', e) }

  // Log sync
  db.prepare(`
    INSERT INTO sync_log (source, synced_at, start_date, end_date, records_written)
    VALUES ('oura', datetime('now'), ?, ?, ?)
  `).run(startDate, endDate, Object.values(counts).reduce((a, b) => a + b, 0))

  return counts
}
