import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { buildCorrelationData } from '@/lib/analytics/correlations'
import { STATIC_METRICS, tagMetric } from '@/lib/analytics/metricPool'
import { format, subDays } from 'date-fns'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams

  // List mode: return all available metrics (static + dynamic tags)
  if (params.get('list') === 'true') {
    const db = getDb()

    // Oura lifestyle tags
    const ouraTags = db.prepare(`
      SELECT tag_text, COUNT(*) as count
      FROM oura_tags WHERE tag_text IS NOT NULL
      GROUP BY tag_text ORDER BY count DESC
    `).all() as { tag_text: string; count: number }[]

    // Workout type tags — merge Garmin + Oura, summing counts for shared activity types
    const garminWorkoutTags = db.prepare(`
      SELECT 'workout_' || activity_type as tag_text, COUNT(*) as count
      FROM garmin_activities
      WHERE activity_type IS NOT NULL AND activity_type != ''
      GROUP BY activity_type ORDER BY count DESC
    `).all() as { tag_text: string; count: number }[]

    const ouraWorkoutTags = db.prepare(`
      SELECT 'workout_' || activity as tag_text, COUNT(*) as count
      FROM oura_workouts
      WHERE activity IS NOT NULL AND activity != ''
      GROUP BY activity ORDER BY count DESC
    `).all() as { tag_text: string; count: number }[]

    // Merge by tag_text, summing counts
    const workoutCountMap = new Map<string, number>()
    for (const t of [...garminWorkoutTags, ...ouraWorkoutTags]) {
      workoutCountMap.set(t.tag_text, (workoutCountMap.get(t.tag_text) ?? 0) + t.count)
    }
    const workoutTags = Array.from(workoutCountMap.entries())
      .map(([tag_text, count]) => ({ tag_text, count }))
      .sort((a, b) => b.count - a.count)

    const dynamicTags = [...ouraTags, ...workoutTags].map(t => tagMetric(t.tag_text, t.count))

    return NextResponse.json({
      metrics: [...STATIC_METRICS, ...dynamicTags]
    })
  }

  // Correlation mode
  const days = parseInt(params.get('days') ?? '90')
  const xId = params.get('x') ?? 'sleep_score'
  const yId = params.get('y') ?? 'average_hr'
  const activityType = params.get('type') || undefined

  const endDate = format(new Date(), 'yyyy-MM-dd')
  const startDate = format(subDays(new Date(), days), 'yyyy-MM-dd')

  try {
    const result = buildCorrelationData(xId, yId, startDate, endDate, activityType)
    return NextResponse.json({
      r: result.r,
      n: result.points.length,
      points: result.points,
      meanWith: result.xMeanWith,
      meanWithout: result.xMeanWithout,
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
