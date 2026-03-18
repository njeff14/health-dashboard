'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ResponsiveContainer, LineChart, Line } from 'recharts'
import { cn } from '@/lib/utils'

type Status = 'optimal' | 'good' | 'low' | 'na'

function getStatus(score: number | null): Status {
  if (score == null) return 'na'
  if (score >= 85) return 'optimal'
  if (score >= 70) return 'good'
  return 'low'
}

const statusStyles: Record<Status, string> = {
  optimal: 'bg-green-100 text-green-800',
  good: 'bg-blue-100 text-blue-800',
  low: 'bg-amber-100 text-amber-800',
  na: 'bg-gray-100 text-gray-500',
}

interface MetricCardProps {
  title: string
  value: number | null
  unit?: string
  trend?: number[]
  status?: Status
  subtitle?: string
}

export function MetricCard({ title, value, unit = '', trend = [], subtitle }: MetricCardProps) {
  const status = getStatus(value)
  const sparkData = trend.map(v => ({ v }))

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground flex justify-between items-center">
          {title}
          <Badge variant="outline" className={cn('text-xs', statusStyles[status])}>
            {status === 'na' ? 'No data' : status}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">
          {value != null ? `${Math.round(value)}${unit}` : '—'}
        </div>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        {sparkData.length > 1 && (
          <div className="h-10 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkData}>
                <Line type="monotone" dataKey="v" stroke="#6366f1" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
