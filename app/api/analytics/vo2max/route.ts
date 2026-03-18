import { NextRequest, NextResponse } from 'next/server'
import { format, subDays } from 'date-fns'
import { computeVO2maxEstimates } from '@/lib/analytics/vo2maxEstimator'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const days = parseInt(req.nextUrl.searchParams.get('days') ?? '90')
  const end = new Date()
  const start = subDays(end, days)
  const endDate = format(end, 'yyyy-MM-dd')
  const startDate = format(start, 'yyyy-MM-dd')

  try {
    const result = computeVO2maxEstimates(startDate, endDate)
    return NextResponse.json({
      dateRange: { startDate, endDate },
      series: result.series,
      model: result.model,
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
