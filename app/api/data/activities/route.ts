import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { format, subDays } from 'date-fns'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const db = getDb()
  const params = req.nextUrl.searchParams
  const days = parseInt(params.get('days') ?? '90')
  const type = params.get('type')
  const endDate = params.get('end') ?? format(new Date(), 'yyyy-MM-dd')
  const startDate = params.get('start') ?? format(subDays(new Date(), days), 'yyyy-MM-dd')

  let q = `SELECT * FROM garmin_activities WHERE start_day BETWEEN ? AND ?`
  const args: unknown[] = [startDate, endDate]
  if (type) { q += ` AND activity_type = ?`; args.push(type) }
  q += ` ORDER BY start_time_local DESC`

  return NextResponse.json({ data: db.prepare(q).all(...args) })
}
