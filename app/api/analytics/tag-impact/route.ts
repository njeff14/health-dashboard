import { NextRequest, NextResponse } from 'next/server'
import { computeTagImpact } from '@/lib/analytics/tagImpact'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const tag = req.nextUrl.searchParams.get('tag')
  const after = parseInt(req.nextUrl.searchParams.get('after') ?? '3')

  if (!tag) {
    const db = getDb()

    // Oura lifestyle tags
    const tags = db.prepare(`
      SELECT tag_text, COUNT(*) as count
      FROM oura_tags
      WHERE tag_text IS NOT NULL
      GROUP BY tag_text
      ORDER BY count DESC
    `).all()

    // Workout-type tags — merge Garmin + Oura, sum counts for shared types
    const garminWorkoutTags = db.prepare(`
      SELECT 'workout_' || activity_type AS tag_text, COUNT(*) AS count
      FROM garmin_activities
      WHERE activity_type IS NOT NULL AND activity_type != ''
      GROUP BY activity_type ORDER BY count DESC
    `).all() as { tag_text: string; count: number }[]

    const ouraWorkoutTags = db.prepare(`
      SELECT 'workout_' || activity AS tag_text, COUNT(*) AS count
      FROM oura_workouts
      WHERE activity IS NOT NULL AND activity != ''
      GROUP BY activity ORDER BY count DESC
    `).all() as { tag_text: string; count: number }[]

    const workoutCountMap = new Map<string, number>()
    for (const t of [...garminWorkoutTags, ...ouraWorkoutTags]) {
      workoutCountMap.set(t.tag_text, (workoutCountMap.get(t.tag_text) ?? 0) + t.count)
    }
    const workoutTags = Array.from(workoutCountMap.entries())
      .map(([tag_text, count]) => ({ tag_text, count }))
      .sort((a, b) => b.count - a.count)

    return NextResponse.json({ tags, workoutTags })
  }

  const workout = req.nextUrl.searchParams.get('workout') ?? undefined

  try {
    const result = computeTagImpact(tag, 1, after, workout)
    return NextResponse.json(result)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
