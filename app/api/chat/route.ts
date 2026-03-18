import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

function buildDataContext(): string {
  const db = getDb()
  const today = new Date().toISOString().slice(0, 10)

  // Last 30 days of daily metrics
  const metrics = db.prepare(`
    SELECT
      s.day,
      s.score                  AS sleep_score,
      r.score                  AS readiness_score,
      a.score                  AS activity_score,
      sl.average_hrv           AS hrv,
      sl.lowest_heart_rate     AS rhr,
      sl.total_sleep_duration  AS sleep_sec,
      sl.deep_sleep_duration   AS deep_sec,
      sl.rem_sleep_duration    AS rem_sec,
      sl.efficiency            AS sleep_efficiency
    FROM oura_daily_sleep s
    LEFT JOIN oura_daily_readiness r  ON r.day = s.day
    LEFT JOIN oura_daily_activity  a  ON a.day = s.day
    LEFT JOIN oura_sleep           sl ON sl.day = s.day AND sl.sleep_type = 'long_sleep'
    WHERE s.day >= date(?, '-30 days')
    ORDER BY s.day DESC
  `).all(today) as Record<string, number | null>[]

  // Last 30 days of workouts
  const workouts = db.prepare(`
    SELECT
      start_day,
      activity_name,
      activity_type,
      training_effect_label,
      ROUND(duration_sec / 60) AS duration_min,
      ROUND(distance_meters / 1000, 1) AS distance_km,
      ROUND(average_hr)        AS avg_hr,
      max_hr,
      aerobic_training_effect  AS aero_te,
      anaerobic_training_effect AS anaero_te
    FROM garmin_activities
    WHERE start_day >= date(?, '-30 days')
    ORDER BY start_day DESC
  `).all(today) as Record<string, string | number | null>[]

  // Recent tags
  const tags = db.prepare(`
    SELECT start_day, tag_text
    FROM oura_tags
    WHERE start_day >= date(?, '-30 days')
    ORDER BY start_day DESC
  `).all(today) as { start_day: string; tag_text: string }[]

  // HR settings
  const settings = db.prepare(`SELECT key, value FROM user_settings WHERE key LIKE 'hr_%'`).all() as { key: string; value: string }[]
  const hrSettings = Object.fromEntries(settings.map(s => [s.key, s.value]))

  // Format metrics table
  const metricsTable = [
    '| Date | Sleep | Readiness | Activity | HRV | RHR | Sleep Duration | Efficiency |',
    '|------|-------|-----------|----------|-----|-----|----------------|------------|',
    ...metrics.map(m => {
      const sleepH = m.sleep_sec != null ? (Number(m.sleep_sec) / 3600).toFixed(1) + 'h' : '—'
      return `| ${m.day} | ${m.sleep_score ?? '—'} | ${m.readiness_score ?? '—'} | ${m.activity_score ?? '—'} | ${m.hrv != null ? Math.round(Number(m.hrv)) : '—'} | ${m.rhr ?? '—'} | ${sleepH} | ${m.sleep_efficiency ?? '—'}% |`
    }),
  ].join('\n')

  // Format workouts table
  const workoutsTable = workouts.length === 0 ? 'No workouts in this period.' : [
    '| Date | Activity | Type | Training Effect | Duration | Distance | Avg HR | Aerobic TE | Anaerobic TE |',
    '|------|----------|------|-----------------|----------|----------|--------|------------|--------------|',
    ...workouts.map(w =>
      `| ${w.start_day} | ${String(w.activity_name ?? '').slice(0, 30)} | ${w.activity_type ?? '—'} | ${w.training_effect_label ?? '—'} | ${w.duration_min ?? '—'}min | ${w.distance_km ? w.distance_km + 'km' : '—'} | ${w.avg_hr ?? '—'} | ${w.aero_te ?? '—'} | ${w.anaero_te ?? '—'} |`
    ),
  ].join('\n')

  // Format tags
  const tagLines = tags.length === 0
    ? 'No tags recorded in this period.'
    : tags.map(t => `- ${t.start_day}: ${t.tag_text}`).join('\n')

  // HR zones from settings
  const hrMax = Number(hrSettings.hr_max ?? 190)
  const hrResting = Number(hrSettings.hr_resting ?? 60)
  const lthr = Number(hrSettings.hr_lthr ?? 170)
  const z1top = Math.round(lthr * 0.85)
  const z2top = Math.round(lthr * 0.89)
  const z3top = Math.round(lthr * 0.94)
  const z4top = Math.round(lthr * 0.99)

  return `
Today's date: ${today}

## Daily Health Metrics (last 30 days, most recent first)
${metricsTable}

## Workout History (last 30 days, most recent first)
${workoutsTable}

## Lifestyle Tags (last 30 days)
${tagLines}

## Training Zones (based on LTHR ${lthr} bpm)
- Zone 1 Recovery:  <${z1top} bpm
- Zone 2 Aerobic:   ${z1top}–${z2top} bpm
- Zone 3 Tempo:     ${z2top}–${z3top} bpm
- Zone 4 Threshold: ${z3top}–${z4top} bpm
- Zone 5 VO2 Max:   >${z4top} bpm
- Max HR: ${hrMax} bpm | Resting HR: ${hrResting} bpm
`.trim()
}

// GET — return persisted history
export async function GET() {
  const db = getDb()
  const messages = db.prepare(
    `SELECT role, content FROM chat_messages ORDER BY created_at ASC`
  ).all()
  return NextResponse.json({ messages })
}

// DELETE — clear history
export async function DELETE() {
  const db = getDb()
  db.prepare(`DELETE FROM chat_messages`).run()
  return NextResponse.json({ ok: true })
}

// POST — send a message, stream response
export async function POST(req: NextRequest) {
  const { message } = await req.json() as { message: string }
  if (!message?.trim()) return NextResponse.json({ error: 'No message' }, { status: 400 })

  const db = getDb()

  // Persist user message
  db.prepare(`INSERT INTO chat_messages (role, content) VALUES (?, ?)`).run('user', message.trim())

  // Load full conversation history (last 40 messages for context window)
  const history = db.prepare(
    `SELECT role, content FROM chat_messages ORDER BY created_at ASC LIMIT 40`
  ).all() as { role: string; content: string }[]

  const dataContext = buildDataContext()

  const systemPrompt = `You are a knowledgeable personal health and fitness assistant embedded in the user's private health dashboard. You have direct access to data from their Oura Ring and Garmin watch.

Your role:
- Answer questions about their health trends, sleep, recovery, and training
- Give specific, actionable recommendations backed by their actual data
- Help them understand patterns and correlations in their data
- Suggest optimal workout intensity based on readiness and recent training load
- Identify what lifestyle factors (tags) are helping or hurting their metrics
- Reference specific dates and data points when making observations

Tone: conversational but precise. Be direct. When the data supports a clear conclusion, state it confidently. When n is small or the signal is noisy, say so.

Guidelines:
- For workout recommendations: weight readiness score heavily. Below 70 = recovery or easy. 70–85 = moderate. Above 85 = go hard.
- For HRV: trends matter more than individual days. A 7-day drop is significant.
- For sleep: look at contributors (efficiency, timing, restfulness) not just the score.
- Training effect labels: AEROBIC_BASE (easy/base building), TEMPO (moderate sustained), LACTATE_THRESHOLD (hard sustained), SPEED (short hard intervals), VO2MAX (max effort intervals).
- Aerobic TE scale 1–5: 1=recovery, 2=maintaining, 3=improving, 4=highly improving, 5=overreaching.

Here is the user's data:

${dataContext}`

  const client = new Anthropic({ apiKey: process.env.HEALTH_ANTHROPIC_API_KEY })

  let fullResponse = ''

  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      try {
        const stream = client.messages.stream({
          model: 'claude-sonnet-4-5',
          max_tokens: 1024,
          system: systemPrompt,
          messages: history.map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
        })

        for await (const chunk of stream) {
          if (
            chunk.type === 'content_block_delta' &&
            chunk.delta.type === 'text_delta'
          ) {
            fullResponse += chunk.delta.text
            controller.enqueue(encoder.encode(chunk.delta.text))
          }
        }

        // Persist assistant response
        db.prepare(`INSERT INTO chat_messages (role, content) VALUES (?, ?)`).run('assistant', fullResponse)
      } catch (err) {
        console.error('Chat stream error:', err)
        controller.enqueue(encoder.encode('\n\n[Error generating response]'))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
