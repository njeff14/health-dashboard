import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const db = getDb()
  const rows = db.prepare(`SELECT key, value FROM user_settings`).all() as { key: string; value: string }[]
  const settings: Record<string, string> = {}
  for (const r of rows) settings[r.key] = r.value
  return NextResponse.json(settings)
}

export async function PUT(req: Request) {
  const body = await req.json() as Record<string, string>
  const db = getDb()
  const upsert = db.prepare(`INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)`)
  const run = db.transaction((entries: [string, string][]) => {
    for (const [k, v] of entries) upsert.run(k, v)
  })
  run(Object.entries(body))
  return NextResponse.json({ ok: true })
}
