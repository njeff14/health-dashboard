import { getDb } from '@/lib/db'
import path from 'path'

const TOKEN_DIR = path.join(process.cwd(), 'data', 'garmin-tokens')

export async function syncGarmin(startDate: string, endDate: string) {
  const db = getDb()
  const { GarminConnect } = await import('garmin-connect')
  const gc = new GarminConnect({
    username: process.env.GARMIN_EMAIL!,
    password: process.env.GARMIN_PASSWORD!,
  })

  await gc.login(process.env.GARMIN_EMAIL!, process.env.GARMIN_PASSWORD!)

  const allActivities: Record<string, unknown>[] = []
  let offset = 0
  const limit = 50

  while (true) {
    const batch = await gc.getActivities(offset, limit) as unknown as Record<string, unknown>[]
    if (!batch || batch.length === 0) break

    const filtered = batch.filter(a => {
      const t = a.startTimeLocal as string
      if (!t) return false
      const day = t.substring(0, 10) // 'YYYY-MM-DD' from local time string
      return day >= startDate && day <= endDate
    })

    allActivities.push(...filtered)

    // If earliest activity in batch is before startDate, stop
    const earliest = batch[batch.length - 1]
    const earliestDay = (earliest.startTimeLocal as string).substring(0, 10)
    if (earliestDay < startDate || batch.length < limit) break
    offset += limit
  }

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO garmin_activities
      (activity_id, activity_name, activity_type, start_time_local, start_day,
       duration_sec, elapsed_duration_sec, distance_meters, calories,
       average_hr, max_hr, aerobic_training_effect, anaerobic_training_effect,
       training_effect_label, vo2max, avg_running_cadence, elevation_gain, location_name)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `)

  const run = db.transaction((items: Record<string, unknown>[]) => {
    for (const a of items) {
      const startTimeLocal = a.startTimeLocal as string
      const startDay = startTimeLocal.substring(0, 10)
      const type = a.activityType as Record<string, unknown> | undefined
      const timing = a.timing as Record<string, unknown> | undefined
      const metrics = a.metrics as Record<string, unknown> | undefined
      const hr = a.heartRate as Record<string, unknown> | undefined
      const training = a.training as Record<string, unknown> | undefined
      const cadence = a.cadence as Record<string, unknown> | undefined
      const location = a.location as Record<string, unknown> | undefined

      upsert.run(
        a.activityId,
        a.name ?? a.activityName,
        type?.key ?? type?.typeKey,
        startTimeLocal,
        startDay,
        timing?.durationSeconds ?? a.duration,
        timing?.elapsedDurationSeconds ?? a.elapsedDuration,
        (metrics?.distance as number ?? 0) * 1000, // km → meters if needed
        metrics?.calories ?? a.calories,
        hr?.average ?? a.averageHR,
        hr?.max ?? a.maxHR,
        training?.aerobicEffect ?? a.aerobicTrainingEffect,
        training?.anaerobicEffect ?? a.anaerobicTrainingEffect,
        training?.trainingEffectLabel ?? a.trainingEffectLabel,
        training?.vO2MaxValue ?? a.vO2MaxValue,
        cadence?.averageRunning ?? a.averageRunningCadenceInStepsPerMinute,
        metrics?.elevationGain ?? a.elevationGain,
        location?.locationName ?? a.locationName,
      )
    }
  })

  run(allActivities)

  db.prepare(`
    INSERT INTO sync_log (source, synced_at, start_date, end_date, records_written)
    VALUES ('garmin', datetime('now'), ?, ?, ?)
  `).run(startDate, endDate, allActivities.length)

  return { activities: allActivities.length }
}
