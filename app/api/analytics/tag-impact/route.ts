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

    // Synthetic workout-type tags from Garmin activity_type
    const workoutTags = db.prepare(`
      SELECT
        'workout_' || activity_type AS tag_text,
        COUNT(*) AS count
      FROM garmin_activities
      WHERE activity_type IS NOT NULL AND activity_type != ''
      GROUP BY activity_type
      ORDER BY count DESC
    `).all()

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
