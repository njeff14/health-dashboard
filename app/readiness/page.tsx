'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell
} from 'recharts'

interface BatteryPoint {
  day: string
  body_battery: number | null
  readiness: number | null
  atl_norm: number | null
  recovery_ratio: number | null
  stress_weight: number | null
}

interface Activity {
  activity_id: number; activity_name: string; activity_type: string
  start_day: string; duration_sec: number; calories: number
  average_hr: number; max_hr: number; aerobic_training_effect: number
  anaerobic_training_effect: number; training_effect_label: string; vo2max: number
}
interface Readiness { day: string; readiness_score: number; contributor_hrv_balance: number; contributor_recovery_index: number }
interface Sleep { day: string; sleep_score: number; average_hrv: number }

interface DayData {
  day: string
  readiness: number | null
  hrv_balance: number | null
  sleep_score: number | null
  average_hr: number | null
  aerobic_effect: number | null
  training_label: string | null
}

const TE_ORDER = ['AEROBIC_BASE', 'TEMPO', 'LACTATE_THRESHOLD', 'SPEED', 'VO2MAX'] as const
const TE_DISPLAY: Record<string, string> = {
  AEROBIC_BASE: 'Aerobic Base',
  TEMPO: 'Tempo',
  LACTATE_THRESHOLD: 'Lactate Threshold',
  SPEED: 'Speed',
  VO2MAX: 'VO2 Max',
}
const TE_COLORS: Record<string, string> = {
  AEROBIC_BASE: '#22c55e', TEMPO: '#eab308',
  LACTATE_THRESHOLD: '#f97316', SPEED: '#ef4444', VO2MAX: '#a855f7',
}

interface TEBucket {
  label: string
  count: number
  avgHR: number
  totalAerobic: number
  totalAnaerobic: number
}

interface VO2maxPoint {
  day: string
  actual_vo2max: number | null
  estimated_vo2max: number | null
  estimate_lower: number | null
  estimate_upper: number | null
  source: 'garmin' | 'estimated' | null
  hr_efficiency: number | null
  activity_type: string | null
}

interface VO2maxModel {
  r_squared: number
  standard_error: number
  n_training: number
}

export default function ReadinessPage() {
  const [days, setDays] = useState(60)
  const [chartData, setChartData] = useState<DayData[]>([])
  const [battery, setBattery] = useState<BatteryPoint[]>([])
  const [teBuckets, setTEBuckets] = useState<TEBucket[]>([])
  const [vo2maxData, setVo2maxData] = useState<VO2maxPoint[]>([])
  const [vo2maxModel, setVo2maxModel] = useState<VO2maxModel | null>(null)

  const load = useCallback(async () => {
    const [overviewRes, actRes, battRes, vo2Res] = await Promise.all([
      fetch(`/api/data/overview?days=${days}`).then(r => r.json()),
      fetch(`/api/data/activities?days=${days}`).then(r => r.json()),
      fetch(`/api/data/body-battery?days=${days}`).then(r => r.json()).catch(() => ({ series: [] })),
      fetch(`/api/analytics/vo2max?days=${days}`).then(r => r.json()).catch(() => ({ series: [], model: null })),
    ])
    setBattery(battRes.series ?? [])
    setVo2maxData(vo2Res.series ?? [])
    setVo2maxModel(vo2Res.model ?? null)

    const readiness: Readiness[] = overviewRes.readiness ?? []
    const sleep: Sleep[] = overviewRes.sleep ?? []
    const activities: Activity[] = actRes.data ?? []

    const actMap = new Map<string, Activity>()
    for (const a of activities) {
      const prev = actMap.get(a.start_day)
      if (!prev || (a.aerobic_training_effect ?? 0) > (prev.aerobic_training_effect ?? 0)) {
        actMap.set(a.start_day, a)
      }
    }

    const sleepMap = new Map(sleep.map(s => [s.day, s]))

    const merged: DayData[] = readiness.map(r => {
      const act = actMap.get(r.day)
      const s = sleepMap.get(r.day)
      return {
        day: r.day.slice(5),
        readiness: r.readiness_score,
        hrv_balance: r.contributor_hrv_balance,
        sleep_score: s?.sleep_score ?? null,
        average_hr: act?.average_hr ?? null,
        aerobic_effect: act?.aerobic_training_effect ?? null,
        training_label: act?.training_effect_label ?? null,
      }
    })
    setChartData(merged)

    // Group by Garmin training effect label (last 30 days)
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    const teMap = new Map<string, { hrs: number[]; aero: number; anaero: number }>()
    for (const a of activities) {
      if (!a.training_effect_label || a.start_day < cutoffStr) continue
      const entry = teMap.get(a.training_effect_label) ?? { hrs: [], aero: 0, anaero: 0 }
      if (a.average_hr) entry.hrs.push(a.average_hr)
      entry.aero   += a.aerobic_training_effect   ?? 0
      entry.anaero += a.anaerobic_training_effect ?? 0
      teMap.set(a.training_effect_label, entry)
    }
    const buckets: TEBucket[] = TE_ORDER
      .filter(label => teMap.has(label))
      .map(label => {
        const e = teMap.get(label)!
        return {
          label,
          count: e.hrs.length,
          avgHR: e.hrs.length ? Math.round(e.hrs.reduce((a, b) => a + b, 0) / e.hrs.length) : 0,
          totalAerobic:   Math.round(e.aero   * 10) / 10,
          totalAnaerobic: Math.round(e.anaero * 10) / 10,
        }
      })
    setTEBuckets(buckets)
  }, [days])

  useEffect(() => { load() }, [load])

  // "Main focus" = highest combined score (count weighted + total strain)
  const focusLabel = teBuckets.length
    ? teBuckets.reduce((best, b) =>
        (b.count * 3 + b.totalAerobic + b.totalAnaerobic) > (best.count * 3 + best.totalAerobic + best.totalAnaerobic) ? b : best
      ).label
    : null

  const batteryChartData = useMemo(() => {
    return battery
      .filter(b => b.body_battery != null)
      .map(b => {
        const sw = b.stress_weight ?? 1
        const readiness_contrib = (b.readiness ?? 0) * 0.50
        const freshness_contrib = (100 - (b.atl_norm ?? 0)) * 0.30
        const recovery_contrib = b.recovery_ratio != null
          ? b.recovery_ratio * 100 * 0.20 * sw
          : 10 * sw
        return {
          day: b.day.slice(5),
          body_battery: b.body_battery,
          readiness_contrib: Math.round(readiness_contrib * 10) / 10,
          freshness_contrib: Math.round(freshness_contrib * 10) / 10,
          recovery_contrib:  Math.round(recovery_contrib  * 10) / 10,
          atl_norm:          b.atl_norm != null ? Math.round(b.atl_norm) : null,
          recovery_pct:      b.recovery_ratio != null ? Math.round(b.recovery_ratio * 100) : null,
        }
      })
  }, [battery])

  const vo2ChartData = useMemo(() => {
    return vo2maxData
      .filter(d => d.actual_vo2max != null || d.estimated_vo2max != null)
      .map(d => ({
        day: d.day.slice(5),
        actual: d.actual_vo2max,
        estimated: d.estimated_vo2max,
        ci_band: d.estimate_lower != null && d.estimate_upper != null
          ? [d.estimate_lower, d.estimate_upper] as [number, number]
          : null,
        hr_efficiency: d.hr_efficiency != null ? Math.round(d.hr_efficiency * 10) / 10 : null,
        source: d.source,
        activity_type: d.activity_type,
      }))
  }, [vo2maxData])

  const xInterval = Math.max(0, Math.round(batteryChartData.length / 10) - 1)
  const vo2XInterval = Math.max(0, Math.round(vo2ChartData.length / 10) - 1)

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Readiness Analysis</h1>
          <p className="text-sm text-muted-foreground">How your readiness score correlates with training quality</p>
        </div>
        <select value={days} onChange={e => setDays(Number(e.target.value))} className="text-sm border rounded px-2 py-1">
          <option value={30}>30 days</option>
          <option value={60}>60 days</option>
          <option value={90}>90 days</option>
          <option value={180}>180 days</option>
          <option value={365}>365 days</option>
        </select>
      </div>

      {/* Training effect breakdown — last 30 days */}
      <div>
        <p className="text-xs text-muted-foreground mb-3">Training focus — last 30 days</p>
        <div className="flex flex-wrap gap-3">
          {teBuckets.map(b => {
            const isFocus = b.label === focusLabel
            const color = TE_COLORS[b.label] ?? '#94a3b8'
            return (
              <div
                key={b.label}
                className={`flex-1 min-w-[160px] rounded-lg p-4 border-2 transition-colors ${isFocus ? 'border-orange-400 bg-orange-50/40' : 'border-border'}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                  <span className="text-sm font-semibold">{TE_DISPLAY[b.label] ?? b.label}</span>
                  {isFocus && <span className="ml-auto text-[10px] font-medium text-orange-500 uppercase tracking-wide">Main focus</span>}
                </div>
                <div className="text-3xl font-bold">{b.count}</div>
                <div className="text-xs text-muted-foreground mt-0.5">workouts</div>
                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  <div>Avg HR <strong className="text-foreground">{b.avgHR || '—'} bpm</strong></div>
                  <div>Aerobic strain <strong className="text-foreground">{b.totalAerobic}</strong></div>
                  <div>Anaerobic strain <strong className="text-foreground">{b.totalAnaerobic}</strong></div>
                </div>
              </div>
            )
          })}
          {teBuckets.length === 0 && (
            <p className="text-sm text-muted-foreground">No workout data in the last 30 days. Sync Garmin to populate.</p>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="border rounded-lg p-4">
        <h2 className="text-sm font-semibold mb-4">Readiness vs Workout HR (same day)</h2>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="day" tick={{ fontSize: 10 }} interval={4} />
            <YAxis yAxisId="score" domain={[40, 100]} tick={{ fontSize: 10 }} />
            <YAxis yAxisId="hr" orientation="right" domain={[100, 200]} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Legend />
            <Line yAxisId="score" type="monotone" dataKey="readiness" stroke="#10b981" dot={false} strokeWidth={2} name="Readiness" />
            <Line yAxisId="score" type="monotone" dataKey="sleep_score" stroke="#6366f1" dot={false} strokeWidth={1.5} strokeDasharray="4 2" name="Sleep Score" />
            <Bar yAxisId="hr" dataKey="average_hr" fill="#f59e0b" opacity={0.5} name="Workout Avg HR" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Aerobic effect timeline */}
      <div className="border rounded-lg p-4">
        <h2 className="text-sm font-semibold mb-4">Readiness vs Aerobic Training Effect</h2>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="day" tick={{ fontSize: 10 }} interval={4} />
            <YAxis yAxisId="score" domain={[40, 100]} tick={{ fontSize: 10 }} />
            <YAxis yAxisId="effect" orientation="right" domain={[0, 5]} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Legend />
            <Line yAxisId="score" type="monotone" dataKey="readiness" stroke="#10b981" dot={false} strokeWidth={2} name="Readiness" />
            <Bar yAxisId="effect" dataKey="aerobic_effect" fill="#6366f1" opacity={0.7} name="Aerobic Effect" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* VO2max Estimation */}
      {vo2ChartData.length > 0 && (
        <div className="border rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-1">VO2max — Actual vs Estimated</h2>
          <div className="flex items-center gap-4 mb-4">
            <p className="text-xs text-muted-foreground">
              Solid dots are Garmin-measured (running). Dashed line is estimated from non-running workouts via regression.
            </p>
            {vo2maxModel && (
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                R² = {vo2maxModel.r_squared.toFixed(2)} · {vo2maxModel.n_training} training runs · SE = ±{vo2maxModel.standard_error.toFixed(1)}
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={vo2ChartData} margin={{ right: 40 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} interval={vo2XInterval} />
              <YAxis
                yAxisId="vo2"
                domain={['dataMin - 2', 'dataMax + 2']}
                tick={{ fontSize: 10 }}
                width={32}
                label={{ value: 'VO2max', angle: -90, position: 'insideLeft', style: { fontSize: 9 } }}
              />
              <YAxis
                yAxisId="eff"
                orientation="right"
                domain={['dataMin - 3', 'dataMax + 3']}
                tick={{ fontSize: 10 }}
                width={36}
                label={{ value: 'HR Efficiency', angle: 90, position: 'insideRight', style: { fontSize: 9 } }}
              />
              <Tooltip
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={((value: unknown, name: string) => {
                  if (name === 'ci_band') return null
                  const labels: Record<string, string> = {
                    actual: 'VO2max (Garmin)',
                    estimated: 'VO2max (est.)',
                    hr_efficiency: 'HR Efficiency',
                  }
                  const num = Array.isArray(value) ? (value as number[])[1] : value
                  return [typeof num === 'number' ? Math.round(Number(num) * 10) / 10 : num, labels[name] ?? name]
                }) as any}
              />
              <Legend
                formatter={(value) => {
                  const labels: Record<string, string> = {
                    ci_band: 'Confidence Band',
                    actual: 'VO2max (Garmin)',
                    estimated: 'VO2max (estimated)',
                    hr_efficiency: 'HR Efficiency (lower = fitter)',
                  }
                  return labels[value] ?? value
                }}
              />
              {/* Confidence band for estimated values */}
              <Area
                yAxisId="vo2"
                type="monotone"
                dataKey="ci_band"
                fill="#06b6d4"
                fillOpacity={0.15}
                stroke="none"
                name="ci_band"
                connectNulls={false}
              />
              {/* Actual running VO2max — scatter-style dots */}
              <Line
                yAxisId="vo2"
                type="monotone"
                dataKey="actual"
                stroke="#06b6d4"
                strokeWidth={0}
                dot={{ r: 5, fill: '#06b6d4', stroke: '#fff', strokeWidth: 1.5 }}
                name="actual"
                connectNulls={false}
              />
              {/* Estimated VO2max — dashed line */}
              <Line
                yAxisId="vo2"
                type="monotone"
                dataKey="estimated"
                stroke="#06b6d4"
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={{ r: 3, fill: '#06b6d4', fillOpacity: 0.5, stroke: 'none' }}
                name="estimated"
                connectNulls={false}
              />
              {/* HR efficiency on right axis */}
              <Line
                yAxisId="eff"
                type="monotone"
                dataKey="hr_efficiency"
                stroke="#f59e0b"
                strokeWidth={1.5}
                dot={false}
                name="hr_efficiency"
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="text-xs text-muted-foreground mt-2">
            HR Efficiency = (Avg HR − Resting HR) / Aerobic TE. Lower values indicate better cardiovascular fitness — achieving the same training stimulus with less heart rate elevation.
          </p>
        </div>
      )}

      {batteryChartData.length > 0 && (<>
        {/* Body battery composition */}
        <div className="border rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-1">Body Battery — Component Breakdown</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Stacked bars show the weighted contribution of each component. The line is your total body battery.
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={batteryChartData} margin={{ right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} interval={xInterval} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={28} />
              <Tooltip
                formatter={(value: number, name: string) => {
                  const labels: Record<string, string> = {
                    readiness_contrib: 'Readiness (50%)',
                    freshness_contrib:  'Freshness (30%)',
                    recovery_contrib:   'Recovery (20%)',
                    body_battery:       'Body Battery',
                  }
                  return [value, labels[name] ?? name]
                }}
              />
              <Legend
                content={() => {
                  const items = [
                    { key: 'readiness_contrib', color: '#10b981', label: 'Readiness (50%)', title: "Oura's composite recovery score — reflects HRV, resting heart rate, sleep quality, and body temperature." },
                    { key: 'freshness_contrib',  color: '#8b5cf6', label: 'Freshness (30%)',  title: "Inverse of your recent training load (ATL) — high when you've had lighter training days, suppressed after heavy blocks." },
                    { key: 'recovery_contrib',   color: '#0ea5e9', label: 'Recovery (20%)',   title: "Oura's daily stress-to-recovery balance, discounted on workout days to avoid double-counting training stress." },
                    { key: 'body_battery',       color: '#f59e0b', label: 'Body Battery',     title: 'Weighted total of all three components, representing your overall daily energy and recovery capacity.' },
                  ]
                  return (
                    <div className="flex flex-wrap gap-4 justify-center mt-1">
                      {items.map(item => (
                        <div key={item.key} className="flex items-center gap-1.5 text-xs cursor-default" title={item.title}>
                          <span className="inline-block w-3 h-3 rounded-sm flex-shrink-0" style={{ background: item.color, opacity: item.key === 'body_battery' ? 1 : 0.75 }} />
                          <span className="underline decoration-dotted underline-offset-2 text-muted-foreground">{item.label}</span>
                        </div>
                      ))}
                    </div>
                  )
                }}
              />
              <Bar dataKey="readiness_contrib" stackId="bb" fill="#10b981" opacity={0.75} name="readiness_contrib" />
              <Bar dataKey="freshness_contrib"  stackId="bb" fill="#8b5cf6" opacity={0.75} name="freshness_contrib" />
              <Bar dataKey="recovery_contrib"   stackId="bb" fill="#0ea5e9" opacity={0.75} name="recovery_contrib" />
              <Line type="monotone" dataKey="body_battery" stroke="#f59e0b" strokeWidth={2} dot={false} name="body_battery" connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Training load vs Oura recovery */}
        <div className="border rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-1">Training Load vs Recovery Balance</h2>
          <p className="text-xs text-muted-foreground mb-4">
            ATL (bars) reflects cumulative training fatigue — higher suppresses body battery. Recovery % (line) is Oura's stress/recovery ratio for the day.
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={batteryChartData} margin={{ right: 40 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} interval={xInterval} />
              <YAxis yAxisId="atl" domain={[0, 100]} tick={{ fontSize: 10 }} width={28} label={{ value: 'ATL', angle: -90, position: 'insideLeft', style: { fontSize: 9 } }} />
              <YAxis yAxisId="rec" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} width={36} label={{ value: 'Recovery %', angle: 90, position: 'insideRight', style: { fontSize: 9 } }} />
              <Tooltip
                formatter={(value: number, name: string) => {
                  if (name === 'atl_norm') return [`${value}`, 'Training Load (ATL norm)']
                  if (name === 'recovery_pct') return [`${value}%`, 'Oura Recovery %']
                  return [value, name]
                }}
              />
              <Legend
                formatter={(value) =>
                  value === 'atl_norm' ? 'Training Load (ATL norm)' : value === 'recovery_pct' ? 'Oura Recovery %' : value
                }
              />
              <Bar yAxisId="atl" dataKey="atl_norm" name="atl_norm" opacity={0.6}>
                {batteryChartData.map((d, i) => (
                  <Cell
                    key={i}
                    fill={
                      d.atl_norm == null ? '#94a3b8'
                        : d.atl_norm >= 80 ? '#ef4444'
                        : d.atl_norm >= 50 ? '#f97316'
                        : '#22c55e'
                    }
                  />
                ))}
              </Bar>
              <Line yAxisId="rec" type="monotone" dataKey="recovery_pct" stroke="#0ea5e9" strokeWidth={2} dot={false} name="recovery_pct" connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </>)}
    </div>
  )
}
