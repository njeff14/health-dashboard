import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getDb } from '@/lib/db'
import { format, subDays } from 'date-fns'

export const dynamic = 'force-dynamic'

function cleanTag(raw: string): string {
  return raw.replace(/^tag_[a-z]+_/, '').replace(/_/g, ' ')
}

function buildContext(db: ReturnType<typeof getDb>) {
  const endDate = format(new Date(), 'yyyy-MM-dd')
  const startDate = format(subDays(new Date(), 14), 'yyyy-MM-dd')

  const tags = db.prepare(`
    SELECT tag_text, start_day FROM oura_tags
    WHERE start_day BETWEEN ? AND ?
    ORDER BY start_day DESC
  `).all(startDate, endDate) as { tag_text: string; start_day: string }[]

  const recentSleep = db.prepare(`
    SELECT ds.day, ds.score as sleep_score, s.average_hrv,
           dr.score as readiness_score
    FROM oura_daily_sleep ds
    LEFT JOIN oura_sleep s ON ds.day = s.day AND s.sleep_type = 'long_sleep'
    LEFT JOIN oura_daily_readiness dr ON dr.day = ds.day
    WHERE ds.day BETWEEN ? AND ?
    ORDER BY ds.day DESC
    LIMIT 7
  `).all(startDate, endDate) as {
    day: string; sleep_score: number; average_hrv: number; readiness_score: number
  }[]

  const tagLines = tags.length > 0
    ? tags.map(t => `  ${t.start_day}: ${cleanTag(t.tag_text)}`).join('\n')
    : '  None logged'

  const contextLines = recentSleep.map(r =>
    `  ${r.day}: sleep ${r.sleep_score ?? '?'}, readiness ${r.readiness_score ?? '?'}, HRV ${r.average_hrv ?? '?'}`
  ).join('\n')

  return { tagLines, contextLines }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    metric: string
    recentValues: (number | null)[]
    mean: number | null
    sd: number | null
    indicator: string
    // Optional: multi-series mode
    series?: { name: string; values: (number | null)[]; mean: number | null }[]
  }

  const apiKey = process.env.HEALTH_ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }
  const client = new Anthropic({ apiKey })
  const db = getDb()
  const { tagLines, contextLines } = buildContext(db)

  let prompt: string

  if (body.series && body.series.length > 0) {
    // Multi-series combined chart prompt
    const seriesLines = body.series.map(s =>
      `  ${s.name}: recent values ${s.values.map(v => v ?? '—').join(', ')} (14d avg: ${s.mean?.toFixed(1) ?? '—'})`
    ).join('\n')

    prompt = `You are a concise health and recovery analyst reviewing someone's wearable data.
Write exactly 2-3 sentences analyzing the combined trend across Activity Score, Body Battery, and Sleep Score. Look for meaningful relationships, divergences, or patterns across these three metrics in the recent data. Reference specific tags or events where relevant. Be direct — no bullet points, no headers, no hedging phrases like "it appears."

Combined trend — recent 7 days (oldest→newest):
${seriesLines}

Recent daily context:
${contextLines}

Tags logged in last 14 days:
${tagLines}`
  } else {
    // Single-metric prompt (unchanged)
    prompt = `You are a concise health and recovery analyst reviewing someone's wearable data.
Analyze the following and write exactly 2-3 sentences explaining why the "${body.indicator}" status is showing for ${body.metric}, referencing specific tags or patterns where relevant. Be direct and specific — no bullet points, no headers, no hedging phrases like "it appears" or "it seems."

Metric: ${body.metric}
Current status: ${body.indicator}
Recent 7 values (oldest→newest): ${body.recentValues.map(v => v ?? '—').join(', ')}
14-day rolling average: ${body.mean?.toFixed(1) ?? '—'}
Standard deviation: ${body.sd?.toFixed(1) ?? '—'}

Recent daily context (last 7 days):
${contextLines}

Tags logged in last 14 days:
${tagLines}`
  }

  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 220,
    messages: [{ role: 'user', content: prompt }],
  })

  const summary = (message.content[0] as { type: string; text: string }).text
  return NextResponse.json({ summary })
}
