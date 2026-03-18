'use client'

import { useState, useEffect } from 'react'
import { SyncButton } from '@/components/sync/SyncButton'
import { format, subDays } from 'date-fns'

interface SyncLog { source: string; synced_at: string; start_date: string; end_date: string; records_written: number; error: string | null }

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

export default function SyncPage() {
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 90), 'yyyy-MM-dd'))
  const [endDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [log, setLog] = useState<SyncLog[]>([])

  function loadLog() {
    fetch('/api/data/overview?days=1')
      .then(r => r.json())
      .then(d => setLog(d.lastSync ?? []))
  }

  useEffect(() => { loadLog() }, [])

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Sync Data</h1>
        <p className="text-sm text-muted-foreground">Pull latest data from Oura and Garmin into your local database</p>
      </div>

      <div className="border rounded-lg p-5 space-y-4">
        <h2 className="font-semibold">Sync Range</h2>
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

        <div className="flex flex-wrap gap-3 pt-2">
          <SyncButton source="all" startDate={startDate} label="Sync All" onComplete={loadLog} />
          <SyncButton source="oura" startDate={startDate} label="Oura only" onComplete={loadLog} />
          <SyncButton source="garmin" startDate={startDate} label="Garmin only" onComplete={loadLog} />
        </div>
      </div>

      <div className="border rounded-lg p-5">
        <h2 className="font-semibold mb-3">What gets synced</h2>
        <div className="grid grid-cols-2 gap-4 text-sm text-muted-foreground">
          <div>
            <div className="font-medium text-foreground mb-1">Oura</div>
            <ul className="space-y-1">
              <li>• Daily sleep scores + contributors</li>
              <li>• Detailed sleep (HRV, RHR, stages)</li>
              <li>• Daily readiness + contributors</li>
              <li>• Daily activity score + steps</li>
              <li>• Daily stress & recovery</li>
              <li>• Tags (built-in + custom)</li>
              <li>• SpO2</li>
            </ul>
          </div>
          <div>
            <div className="font-medium text-foreground mb-1">Garmin</div>
            <ul className="space-y-1">
              <li>• All activities (runs, CrossFit)</li>
              <li>• HR (avg & max)</li>
              <li>• Training effect labels</li>
              <li>• Aerobic / anaerobic effect</li>
              <li>• vO2 Max estimates</li>
              <li>• Calories & duration</li>
              <li>• Distance & elevation</li>
            </ul>
          </div>
        </div>
      </div>

      {log.length > 0 && (
        <div className="border rounded-lg p-5">
          <h2 className="font-semibold mb-3">Recent syncs</h2>
          <div className="space-y-2 text-sm">
            {log.map((l, i) => (
              <div key={i} className="flex justify-between items-center py-1.5 border-b last:border-0">
                <span className="font-medium capitalize">{l.source}</span>
                <span className="text-muted-foreground">{fmtLocalTime(l.synced_at)}</span>
                {l.error && <span className="text-destructive text-xs">{l.error}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
