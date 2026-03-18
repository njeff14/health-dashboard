'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  ResponsiveContainer, ComposedChart, AreaChart, Area, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, ReferenceArea
} from 'recharts'

// ── Rolling stats (same pattern as dashboard) ───────────────────────────
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

// ── Indicator logic (same as dashboard) ─────────────────────────────────
type Indicator = 'Unaligned ↓' | 'Trending Down' | 'Aligned' | 'Trending Up' | 'Unaligned ↑'

interface IndicatorInfo { label: Indicator; color: string; bg: string }

function computeIndicator(
  series: { value: number | null; mean: number | null; lower: number | null; upper: number | null }[]
): IndicatorInfo {
  const recent = series.filter(d => d.value != null && d.mean != null).slice(-7)
  if (recent.length < 3) return { label: 'Aligned', color: '#16a34a', bg: 'bg-green-100 text-green-800' }

  const lastPoint = recent[recent.length - 1]
  const mean = lastPoint.mean!
  const upper = lastPoint.upper!
  const sd = upper - mean

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

// ── Phase colors ────────────────────────────────────────────────────────
const PHASE_COLORS: Record<string, string> = {
  sleep_deep:  '#3b82f6',
  sleep_light: '#93c5fd',
  sleep_rem:   '#a78bfa',
  sleep_awake: '#fbbf24',
  workout:     '#ef4444',
  passive:     '#6b7280',
}

// ── Types ───────────────────────────────────────────────────────────────
interface DailyBBRow {
  day: string
  body_battery: number
}

interface IntradayPoint {
  time: string
  minuteOfDay: number
  battery: number
  phase: string
  event?: string
}

interface IntradayData {
  day: string
  startingBattery: number
  points: IntradayPoint[]
  workouts: { name: string; start_time_local: string; duration_sec: number }[]
}

// ── Daily MetricChart (same pattern) ────────────────────────────────────
function MetricChart({ data, title, color, onDayClick }: {
  data: { day: string; value: number | null; upper: number | null; lower: number | null; mean: number | null; fullDay: string }[]
  title: string
  color: string
  onDayClick: (day: string) => void
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
        <Badge variant="outline" className={`text-xs ${indicator.bg}`}>
          {indicator.label}
        </Badge>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={chartData} onClick={(e: Record<string, unknown>) => {
          const ap = (e as { activePayload?: { payload?: { fullDay?: string } }[] })?.activePayload
          if (ap?.[0]?.payload?.fullDay) {
            onDayClick(ap[0].payload.fullDay)
          }
        }}>
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
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} name="value" connectNulls style={{ cursor: 'pointer' }} />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-xs text-muted-foreground mt-1">Click a data point to view intraday detail</p>
    </div>
  )
}

// ── Custom tooltip for intraday chart ────────────────────────────────────
function IntradayTooltip({ active, payload }: { active?: boolean; payload?: { payload: IntradayPoint }[] }) {
  if (!active || !payload?.[0]) return null
  const p = payload[0].payload
  return (
    <div className="bg-white border rounded-lg shadow-lg p-2 text-xs">
      <div className="font-medium">{p.time}</div>
      <div>Battery: <span className="font-semibold">{p.battery}%</span></div>
      <div className="capitalize" style={{ color: PHASE_COLORS[p.phase] || '#6b7280' }}>{p.phase.replace('_', ' ')}</div>
      {p.event && <div className="font-medium text-red-600 mt-1">{p.event}</div>}
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────────────
export default function BodyBatteryPage() {
  const [days, setDays] = useState(30)
  const [dailyData, setDailyData] = useState<DailyBBRow[] | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [intradayData, setIntradayData] = useState<IntradayData | null>(null)
  const [intradayLoading, setIntradayLoading] = useState(false)

  const loadDaily = useCallback(() => {
    fetch(`/api/data/body-battery?days=${days}`)
      .then(r => r.json())
      .then(data => setDailyData(data.series || []))
  }, [days])

  useEffect(() => { loadDaily() }, [loadDaily])

  const loadIntraday = useCallback((day: string) => {
    setSelectedDay(day)
    setIntradayLoading(true)
    setIntradayData(null)
    fetch(`/api/data/body-battery/intraday?day=${day}`)
      .then(r => r.json())
      .then(data => { setIntradayData(data); setIntradayLoading(false) })
      .catch(() => setIntradayLoading(false))
  }, [])

  const dailySeries = useMemo(() => {
    if (!dailyData) return []
    const vals = dailyData.map(d => d.body_battery > 0 ? d.body_battery : null)
    const bands = rollingStats(vals)
    return dailyData.map((d, i) => ({
      day: d.day.slice(5),
      fullDay: d.day,
      value: d.body_battery > 0 ? d.body_battery : null,
      ...bands[i],
    }))
  }, [dailyData])

  // Compute battery zone color for intraday
  const getBatteryColor = (battery: number): string => {
    if (battery >= 70) return '#22c55e'
    if (battery >= 40) return '#eab308'
    if (battery >= 20) return '#f97316'
    return '#ef4444'
  }

  // Prepare intraday chart data with gradient stops
  const intradayChartData = useMemo(() => {
    if (!intradayData) return []
    return intradayData.points.map(p => ({
      ...p,
      batteryColor: getBatteryColor(p.battery),
    }))
  }, [intradayData])

  if (!dailyData) return <div className="text-muted-foreground">Loading...</div>

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Body Battery</h1>
          <p className="text-sm text-muted-foreground">
            Composite recovery metric combining readiness, training load, and stress balance
          </p>
        </div>
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
        </select>
      </div>

      {/* Daily overview chart */}
      <MetricChart
        data={dailySeries}
        title="Daily Body Battery"
        color="#10b981"
        onDayClick={loadIntraday}
      />

      {/* Intraday detail */}
      {selectedDay && (
        <div className="border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Intraday Detail: {selectedDay}</h2>
            <button onClick={() => setSelectedDay(null)} className="text-xs text-muted-foreground hover:text-foreground">
              Close
            </button>
          </div>

          {intradayLoading && (
            <div className="text-sm text-muted-foreground py-8 text-center">
              Loading intraday data from Oura API...
            </div>
          )}

          {intradayData && (
            <>
              {/* Legend */}
              <div className="flex flex-wrap gap-3 mb-3 text-xs">
                {Object.entries(PHASE_COLORS).map(([phase, color]) => (
                  <div key={phase} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                    <span className="capitalize">{phase.replace('_', ' ')}</span>
                  </div>
                ))}
              </div>

              {/* Battery level chart */}
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={intradayChartData}>
                  <defs>
                    <linearGradient id="batteryGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} />
                      <stop offset="50%" stopColor="#eab308" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0.2} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 9 }}
                    interval={11} // every hour (12 five-min slots)
                  />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 9 }} width={35} />
                  <Tooltip content={<IntradayTooltip />} />

                  {/* Color zones */}
                  <ReferenceArea y1={70} y2={100} fill="#22c55e" fillOpacity={0.05} />
                  <ReferenceArea y1={40} y2={70} fill="#eab308" fillOpacity={0.05} />
                  <ReferenceArea y1={20} y2={40} fill="#f97316" fillOpacity={0.05} />
                  <ReferenceArea y1={0} y2={20} fill="#ef4444" fillOpacity={0.05} />

                  {/* Zone lines */}
                  <ReferenceLine y={70} stroke="#22c55e" strokeDasharray="3 3" opacity={0.3} />
                  <ReferenceLine y={40} stroke="#eab308" strokeDasharray="3 3" opacity={0.3} />
                  <ReferenceLine y={20} stroke="#f97316" strokeDasharray="3 3" opacity={0.3} />

                  <Area
                    type="monotone"
                    dataKey="battery"
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="url(#batteryGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>

              {/* Phase timeline bar */}
              <div className="mt-2">
                <div className="text-xs text-muted-foreground mb-1">Activity Phases</div>
                <div className="flex h-3 rounded-full overflow-hidden">
                  {intradayChartData.map((p, i) => (
                    <div
                      key={i}
                      className="h-full"
                      style={{
                        width: `${100 / 288}%`,
                        backgroundColor: PHASE_COLORS[p.phase] || '#6b7280',
                      }}
                      title={`${p.time} - ${p.phase.replace('_', ' ')}`}
                    />
                  ))}
                </div>
                <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5">
                  <span>00:00</span>
                  <span>06:00</span>
                  <span>12:00</span>
                  <span>18:00</span>
                  <span>24:00</span>
                </div>
              </div>

              {/* Workout events */}
              {intradayData.workouts.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs font-medium mb-2">Workouts</div>
                  <div className="space-y-1">
                    {intradayData.workouts.map((w, i) => (
                      <div key={i} className="text-xs text-muted-foreground flex gap-2">
                        <span className="font-medium text-foreground">{w.name}</span>
                        <span>{new Date(w.start_time_local).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                        <span>{Math.round(w.duration_sec / 60)}min</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
