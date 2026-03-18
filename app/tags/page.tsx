'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend
} from 'recharts'

interface TagOption { tag_text: string; count: number }
type MetricDelta = { before: number | null; after: number | null; delta: number | null }
interface TagImpact {
  tag: string; occurrences: number; window: number
  metrics: Record<string, MetricDelta>
  dailyPattern: Record<string, number | null>[]
}

function cleanTag(raw: string): string {
  if (raw.startsWith('workout_')) {
    return raw.replace('workout_', '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }
  return raw.replace(/^tag_[a-z]+_/, '').replace(/_/g, ' ')
}

function xLabel(offset: number): string {
  if (offset === -1) return 'Day before'
  if (offset === 0)  return 'Day of'
  if (offset === 1)  return 'Night after'
  return `Night ${offset}`
}

function deltaColor(delta: number | null, invertGood = false) {
  if (delta == null) return 'text-muted-foreground'
  const good = invertGood ? delta <= 0 : delta >= 0
  return good ? 'text-green-600' : 'text-red-600'
}

function deltaStr(delta: number | null) {
  if (delta == null) return '—'
  return `${delta >= 0 ? '+' : ''}${Math.round(delta * 10) / 10}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeDot(color: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function CustomDot(props: any) {
    const { cx, cy, payload } = props
    if (cx == null || cy == null) return null
    const offset: number = payload?.offset ?? 0
    if (offset === 0) {
      return (
        <g key={`dot-${cx}-${cy}`}>
          <circle cx={cx} cy={cy} r={7} fill="white" stroke="#f59e0b" strokeWidth={2.5} />
          <circle cx={cx} cy={cy} r={4} fill={color} />
        </g>
      )
    }
    if (offset < 0) {
      return <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={5} fill={color} opacity={0.9} stroke="white" strokeWidth={1.5} />
    }
    return <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={4} fill={color} opacity={0.6} stroke="white" strokeWidth={1} />
  }
}

const ALL_METRICS = [
  // Original 5
  { key: 'sleep_score',      label: 'Sleep Score',        patternKey: 'avg_sleep',      chartKey: 'sleep',      color: '#6366f1', yAxis: 'score', invertGood: false },
  { key: 'resting_hr',       label: 'Resting HR',         patternKey: 'avg_rhr',        chartKey: 'rhr',        color: '#ef4444', yAxis: 'raw',   invertGood: true  },
  { key: 'hrv',              label: 'HRV (ms)',            patternKey: 'avg_hrv',        chartKey: 'hrv',        color: '#f59e0b', yAxis: 'raw',   invertGood: false },
  { key: 'readiness_score',  label: 'Readiness Score',    patternKey: 'avg_readiness',  chartKey: 'readiness',  color: '#10b981', yAxis: 'score', invertGood: false },
  { key: 'body_battery',     label: 'Body Battery',       patternKey: 'avg_battery',    chartKey: 'battery',    color: '#0ea5e9', yAxis: 'score', invertGood: false },
  // Sleep stages
  { key: 'deep_sleep_min',   label: 'Deep Sleep (min)',   patternKey: 'avg_deep_min',   chartKey: 'deep_min',   color: '#8b5cf6', yAxis: 'raw',   invertGood: false },
  { key: 'deep_sleep_pct',   label: 'Deep Sleep %',       patternKey: 'avg_deep_pct',   chartKey: 'deep_pct',   color: '#7c3aed', yAxis: 'score', invertGood: false },
  { key: 'rem_sleep_min',    label: 'REM Sleep (min)',     patternKey: 'avg_rem_min',    chartKey: 'rem_min',    color: '#ec4899', yAxis: 'raw',   invertGood: false },
  { key: 'rem_sleep_pct',    label: 'REM Sleep %',        patternKey: 'avg_rem_pct',    chartKey: 'rem_pct',    color: '#db2777', yAxis: 'score', invertGood: false },
  { key: 'efficiency',       label: 'Sleep Efficiency',   patternKey: 'avg_efficiency', chartKey: 'efficiency', color: '#14b8a6', yAxis: 'score', invertGood: false },
]

const DEFAULT_SELECTED = new Set(['sleep_score', 'resting_hr', 'hrv', 'readiness_score', 'body_battery'])

export default function TagsPage() {
  const [tags, setTags] = useState<TagOption[]>([])
  const [workoutTags, setWorkoutTags] = useState<TagOption[]>([])
  const [selectedLifestyle, setSelectedLifestyle] = useState<string | null>(null)
  const [selectedWorkout, setSelectedWorkout] = useState<string | null>(null)
  const [impact, setImpact] = useState<TagImpact | null>(null)
  const [daysAfter, setDaysAfter] = useState(3)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [selectedMetrics, setSelectedMetrics] = useState<Set<string>>(DEFAULT_SELECTED)

  useEffect(() => {
    fetch('/api/analytics/tag-impact')
      .then(r => r.json())
      .then(d => {
        setTags(d.tags ?? [])
        setWorkoutTags(d.workoutTags ?? [])
      })
  }, [])

  useEffect(() => {
    // Need at least one selection to query
    if (!selectedLifestyle && !selectedWorkout) { setImpact(null); return }
    setImpact(null)

    let params: URLSearchParams
    if (selectedLifestyle && selectedWorkout) {
      // Intersection: days where both occurred
      params = new URLSearchParams({ tag: selectedLifestyle, after: String(daysAfter), workout: selectedWorkout })
    } else if (selectedLifestyle) {
      // Lifestyle tag only
      params = new URLSearchParams({ tag: selectedLifestyle, after: String(daysAfter) })
    } else {
      // Workout type only — pass as the primary tag anchor
      params = new URLSearchParams({ tag: selectedWorkout!, after: String(daysAfter) })
    }

    fetch(`/api/analytics/tag-impact?${params}`)
      .then(r => r.json())
      .then(setImpact)
  }, [selectedLifestyle, selectedWorkout, daysAfter])

  const toggleMetric = (key: string) => setSelectedMetrics(prev => {
    const next = new Set(prev)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    return next
  })

  const toggleLine = (key: string) => setHidden(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  const activeMetrics = ALL_METRICS.filter(m => selectedMetrics.has(m.key))

  const chartData = impact?.dailyPattern.map(d => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: any = { label: xLabel(d.offset as number), offset: d.offset }
    for (const m of ALL_METRICS) {
      const raw = d[m.patternKey]
      row[m.chartKey] = raw != null ? Math.round(raw * 10) / 10 : null
    }
    return row
  }) ?? []

  // Y-axis domains derived from visible active metrics
  const visibleScoreVals = chartData.flatMap(d =>
    activeMetrics.filter(m => m.yAxis === 'score' && !hidden.has(m.key))
      .map(m => d[m.chartKey] as number | null)
  ).filter((v): v is number => v != null)

  const visibleRawVals = chartData.flatMap(d =>
    activeMetrics.filter(m => m.yAxis === 'raw' && !hidden.has(m.key))
      .map(m => d[m.chartKey] as number | null)
  ).filter((v): v is number => v != null)

  function tightDomain(vals: number[]): [number, number] {
    if (!vals.length) return [0, 100]
    const min = Math.min(...vals), max = Math.max(...vals)
    const pad = (max - min) * 0.15 || 3
    return [Math.floor(min - pad), Math.ceil(max + pad)]
  }

  const scoreDomain = tightDomain(visibleScoreVals)
  const rawDomain   = tightDomain(visibleRawVals)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Tag Impact Analysis</h1>
        <p className="text-sm text-muted-foreground">How tags and workout types affect your health metrics in the surrounding days</p>
      </div>

      {tags.length === 0 && workoutTags.length === 0 && (
        <div className="border rounded-lg p-6 text-center text-muted-foreground">
          No tags found. Sync your Oura and Garmin data first.
        </div>
      )}

      {tags.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Lifestyle Tags</p>
          <div className="flex flex-wrap gap-2">
            {tags.map(t => (
              <button
                key={t.tag_text}
                onClick={() => setSelectedLifestyle(prev => prev === t.tag_text ? null : t.tag_text)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${selectedLifestyle === t.tag_text ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'}`}
              >
                {cleanTag(t.tag_text)} <span className="text-xs opacity-60">×{t.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {workoutTags.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Workout Types</p>
            {selectedLifestyle && (
              <span className="text-xs text-muted-foreground italic">
                — optionally filter to days where both occurred
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {workoutTags.map(t => (
              <button
                key={t.tag_text}
                onClick={() => setSelectedWorkout(prev => prev === t.tag_text ? null : t.tag_text)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${selectedWorkout === t.tag_text ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'}`}
              >
                {cleanTag(t.tag_text)} <span className="text-xs opacity-60">×{t.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Metric picker */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Metrics to Analyze</p>
        <div className="flex flex-wrap gap-1.5">
          {ALL_METRICS.map(m => (
            <button
              key={m.key}
              onClick={() => toggleMetric(m.key)}
              className={`px-2.5 py-1 text-xs rounded-md border transition-all ${
                selectedMetrics.has(m.key)
                  ? 'border-current font-medium'
                  : 'border-transparent opacity-40 hover:opacity-70'
              }`}
              style={{ color: m.color }}
            >
              <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: m.color }} />
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {(selectedLifestyle || selectedWorkout) && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-muted-foreground">1 day before +</span>
          {[1, 2, 3, 4, 5].map(w => (
            <button
              key={w}
              onClick={() => setDaysAfter(w)}
              className={`px-3 py-1 text-sm rounded border ${daysAfter === w ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
            >
              {w} day{w > 1 ? 's' : ''} after
            </button>
          ))}
        </div>
      )}

      {(selectedLifestyle || selectedWorkout) && !impact && <p className="text-muted-foreground text-sm">Loading...</p>}

      {impact && impact.occurrences === 0 && (
        <p className="text-muted-foreground">
          No days found for <strong>{cleanTag(impact.tag)}</strong>
          {selectedLifestyle && selectedWorkout && <> combined with <strong>{cleanTag(selectedWorkout)}</strong></>}.
        </p>
      )}

      {impact && impact.occurrences > 0 && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold capitalize">
              {cleanTag(impact.tag)}
              {selectedLifestyle && selectedWorkout && (
                <span className="text-muted-foreground font-normal"> + {cleanTag(selectedWorkout)}</span>
              )}
            </h2>
            <Badge variant="outline">{impact.occurrences} occurrence{impact.occurrences !== 1 ? 's' : ''}</Badge>
            {impact.occurrences < 5 && (
              <Badge variant="outline" className="border-amber-400 text-amber-600">
                small sample — interpret cautiously
              </Badge>
            )}
          </div>

          {/* Delta summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {activeMetrics.map(({ key, label, invertGood, color }) => {
              const m = impact.metrics[key]
              if (!m) return null
              return (
                <div key={key} className="border rounded-lg p-3" style={{ borderLeftColor: color, borderLeftWidth: 3 }}>
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className={`text-2xl font-bold mt-1 ${deltaColor(m.delta, invertGood)}`}>
                    {deltaStr(m.delta)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {m.before != null ? Math.round(m.before * 10) / 10 : '—'} → {m.after != null ? Math.round(m.after * 10) / 10 : '—'}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Combined line chart */}
          <div className="border rounded-lg p-4">
            {/* Clickable legend */}
            <div className="flex flex-wrap gap-4 mb-4">
              {activeMetrics.map(({ key, label, color }) => (
                <button
                  key={key}
                  onClick={() => toggleLine(key)}
                  className="flex items-center gap-1.5 text-sm transition-opacity"
                  style={{ opacity: hidden.has(key) ? 0.35 : 1 }}
                >
                  <span
                    className="inline-block w-6 h-0.5 rounded"
                    style={{ background: color, opacity: hidden.has(key) ? 0.4 : 1 }}
                  />
                  <span style={{ color: hidden.has(key) ? '#aaa' : color, textDecoration: hidden.has(key) ? 'line-through' : 'none' }}>
                    {label}
                  </span>
                </button>
              ))}
            </div>

            {/* Dot legend */}
            <div className="flex gap-5 mb-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <svg width="10" height="10"><circle cx="5" cy="5" r="4.5" fill="#888" opacity={0.9} /></svg>
                Baseline
              </span>
              <span className="flex items-center gap-1">
                <svg width="14" height="14">
                  <circle cx="7" cy="7" r="6" fill="white" stroke="#f59e0b" strokeWidth="2.5" />
                  <circle cx="7" cy="7" r="3" fill="#888" />
                </svg>
                Day of tag
              </span>
              <span className="flex items-center gap-1">
                <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="#888" opacity={0.55} /></svg>
                After tag
              </span>
            </div>

            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData} margin={{ top: 8, right: 40, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="score" domain={scoreDomain} tick={{ fontSize: 9 }} width={30} />
                <YAxis yAxisId="raw" orientation="right" domain={rawDomain} tick={{ fontSize: 9 }} width={30} />
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={((v: number, name: string) => [Math.round(v * 10) / 10, name]) as any}
                />
                {activeMetrics.map(({ key, label, chartKey, color, yAxis }) => {
                  const CustomDot = makeDot(color)
                  return (
                    <Line
                      key={key}
                      yAxisId={yAxis}
                      type="monotone"
                      dataKey={chartKey}
                      name={label}
                      stroke={color}
                      strokeWidth={2}
                      dot={hidden.has(key) ? false : <CustomDot />}
                      activeDot={hidden.has(key) ? false : { r: 6, fill: color }}
                      hide={hidden.has(key)}
                      connectNulls
                    />
                  )
                })}
                <Legend content={() => null} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  )
}
