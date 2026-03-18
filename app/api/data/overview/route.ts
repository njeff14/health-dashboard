import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { format, subDays } from 'date-fns'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const db = getDb()
  const days = parseInt(req.nextUrl.searchParams.get('days') ?? '30')
  const endDate = format(new Date(), 'yyyy-MM-dd')
  const startDate = format(subDays(new Date(), days), 'yyyy-MM-dd')

  const sleepRows = db.prepare(`
    SELECT ds.day, ds.score as sleep_score, s.average_hrv, s.lowest_heart_rate,
           ds.contributor_deep_sleep, ds.contributor_rem_sleep, ds.contributor_efficiency
    FROM oura_daily_sleep ds
    LEFT JOIN oura_sleep s ON ds.day = s.day AND s.sleep_type = 'long_sleep'
    WHERE ds.day BETWEEN ? AND ?
    ORDER BY ds.day
  `).all(startDate, endDate)

  const readinessRows = db.prepare(`
    SELECT day, score as readiness_score, contributor_hrv_balance,
           contributor_recovery_index, contributor_resting_heart_rate
    FROM oura_daily_readiness
    WHERE day BETWEEN ? AND ?
    ORDER BY day
  `).all(startDate, endDate)

  const activityRows = db.prepare(`
    SELECT day, score as activity_score, steps, active_calories
    FROM oura_daily_activity
    WHERE day BETWEEN ? AND ?
    ORDER BY day
  `).all(startDate, endDate)

  const stressRows = db.prepare(`
    SELECT day, stress_high, recovery_high, day_summary
    FROM oura_daily_stress
    WHERE day BETWEEN ? AND ?
    ORDER BY day
  `).all(startDate, endDate)

  const recentActivities = db.prepare(`
    SELECT activity_id, activity_name, activity_type, start_day, start_time_local,
           duration_sec, calories, average_hr, max_hr,
           aerobic_training_effect, training_effect_label, vo2max, distance_meters
    FROM garmin_activities
    WHERE start_day BETWEEN ? AND ?
    ORDER BY start_time_local DESC
    LIMIT 20
  `).all(startDate, endDate)

  const lastSync = db.prepare(`
    SELECT source, synced_at FROM sync_log ORDER BY synced_at DESC LIMIT 2
  `).all()

  // Compute averages
  const avg = (rows: Record<string, unknown>[], key: string) => {
    const vals = rows.map(r => r[key] as number).filter(v => v != null)
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  }

  return NextResponse.json({
    dateRange: { startDate, endDate },
    sleep: sleepRows,
    readiness: readinessRows,
    activity: activityRows,
    stress: stressRows,
    recentActivities,
    lastSync,
    summary: {
      avg_sleep_score: avg(sleepRows as Record<string, unknown>[], 'sleep_score'),
      avg_readiness_score: avg(readinessRows as Record<string, unknown>[], 'readiness_score'),
      avg_hrv: avg(sleepRows as Record<string, unknown>[], 'average_hrv'),
      avg_activity_score: avg(activityRows as Record<string, unknown>[], 'activity_score'),
    }
  })
}
