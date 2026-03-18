import { NextRequest, NextResponse } from 'next/server'
import { syncOura } from '@/lib/sync/oura'
import { syncGarmin } from '@/lib/sync/garmin'
import { format, subDays } from 'date-fns'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const endDate = body.endDate ?? format(new Date(), 'yyyy-MM-dd')
  const startDate = body.startDate ?? format(subDays(new Date(), 90), 'yyyy-MM-dd')
  const sources: string[] = body.sources ?? ['oura', 'garmin']

  const t0 = Date.now()
  const results: Record<string, unknown> = {}
  const errors: string[] = []

  await Promise.allSettled([
    sources.includes('oura')
      ? syncOura(startDate, endDate).then(r => { results.oura = r }).catch(e => { errors.push(`oura: ${e.message}`) })
      : Promise.resolve(),
    sources.includes('garmin')
      ? syncGarmin(startDate, endDate).then(r => { results.garmin = r }).catch(e => { errors.push(`garmin: ${e.message}`) })
      : Promise.resolve(),
  ])

  return NextResponse.json({
    success: errors.length === 0,
    results,
    errors,
    duration_ms: Date.now() - t0,
  })
}
