'use client'

import { useEffect, useState, useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, Label
} from 'recharts'

interface MetricDef {
  id: string
  label: string
  source: string
  group: string
  unit?: string
  invertGood?: boolean
  fixedDomain?: [number, number]
}

interface Point { date: string; x: number; y: number; training_effect_label?: string; activity_type?: string }

const TE_COLORS: Record<string, string> = {
  SPEED: '#ef4444',
  LACTATE_THRESHOLD: '#f97316',
  TEMPO: '#eab308',
  AEROBIC_BASE: '#22c55e',
  VO2MAX: '#a855f7',
  RECOVERY: '#94a3b8',
}

const PRESETS = [
  { label: 'Deep Sleep % vs Readiness', x: 'deep_sleep_pct', y: 'readiness_score' },
  { label: 'HRV vs Aerobic Effect', x: 'hrv', y: 'aerobic_training_effect' },
  { label: 'Sleep Score vs Est. VO2max', x: 'sleep_score', y: 'estimated_vo2max' },
  { label: 'REM % vs HRV', x: 'rem_sleep_pct', y: 'hrv' },
  { label: 'Body Battery vs Avg HR', x: 'body_battery', y: 'average_hr' },
]

function rInterpret(r: number) {
  const abs = Math.abs(r)
  const dir = r >= 0 ? 'positive' : 'negative'
  if (abs >= 0.7) return { label: `Strong ${dir}`, color: 'text-green-600' }
  if (abs >= 0.4) return { label: `Moderate ${dir}`, color: 'text-amber-600' }
  if (abs >= 0.2) return { label: `Weak ${dir}`, color: 'text-muted-foreground' }
  return { label: 'No correlation', color: 'text-muted-foreground' }
}

export default function CorrelationExplorerPage() {
  const [metrics, setMetrics] = useState<MetricDef[]>([])
  const [xMetric, setXMetric] = useState('sleep_score')
  const [yMetric, setYMetric] = useState('average_hr')
  const [actType, setActType] = useState('')
  const [days, setDays] = useState(90)
  const [data, setData] = useState<{ r: number; n: number; points: Point[]; meanWith?: number; meanWithout?: number } | null>(null)

  // Load metric list
  useEffect(() => {
    fetch('/api/analytics/correlations?list=true')
      .then(r => r.json())
      .then(d => setMetrics(d.metrics ?? []))
  }, [])

  const load = useCallback(() => {
    const params = new URLSearchParams({ x: xMetric, y: yMetric, days: String(days) })
    if (actType) params.set('type', actType)
    fetch(`/api/analytics/correlations?${params}`)
      .then(r => r.json())
      .then(setData)
  }, [xMetric, yMetric, actType, days])

  useEffect(() => { load() }, [load])

  const xDef = metrics.find(m => m.id === xMetric)
  const yDef = metrics.find(m => m.id === yMetric)
  const xLabel = xDef?.label ?? xMetric
  const yLabel = yDef?.label ?? yMetric
  const rInfo = data ? rInterpret(data.r) : null

  // Show activity type filter when a workout metric is on either axis
  const hasWorkoutMetric = xDef?.source === 'workout' || yDef?.source === 'workout'
  // Show tag mean comparison when a tag metric is on either axis
  const hasTagMetric = xDef?.source === 'tag' || yDef?.source === 'tag'
  const tagIsX = xDef?.source === 'tag'
  const otherLabel = tagIsX ? yLabel : xLabel

  const chartPoints = data?.points ?? []

  function axisDomain(vals: number[], padding = 0.05): [number, number] {
    if (!vals.length) return [0, 100]
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * padding || 2
    return [Math.floor(min - pad), Math.ceil(max + pad)]
  }

  const xDomain = xDef?.fixedDomain ?? axisDomain(chartPoints.map(p => p.x))
  const yDomain = yDef?.fixedDomain ?? axisDomain(chartPoints.map(p => p.y))

  // Group metrics for the select dropdowns
  const groups = metrics.reduce((acc, m) => {
    if (!acc[m.group]) acc[m.group] = []
    acc[m.group].push(m)
    return acc
  }, {} as Record<string, MetricDef[]>)

  // Activity types for filter
  const activityTypes = [
    { value: '', label: 'All types' },
    { value: 'running', label: 'Running' },
    { value: 'indoor_running', label: 'Indoor Running' },
    { value: 'treadmill_running', label: 'Treadmill' },
    { value: 'other', label: 'CrossFit' },
    { value: 'walking', label: 'Walking' },
  ]

  function applyPreset(p: typeof PRESETS[number]) {
    setXMetric(p.x)
    setYMetric(p.y)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Correlation Explorer</h1>
        <p className="text-sm text-muted-foreground">Plot any metric against any other to find patterns in your health data</p>
      </div>

      {/* Quick presets */}
      <div className="flex flex-wrap gap-2">
        {PRESETS.map(p => (
          <button
            key={p.label}
            onClick={() => applyPreset(p)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              xMetric === p.x && yMetric === p.y
                ? 'bg-primary text-primary-foreground border-primary'
                : 'hover:bg-muted text-muted-foreground'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">X axis (input)</label>
          <select value={xMetric} onChange={e => setXMetric(e.target.value)} className="text-sm border rounded px-2 py-1.5 max-w-[220px]">
            {Object.entries(groups).map(([group, items]) => (
              <optgroup key={group} label={group}>
                {items.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Y axis (response)</label>
          <select value={yMetric} onChange={e => setYMetric(e.target.value)} className="text-sm border rounded px-2 py-1.5 max-w-[220px]">
            {Object.entries(groups).map(([group, items]) => (
              <optgroup key={group} label={group}>
                {items.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        {hasWorkoutMetric && (
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Activity type</label>
            <select value={actType} onChange={e => setActType(e.target.value)} className="text-sm border rounded px-2 py-1.5">
              {activityTypes.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Window</label>
          <select value={days} onChange={e => setDays(Number(e.target.value))} className="text-sm border rounded px-2 py-1.5">
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
            <option value={365}>365 days</option>
          </select>
        </div>
      </div>

      {data && (
        <div className="flex items-center gap-4 flex-wrap">
          <div className="text-4xl font-bold">{data.r.toFixed(2)}</div>
          <div>
            <div className={`font-medium ${rInfo?.color}`}>{rInfo?.label}</div>
            <div className="text-xs text-muted-foreground">Pearson r · {data.n} data points</div>
          </div>
          {data.n === 0 && (
            <Badge variant="outline" className="text-amber-600 border-amber-300">
              No data — try a wider window or different metrics
            </Badge>
          )}
          {data.n > 0 && data.n < 10 && (
            <Badge variant="outline" className="border-amber-400 text-amber-600">
              small sample — interpret cautiously
            </Badge>
          )}
          {xMetric === yMetric && (
            <Badge variant="outline" className="text-muted-foreground">
              same metric on both axes
            </Badge>
          )}
        </div>
      )}

      {/* Tag mean comparison callout */}
      {hasTagMetric && data && data.meanWith != null && data.meanWithout != null && (
        <div className="border rounded-lg p-4 bg-muted/30">
          <div className="text-sm font-medium mb-2">Mean Comparison</div>
          <div className="flex gap-6 text-sm">
            <div>
              <span className="text-muted-foreground">With tag: </span>
              <span className="font-semibold">{data.meanWith.toFixed(1)}</span>
              <span className="text-xs text-muted-foreground ml-1">{otherLabel}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Without tag: </span>
              <span className="font-semibold">{data.meanWithout.toFixed(1)}</span>
              <span className="text-xs text-muted-foreground ml-1">{otherLabel}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Difference: </span>
              <span className={`font-semibold ${data.meanWith > data.meanWithout ? 'text-green-600' : data.meanWith < data.meanWithout ? 'text-red-600' : ''}`}>
                {data.meanWith > data.meanWithout ? '+' : ''}{(data.meanWith - data.meanWithout).toFixed(1)}
                <span className="text-xs ml-1">
                  ({data.meanWithout > 0 ? `${((data.meanWith - data.meanWithout) / data.meanWithout * 100).toFixed(1)}%` : '—'})
                </span>
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="border rounded-lg p-4">
        <h2 className="text-sm font-semibold mb-4">{xLabel} vs {yLabel}</h2>
        <ResponsiveContainer width="100%" height={400}>
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="x" name={xLabel} type="number" domain={xDomain} tick={{ fontSize: 11 }}>
              <Label value={xLabel} position="insideBottom" offset={-5} style={{ fontSize: 11 }} />
            </XAxis>
            <YAxis dataKey="y" name={yLabel} type="number" domain={yDomain} tick={{ fontSize: 11 }}>
              <Label value={yLabel} angle={-90} position="insideLeft" style={{ fontSize: 11 }} />
            </YAxis>
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              content={({ payload }) => {
                if (!payload?.length) return null
                const d = payload[0]?.payload as Point & { y: number }
                return (
                  <div className="bg-white border rounded p-2 text-xs shadow">
                    <div className="font-semibold">{d.date}</div>
                    <div>{xLabel}: {typeof d.x === 'number' ? Math.round(d.x * 10) / 10 : d.x}</div>
                    <div>{yLabel}: {typeof d.y === 'number' ? Math.round(d.y * 10) / 10 : d.y}</div>
                    {d.training_effect_label && <div className="mt-1" style={{ color: TE_COLORS[d.training_effect_label] ?? '#6366f1' }}>{d.training_effect_label.replace(/_/g, ' ')}</div>}
                    {d.activity_type && !d.training_effect_label && <div className="mt-1 text-muted-foreground">{d.activity_type}</div>}
                  </div>
                )
              }}
            />
            {/* Mean reference lines */}
            {chartPoints.length > 0 && (
              <>
                <ReferenceLine
                  x={chartPoints.reduce((s, p) => s + p.x, 0) / chartPoints.length}
                  stroke="#94a3b8"
                  strokeDasharray="4 4"
                  strokeOpacity={0.5}
                />
                <ReferenceLine
                  y={chartPoints.reduce((s, p) => s + p.y, 0) / chartPoints.length}
                  stroke="#94a3b8"
                  strokeDasharray="4 4"
                  strokeOpacity={0.5}
                />
              </>
            )}
            <Scatter
              data={[...chartPoints].sort((a, b) => a.x - b.x)}
              fill="#6366f1"
              fillOpacity={0.7}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              shape={(props: any) => {
                const color = TE_COLORS[props?.payload?.training_effect_label ?? ''] ?? '#6366f1'
                return (
                  <circle
                    cx={props.cx}
                    cy={props.cy}
                    r={5}
                    fill={color}
                    fillOpacity={0.7}
                    stroke="white"
                    strokeWidth={1}
                  />
                )
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>

        {/* Training effect legend — only when workout metric is involved */}
        {hasWorkoutMetric && (
          <div className="flex flex-wrap gap-3 mt-3 justify-center">
            {Object.entries(TE_COLORS).map(([label, color]) => (
              <span key={label} className="flex items-center gap-1 text-xs">
                <span className="inline-block w-3 h-3 rounded-full" style={{ background: color }} />
                {label.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
