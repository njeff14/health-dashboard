'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { SyncButton } from '@/components/sync/SyncButton'
import { Badge } from '@/components/ui/badge'
import {
  ResponsiveContainer, ComposedChart, Line, Area,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid
} from 'recharts'

/** Convert a UTC datetime string (from SQLite datetime('now')) to EDT local time. */
function fmtLocalTime(utcStr: string): string {
  if (!utcStr) return ''
  // SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" without 'Z' — append it
  const iso = utcStr.includes('T') ? utcStr : utcStr.replace(' ', 'T') + 'Z'
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
    hour12: true,
  })
}

interface BodyBatteryPoint { day: string; body_battery: number | null; readiness: number | null }
interface VO2maxPoint { day: string; actual_vo2max: number | null; estimated_vo2max: number | null; source: 'garmin' | 'estimated' | null }
interface VO2maxModel { r_squared: number; standard_error: number; n_training: number }

interface OverviewData {
  sleep: { day: string; sleep_score: number; average_hrv: number; lowest_heart_rate: number | null }[]
  readiness: { day: string; readiness_score: number }[]
  activity: { day: string; activity_score: number; steps: number }[]
  stress: { day: string; stress_high: number; recovery_high: number; day_summary: string }[]
  recentActivities: {
    activity_id: number; activity_name: string; activity_type: string
    start_day: string; start_time_local: string; duration_sec: number
    calories: number; average_hr: number; max_hr: number
    aerobic_training_effect: number; training_effect_label: string; vo2max: number
    distance_meters: number
  }[]
  lastSync: { source: string; synced_at: string }[]
  summary: {
    avg_sleep_score: number | null
    avg_readiness_score: number | null
    avg_hrv: number | null
    avg_activity_score: number | null
  }
}

const TE_COLORS: Record<string, string> = {
  SPEED: '#ef4444',
  LACTATE_THRESHOLD: '#f97316',
  TEMPO: '#eab308',
  AEROBIC_BASE: '#22c55e',
  VO2MAX: '#a855f7',
}

function fmtDuration(sec: number) {
  const m = Math.round(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

// ── Rolling stats ──────────────────────────────────────────────────────
const ROLLING_WINDOW = 14

interface RollingBand { mean: number | null; upper: number | null; lower: number | null }

function rollingStats(values: (number | null)[]): RollingBand[] {
  return values.map((_, i) => {
    const windowVals: number[] = []
    for (let j = Math.max(0, i - ROLLING_WINDOW + 1); j <= i; j++) {
      if (values[j] != null) windowVals.push(values[j] as number)
    }
    if (windowVals.length < 3) return { mean: null, upper: null, lower: null }
    const mean = windowVals.reduce((a, b) => a + b, 0) / windowVals.length
    const variance = windowVals.reduce((s, v) => s + (v - mean) ** 2, 0) / windowVals.length
    const sd = Math.sqrt(variance)
    return {
      mean: Math.round(mean * 10) / 10,
      upper: Math.round((mean + sd) * 10) / 10,
      lower: Math.round((mean - sd) * 10) / 10,
    }
  })
}

// ── Indicator logic ────────────────────────────────────────────────────
type Indicator = 'Unaligned ↓' | 'Trending Down' | 'Aligned' | 'Trending Up' | 'Unaligned ↑'

interface IndicatorInfo {
  label: Indicator
  color: string
  bg: string
}

function computeIndicator(
  series: { value: number | null; mean: number | null; lower: number | null; upper: number | null }[]
): IndicatorInfo {
  const recent = series.filter(d => d.value != null && d.mean != null).slice(-7)
  if (recent.length < 3) return { label: 'Aligned', color: '#16a34a', bg: 'bg-green-100 text-green-800' }

  const lastPoint = recent[recent.length - 1]
  const mean = lastPoint.mean!
  const lower = lastPoint.lower!
  const upper = lastPoint.upper!
  const sd = upper - mean

  // Recent avg of last 3 vs 3 before that → slope direction
  const tail = recent.slice(-3).map(d => d.value!)
  const prev = recent.slice(-6, -3).map(d => d.value!)
  const tailAvg = tail.reduce((a, b) => a + b, 0) / tail.length
  const prevAvg = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : tailAvg
  const trending = tailAvg - prevAvg

  if (tailAvg < mean - sd * 0.9)   return { label: 'Unaligned ↓',    color: '#dc2626', bg: 'bg-red-100 text-red-800' }
  if (tailAvg < mean - sd * 0.25 && trending < 0) return { label: 'Trending Down', color: '#ea580c', bg: 'bg-orange-100 text-orange-800' }
  if (tailAvg > mean + sd * 0.9)   return { label: 'Unaligned ↑',    color: '#7c3aed', bg: 'bg-purple-100 text-purple-800' }
  if (tailAvg > mean + sd * 0.25 && trending > 0) return { label: 'Trending Up',   color: '#0284c7', bg: 'bg-sky-100 text-sky-800' }
  return { label: 'Aligned', color: '#16a34a', bg: 'bg-green-100 text-green-800' }
}

// ── Info button with AI summary ────────────────────────────────────────
function InsightButton({ metric, series, indicator }: {
  metric: string
  series: { value: number | null; mean: number | null; lower: number | null; upper: number | null }[]
  indicator: IndicatorInfo
}) {
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleClick = async () => {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (summary) return // already fetched

    setLoading(true)
    setError(false)
    const recent = series.filter(d => d.value != null).slice(-7)
    const lastBand = [...series].reverse().find(d => d.mean != null)
    try {
      const res = await fetch('/api/insights/metric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metric,
          recentValues: recent.map(d => d.value),
          mean: lastBand?.mean ?? null,
          sd: lastBand ? (lastBand.upper! - lastBand.mean!) : null,
          indicator: indicator.label,
        }),
      })
      const json = await res.json()
      if (json.summary) setSummary(json.summary)
      else setError(true)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={handleClick}
        className="ml-1.5 w-4 h-4 rounded-full border text-[10px] font-bold leading-none flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
        title="AI insight"
      >
        i
      </button>
      {open && (
        <div className="absolute z-50 right-0 top-6 w-72 bg-white border rounded-lg shadow-lg p-3 text-xs text-muted-foreground leading-relaxed">
          {loading && <span className="italic">Analyzing your data…</span>}
          {error && <span className="text-red-500">Failed to load insight. Check your ANTHROPIC_API_KEY.</span>}
          {summary && <p>{summary}</p>}
        </div>
      )}
    </div>
  )
}

// ── Single metric chart ────────────────────────────────────────────────
function MetricChart({ data, title, color }: {
  data: { day: string; value: number | null; upper: number | null; lower: number | null; mean: number | null }[]
  title: string
  color: string
}) {
  const indicator = useMemo(() => computeIndicator(data), [data])

  const allVals = data.flatMap(d => [d.value, d.upper, d.lower]).filter((v): v is number => v != null)
  const dataMin = allVals.length ? Math.min(...allVals) : 0
  const dataMax = allVals.length ? Math.max(...allVals) : 100
  const pad = (dataMax - dataMin) * 0.1 || 2
  const yMin = Math.floor(dataMin - pad)
  const yMax = Math.ceil(dataMax + pad)

  const chartData = data.map(d => ({
    ...d,
    band: d.lower != null && d.upper != null ? [d.lower, d.upper] : null,
  }))

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="flex items-center">
          <Badge variant="outline" className={`text-xs ${indicator.bg}`}>
            {indicator.label}
          </Badge>
          <InsightButton metric={title} series={data} indicator={indicator} />
        </div>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <ComposedChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis dataKey="day" tick={{ fontSize: 9 }} interval={Math.max(1, Math.floor(data.length / 8))} />
          <YAxis domain={[yMin, yMax]} tick={{ fontSize: 9 }} width={35} />
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Tooltip
            formatter={((v: unknown, name: string) => {
              if (name === 'band') return null
              const labels: Record<string, string> = { value: title, mean: '14d avg' }
              const num = Array.isArray(v) ? (v as number[])[1] : (v as number)
              return [Math.round(num * 10) / 10, labels[name] ?? name]
            }) as any}
          />
          <Area type="monotone" dataKey="band" fill={color} fillOpacity={0.18} stroke="none" legendType="none" name="band" />
          <Line type="monotone" dataKey="mean" stroke={color} strokeWidth={1} strokeDasharray="4 2" dot={false} opacity={0.55} name="mean" connectNulls />
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} name="value" connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Combined trend AI insight button ──────────────────────────────────
function ComboInsightButton({ seriesA, seriesB, seriesC }: {
  seriesA: { label: string; data: { value: number | null; mean: number | null; upper: number | null }[] }
  seriesB: { label: string; data: { value: number | null; mean: number | null; upper: number | null }[] }
  seriesC: { label: string; data: { value: number | null; mean: number | null; upper: number | null }[] }
}) {
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleClick = async () => {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (summary) return

    setLoading(true)
    setError(false)
    const toSeries = (s: typeof seriesA) => {
      const recent = s.data.filter(d => d.value != null).slice(-7)
      const lastBand = [...s.data].reverse().find(d => d.mean != null)
      return {
        name: s.label,
        values: recent.map(d => d.value),
        mean: lastBand?.mean ?? null,
      }
    }
    try {
      const res = await fetch('/api/insights/metric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ series: [toSeries(seriesA), toSeries(seriesB), toSeries(seriesC)] }),
      })
      const json = await res.json()
      if (json.summary) setSummary(json.summary)
      else setError(true)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={handleClick}
        className="ml-1.5 w-4 h-4 rounded-full border text-[10px] font-bold leading-none flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
        title="AI insight"
      >
        i
      </button>
      {open && (
        <div className="absolute z-50 right-0 top-6 w-72 bg-white border rounded-lg shadow-lg p-3 text-xs text-muted-foreground leading-relaxed">
          {loading && <span className="italic">Analyzing your data…</span>}
          {error && <span className="text-red-500">Failed to load insight. Check your API key.</span>}
          {summary && <p>{summary}</p>}
        </div>
      )}
    </div>
  )
}

// ── Main dashboard ────────────────────────────────────────────────────
export default function DashboardPage() {
  const [data, setData] = useState<OverviewData | null>(null)
  const [battery, setBattery] = useState<BodyBatteryPoint[]>([])
  const [vo2maxData, setVo2maxData] = useState<VO2maxPoint[]>([])
  const [vo2maxModel, setVo2maxModel] = useState<VO2maxModel | null>(null)
  const [days, setDays] = useState(30)
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const load = useCallback(() => {
    fetch(`/api/data/overview?days=${days}`)
      .then(r => r.json())
      .then(setData)
    fetch(`/api/data/body-battery?days=${days}`)
      .then(r => r.json())
      .then((d: { series: BodyBatteryPoint[] }) => setBattery(d.series ?? []))
      .catch(() => setBattery([]))
    fetch(`/api/analytics/vo2max?days=${days}`)
      .then(r => r.json())
      .then((d: { series: VO2maxPoint[]; model: VO2maxModel }) => {
        setVo2maxData(d.series ?? [])
        setVo2maxModel(d.model ?? null)
      })
      .catch(() => { setVo2maxData([]); setVo2maxModel(null) })
  }, [days])

  useEffect(() => { load() }, [load])

  const chartData = useMemo(() => {
    if (!data) return []
    // Union of all days across activity, battery, sleep
    const allDays = Array.from(new Set([
      ...data.activity.map(a => a.day),
      ...battery.map(b => b.day),
      ...data.sleep.map(s => s.day),
    ])).sort()
    const actMap = new Map(data.activity.map(a => [a.day, a.activity_score]))
    const batMap = new Map(battery.map(b => [b.day, b.body_battery]))
    const sleepMap = new Map(data.sleep.map(s => [s.day, s.sleep_score]))
    return allDays.map(day => ({
      day: day.slice(5),
      activity: actMap.get(day) ?? null,
      battery: batMap.get(day) ?? null,
      sleep: sleepMap.get(day) ?? null,
    }))
  }, [data, battery])

  const sleepSeries = useMemo(() => {
    if (!data) return []
    const vals = data.sleep.map(s => s.sleep_score as number | null)
    const bands = rollingStats(vals)
    return data.sleep.map((s, i) => ({ day: s.day.slice(5), value: s.sleep_score, ...bands[i] }))
  }, [data])

  const readinessSeries = useMemo(() => {
    if (!data) return []
    const vals = data.readiness.map(r => r.readiness_score as number | null)
    const bands = rollingStats(vals)
    return data.readiness.map((r, i) => ({ day: r.day.slice(5), value: r.readiness_score, ...bands[i] }))
  }, [data])

  const hrvSeries = useMemo(() => {
    if (!data) return []
    const vals = data.sleep.map(s => s.average_hrv as number | null)
    const bands = rollingStats(vals)
    return data.sleep.map((s, i) => ({ day: s.day.slice(5), value: s.average_hrv, ...bands[i] }))
  }, [data])

  const activitySeries = useMemo(() => {
    if (!data) return []
    const vals = data.activity.map(a => a.activity_score as number | null)
    const bands = rollingStats(vals)
    return data.activity.map((a, i) => ({ day: a.day.slice(5), value: a.activity_score, ...bands[i] }))
  }, [data])

  const rhrSeries = useMemo(() => {
    if (!data) return []
    const vals = data.sleep.map(s => s.lowest_heart_rate as number | null)
    const bands = rollingStats(vals)
    return data.sleep.map((s, i) => ({ day: s.day.slice(5), value: s.lowest_heart_rate, ...bands[i] }))
  }, [data])

  const batterySeries = useMemo(() => {
    if (!battery.length) return []
    const vals = battery.map(b => b.body_battery as number | null)
    const bands = rollingStats(vals)
    return battery.map((b, i) => ({ day: b.day.slice(5), value: b.body_battery, ...bands[i] }))
  }, [battery])

  const vo2maxCallout = useMemo(() => {
    if (!vo2maxData.length) return null
    // Latest value (actual or estimated)
    const reversed = [...vo2maxData].reverse()
    const latest = reversed.find(d => d.actual_vo2max != null || d.estimated_vo2max != null)
    if (!latest) return null
    const currentVal = latest.actual_vo2max ?? latest.estimated_vo2max ?? 0

    // Trend: compare avg of last 5 vs previous 5
    const withValue = vo2maxData.filter(d => (d.actual_vo2max ?? d.estimated_vo2max) != null)
    const recent5 = withValue.slice(-5).map(d => d.actual_vo2max ?? d.estimated_vo2max ?? 0)
    const prev5 = withValue.slice(-10, -5).map(d => d.actual_vo2max ?? d.estimated_vo2max ?? 0)
    const recentAvg = recent5.length ? recent5.reduce((a, b) => a + b, 0) / recent5.length : currentVal
    const prevAvg = prev5.length ? prev5.reduce((a, b) => a + b, 0) / prev5.length : recentAvg
    const diff = recentAvg - prevAvg
    const trend: 'up' | 'down' | 'unchanged' = Math.abs(diff) < 0.3 ? 'unchanged' : diff > 0 ? 'up' : 'down'

    // Confidence interval from model SE
    const ci = vo2maxModel ? Math.round(1.96 * vo2maxModel.standard_error * 10) / 10 : null

    return { value: Math.round(currentVal * 10) / 10, trend, ci, source: latest.source }
  }, [vo2maxData, vo2maxModel])

  if (!data) return <div className="text-muted-foreground">Loading...</div>

  const toggleSeries = (dataKey: string) => {
    setHidden(prev => {
      const next = new Set(prev)
      next.has(dataKey) ? next.delete(dataKey) : next.add(dataKey)
      return next
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Overview</h1>
          <p className="text-sm text-muted-foreground">Last {days} days</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="text-sm border rounded px-2 py-1"
          >
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
            <option value={365}>365 days</option>
          </select>
          <SyncButton onComplete={load} />
        </div>
      </div>

      {data.lastSync.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Last sync: {data.lastSync.map(s => `${s.source} (${fmtLocalTime(s.synced_at)})`).join(' · ')}
        </p>
      )}

      {/* Row 1: Readiness + Est VO2max + Body Battery */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricChart data={readinessSeries} title="Readiness Score" color="#10b981" />

        {/* VO2max callout card */}
        <div className="border rounded-lg p-4 flex flex-col items-center justify-center text-center">
          <h2 className="text-sm font-semibold text-muted-foreground mb-2">Est. VO2max</h2>
          {vo2maxCallout ? (
            <>
              <div className="text-4xl font-bold" style={{ color: '#06b6d4' }}>
                {vo2maxCallout.value}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className={`text-sm font-medium ${
                  vo2maxCallout.trend === 'up' ? 'text-green-600' :
                  vo2maxCallout.trend === 'down' ? 'text-red-600' :
                  'text-muted-foreground'
                }`}>
                  {vo2maxCallout.trend === 'up' ? '↑ Trending up' :
                   vo2maxCallout.trend === 'down' ? '↓ Trending down' :
                   '→ Stable'}
                </span>
              </div>
              {vo2maxCallout.ci != null && (
                <span className="text-xs text-muted-foreground mt-1">
                  ±{vo2maxCallout.ci} confidence interval
                </span>
              )}
              {vo2maxCallout.source === 'estimated' && (
                <span className="text-[10px] text-muted-foreground mt-1 opacity-60">
                  from non-running workout
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground text-sm">No data</span>
          )}
        </div>

        {batterySeries.length > 0
          ? <MetricChart data={batterySeries} title="Body Battery" color="#0ea5e9" />
          : <div />}
      </div>

      {/* Combined trend chart */}
      <div className="border rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-semibold">Activity · Body Battery · Sleep</h2>
            {[
              { key: 'activity', label: 'Activity',     color: '#8b5cf6' },
              { key: 'battery', label: 'Body Battery', color: '#0ea5e9' },
              { key: 'sleep',   label: 'Sleep',        color: '#6366f1' },
            ].map(({ key, label, color }) => (
              <button
                key={key}
                onClick={() => toggleSeries(key)}
                className="flex items-center gap-1.5 text-xs transition-opacity"
                style={{ opacity: hidden.has(key) ? 0.35 : 1 }}
              >
                <span className="inline-block w-5 h-0.5 rounded" style={{ background: color }} />
                <span style={{ color: hidden.has(key) ? '#aaa' : color, textDecoration: hidden.has(key) ? 'line-through' : 'none' }}>
                  {label}
                </span>
              </button>
            ))}
          </div>
          <ComboInsightButton
            seriesA={{ label: 'Activity Score',  data: activitySeries }}
            seriesB={{ label: 'Body Battery',    data: batterySeries }}
            seriesC={{ label: 'Sleep Score',     data: sleepSeries }}
          />
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 10 }}
              interval={Math.max(0, Math.round(chartData.length / 10) - 1)}
              tickFormatter={(d) => {
                const parts = String(d).split('-')
                if (parts.length !== 3) return String(d)
                return `${Number(parts[1])}/${Number(parts[2])}`
              }}
            />
            <YAxis domain={[20, 100]} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Line type="monotone" dataKey="activity" stroke="#8b5cf6" dot={false} strokeWidth={2} name="Activity" hide={hidden.has('activity')} connectNulls />
            <Line type="monotone" dataKey="battery"  stroke="#0ea5e9" dot={false} strokeWidth={2} name="Body Battery" hide={hidden.has('battery')} connectNulls />
            <Line type="monotone" dataKey="sleep"    stroke="#6366f1" dot={false} strokeWidth={2} name="Sleep" hide={hidden.has('sleep')} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Row 2: Activity Score + Sleep Score */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MetricChart data={activitySeries} title="Activity Score" color="#8b5cf6" />
        <MetricChart data={sleepSeries}    title="Sleep Score"    color="#6366f1" />
      </div>

      {/* Row 3: Resting Heart Rate + HRV */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MetricChart data={rhrSeries} title="Resting Heart Rate" color="#ef4444" />
        <MetricChart data={hrvSeries} title="HRV (ms)"           color="#f59e0b" />
      </div>

      {/* Recent workouts */}
      <div>
        <h2 className="text-sm font-semibold mb-3">Recent Workouts</h2>
        <div className="space-y-2">
          {data.recentActivities.slice(0, 10).map(a => (
            <div key={a.activity_id} className="flex items-center justify-between border rounded-md px-4 py-2.5 text-sm">
              <div className="flex items-center gap-3">
                <div>
                  <span className="font-medium">{a.activity_name}</span>
                  <span className="text-muted-foreground ml-2 text-xs">{a.start_day}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{fmtDuration(a.duration_sec)}</span>
                <span>HR {a.average_hr}bpm</span>
                {a.vo2max && <span>vO2 {a.vo2max}</span>}
                {a.calories && <span>{a.calories} cal</span>}
                {a.training_effect_label && (
                  <Badge
                    variant="outline"
                    className="text-xs"
                    style={{ borderColor: TE_COLORS[a.training_effect_label] ?? '#888', color: TE_COLORS[a.training_effect_label] ?? '#888' }}
                  >
                    {a.training_effect_label.replace('_', ' ')}
                  </Badge>
                )}
              </div>
            </div>
          ))}
          {data.recentActivities.length === 0 && (
            <p className="text-muted-foreground text-sm">No workouts synced yet. Click <strong>Sync All</strong> above.</p>
          )}
        </div>
      </div>
    </div>
  )
}
