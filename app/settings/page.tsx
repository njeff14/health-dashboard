'use client'

import { useEffect, useState, useCallback } from 'react'
import { SyncButton } from '@/components/sync/SyncButton'
import { format, subDays } from 'date-fns'

interface HRSettings {
  hr_max: string
  hr_resting: string
  hr_lthr: string
  hr_zone_method: string
  [key: string]: string
}

/** Joe Friel LTHR-based zones */
function zonesFromLTHR(lthr: number): { name: string; label: string; min: number; max: number; color: string }[] {
  return [
    { name: 'Zone 1', label: 'Recovery',        min: 0,                    max: Math.round(lthr * 0.81), color: '#94a3b8' },
    { name: 'Zone 2', label: 'Aerobic',          min: Math.round(lthr * 0.81), max: Math.round(lthr * 0.89), color: '#22c55e' },
    { name: 'Zone 3', label: 'Tempo',            min: Math.round(lthr * 0.90), max: Math.round(lthr * 0.93), color: '#eab308' },
    { name: 'Zone 4', label: 'Sub-Threshold',    min: Math.round(lthr * 0.94), max: Math.round(lthr * 0.99), color: '#f97316' },
    { name: 'Zone 5a', label: 'Super-Threshold', min: Math.round(lthr * 1.00), max: Math.round(lthr * 1.02), color: '#ef4444' },
    { name: 'Zone 5b', label: 'VO2max',          min: Math.round(lthr * 1.03), max: Math.round(lthr * 1.06), color: '#dc2626' },
    { name: 'Zone 5c', label: 'Anaerobic',       min: Math.round(lthr * 1.06), max: 999,                     color: '#991b1b' },
  ]
}

/** Percentage-of-max zones */
function zonesFromMax(maxHR: number): { name: string; label: string; min: number; max: number; color: string }[] {
  return [
    { name: 'Zone 1', label: 'Recovery',  min: 0,                      max: Math.round(maxHR * 0.60), color: '#94a3b8' },
    { name: 'Zone 2', label: 'Easy',      min: Math.round(maxHR * 0.60), max: Math.round(maxHR * 0.70), color: '#22c55e' },
    { name: 'Zone 3', label: 'Moderate',  min: Math.round(maxHR * 0.70), max: Math.round(maxHR * 0.80), color: '#eab308' },
    { name: 'Zone 4', label: 'Hard',      min: Math.round(maxHR * 0.80), max: Math.round(maxHR * 0.90), color: '#f97316' },
    { name: 'Zone 5', label: 'Max',       min: Math.round(maxHR * 0.90), max: maxHR,                    color: '#ef4444' },
  ]
}

function fmtLocalTime(utcStr: string): string {
  if (!utcStr) return ''
  const iso = utcStr.includes('T') ? utcStr : utcStr.replace(' ', 'T') + 'Z'
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
    hour12: true,
  })
}

interface SyncLog { source: string; synced_at: string; error: string | null }

export default function SettingsPage() {
  const [settings, setSettings] = useState<HRSettings>({
    hr_max: '206',
    hr_resting: '58',
    hr_lthr: '183',
    hr_zone_method: 'lthr',
  })
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 90), 'yyyy-MM-dd'))
  const [endDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [syncLog, setSyncLog] = useState<SyncLog[]>([])

  function loadSyncLog() {
    fetch('/api/data/overview?days=1')
      .then(r => r.json())
      .then(d => setSyncLog(d.lastSync ?? []))
  }

  const load = useCallback(() => {
    fetch('/api/settings').then(r => r.json()).then((s: HRSettings) => {
      setSettings(prev => ({ ...prev, ...s }))
    })
    loadSyncLog()
  }, [])

  useEffect(() => { load() }, [load])

  function update(key: string, value: string) {
    setSettings(prev => ({ ...prev, [key]: value }))
    setDirty(true)
    setSaved(false)
  }

  async function save() {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    setDirty(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const maxHR = Number(settings.hr_max) || 185
  const lthr = Number(settings.hr_lthr) || 165
  const restingHR = Number(settings.hr_resting) || 60
  const method = settings.hr_zone_method

  const zones = method === 'lthr' ? zonesFromLTHR(lthr) : zonesFromMax(maxHR)
  const hrReserve = maxHR - restingHR

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      {/* Sync Data */}
      <div className="border rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold">Sync Data</h2>
        <p className="text-xs text-muted-foreground">Pull latest data from Oura and Garmin into your local database</p>
        <div className="flex gap-4 items-end">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="text-sm border rounded px-2 py-1.5"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">End date</label>
            <input type="date" value={endDate} disabled className="text-sm border rounded px-2 py-1.5 opacity-50" />
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <SyncButton source="all"    startDate={startDate} label="Sync All"     onComplete={loadSyncLog} />
          <SyncButton source="oura"   startDate={startDate} label="Oura only"   onComplete={loadSyncLog} />
          <SyncButton source="garmin" startDate={startDate} label="Garmin only" onComplete={loadSyncLog} />
        </div>
        {syncLog.length > 0 && (
          <div className="space-y-1 pt-1">
            {syncLog.map((l, i) => (
              <div key={i} className="flex justify-between items-center text-xs text-muted-foreground">
                <span className="font-medium capitalize text-foreground">{l.source}</span>
                <span>{fmtLocalTime(l.synced_at)}</span>
                {l.error && <span className="text-destructive">{l.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* HR inputs */}
      <div className="border rounded-lg p-5 space-y-5">
        <h2 className="text-sm font-semibold">Heart Rate Profile</h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Max Heart Rate</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={settings.hr_max}
                onChange={e => update('hr_max', e.target.value)}
                className="w-24 text-sm border rounded px-2 py-1.5"
              />
              <span className="text-xs text-muted-foreground">bpm</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">220 - age = {220 - 30} (age 30)</p>
          </div>

          <div>
            <label className="text-xs text-muted-foreground block mb-1">Resting Heart Rate</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={settings.hr_resting}
                onChange={e => update('hr_resting', e.target.value)}
                className="w-24 text-sm border rounded px-2 py-1.5"
              />
              <span className="text-xs text-muted-foreground">bpm</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Lowest during sleep from Oura</p>
          </div>

          <div>
            <label className="text-xs text-muted-foreground block mb-1">Lactate Threshold HR (LTHR)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={settings.hr_lthr}
                onChange={e => update('hr_lthr', e.target.value)}
                className="w-24 text-sm border rounded px-2 py-1.5"
              />
              <span className="text-xs text-muted-foreground">bpm</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">30-min time trial avg HR is a good proxy</p>
          </div>
        </div>

        <div>
          <label className="text-xs text-muted-foreground block mb-1">Zone Calculation Method</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="method"
                value="lthr"
                checked={method === 'lthr'}
                onChange={() => update('hr_zone_method', 'lthr')}
              />
              Joe Friel (LTHR-based)
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="method"
                value="max"
                checked={method === 'max'}
                onChange={() => update('hr_zone_method', 'max')}
              />
              % of Max HR
            </label>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={!dirty}
            className="text-sm px-4 py-1.5 bg-primary text-primary-foreground rounded disabled:opacity-50"
          >
            Save
          </button>
          {saved && <span className="text-xs text-green-600">Saved!</span>}
        </div>
      </div>

      {/* Derived stats */}
      <div className="border rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold">Derived Values</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">HR Reserve</div>
            <div className="text-lg font-bold">{hrReserve} <span className="text-xs font-normal">bpm</span></div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">LTHR % of Max</div>
            <div className="text-lg font-bold">{((lthr / maxHR) * 100).toFixed(1)}<span className="text-xs font-normal">%</span></div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Zone Method</div>
            <div className="text-lg font-bold">{method === 'lthr' ? 'Joe Friel' : '% Max'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Zones</div>
            <div className="text-lg font-bold">{zones.length}</div>
          </div>
        </div>
      </div>

      {/* Zone table + visual bar */}
      <div className="border rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold">Heart Rate Zones</h2>

        {/* Visual bar */}
        <div className="flex h-8 rounded overflow-hidden">
          {zones.map((z, i) => {
            const rangeMin = i === 0 ? restingHR : z.min
            const rangeMax = z.max > maxHR ? maxHR : z.max
            const width = ((rangeMax - rangeMin) / (maxHR - restingHR)) * 100
            return (
              <div
                key={z.name}
                className="flex items-center justify-center text-[10px] text-white font-medium"
                style={{ backgroundColor: z.color, width: `${Math.max(width, 5)}%` }}
                title={`${z.name}: ${z.min}–${z.max > maxHR ? maxHR + '+' : z.max} bpm`}
              >
                {z.name}
              </div>
            )
          })}
        </div>

        {/* Table */}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground border-b">
              <th className="text-left py-2 font-medium">Zone</th>
              <th className="text-left py-2 font-medium">Label</th>
              <th className="text-right py-2 font-medium">Min HR</th>
              <th className="text-right py-2 font-medium">Max HR</th>
              <th className="text-right py-2 font-medium">% Max</th>
            </tr>
          </thead>
          <tbody>
            {zones.map(z => (
              <tr key={z.name} className="border-b last:border-0">
                <td className="py-2 flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: z.color }} />
                  {z.name}
                </td>
                <td className="py-2">{z.label}</td>
                <td className="py-2 text-right tabular-nums">{z.min}</td>
                <td className="py-2 text-right tabular-nums">{z.max > maxHR ? `${maxHR}+` : z.max}</td>
                <td className="py-2 text-right tabular-nums text-muted-foreground">
                  {Math.round((z.min / maxHR) * 100)}–{z.max > maxHR ? '100+' : Math.round((z.max / maxHR) * 100)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
