import { NextRequest, NextResponse } from 'next/server'
import { format, subDays } from 'date-fns'
import { computeDailyBodyBattery } from '@/lib/analytics/bodyBattery'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const days = parseInt(req.nextUrl.searchParams.get('days') ?? '30')
  const endDate = format(new Date(), 'yyyy-MM-dd')
  const startDate = format(subDays(new Date(), days), 'yyyy-MM-dd')

  const series = computeDailyBodyBattery(startDate, endDate)

  return NextResponse.json({ dateRange: { startDate, endDate }, series })
}
