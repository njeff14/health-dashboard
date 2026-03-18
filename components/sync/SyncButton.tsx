'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SyncButtonProps {
  source?: 'oura' | 'garmin' | 'all'
  startDate?: string
  onComplete?: (result: unknown) => void
  label?: string
}

export function SyncButton({ source = 'all', startDate, onComplete, label }: SyncButtonProps) {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  async function handleSync() {
    setLoading(true)
    setStatus(null)
    try {
      const url = source === 'all' ? '/api/sync'
        : source === 'oura' ? '/api/sync/oura'
        : '/api/sync/garmin'

      const body: Record<string, unknown> = {}
      if (startDate) body.startDate = startDate
      if (source !== 'all') body.sources = [source]

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      setStatus(data.success ? 'Synced!' : `Error: ${data.errors?.join(', ') ?? data.error}`)
      onComplete?.(data)
    } catch (e: unknown) {
      setStatus(`Failed: ${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button onClick={handleSync} disabled={loading} size="sm">
        <RefreshCw className={cn('h-4 w-4 mr-2', loading && 'animate-spin')} />
        {label ?? (source === 'all' ? 'Sync All' : `Sync ${source}`)}
      </Button>
      {status && (
        <span className={cn('text-sm', status.startsWith('Error') || status.startsWith('Failed')
          ? 'text-destructive' : 'text-green-600')}>
          {status}
        </span>
      )}
    </div>
  )
}
