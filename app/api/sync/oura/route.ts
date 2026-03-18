import { NextRequest, NextResponse } from 'next/server'
import { syncOura } from '@/lib/sync/oura'
import { format, subDays } from 'date-fns'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const endDate = body.endDate ?? format(new Date(), 'yyyy-MM-dd')
  const startDate = body.startDate ?? format(subDays(new Date(), 90), 'yyyy-MM-dd')
  const t0 = Date.now()
  try {
    const counts = await syncOura(startDate, endDate)
    return NextResponse.json({ success: true, counts, duration_ms: Date.now() - t0 })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 })
  }
}
