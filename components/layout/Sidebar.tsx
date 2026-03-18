'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Activity, Moon, Heart, Tag, BarChart2, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

const nav = [
  { href: '/dashboard', label: 'Overview', icon: BarChart2 },
  { href: '/sleep-performance', label: 'Correlation Explorer', icon: Activity },
  { href: '/readiness', label: 'Readiness', icon: Heart },
  { href: '/tags', label: 'Tag Impact', icon: Tag },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const path = usePathname()
  return (
    <aside className="w-56 shrink-0 border-r bg-muted/30 min-h-screen flex flex-col py-6 px-3 gap-1">
      <div className="flex items-center gap-2 px-3 mb-6">
        <Activity className="h-5 w-5 text-primary" />
        <span className="font-semibold text-sm">Health Dashboard</span>
      </div>
      {nav.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
            path === href
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          )}
        >
          <Icon className="h-4 w-4" />
          {label}
        </Link>
      ))}
      <div className="mt-auto px-3 pt-4 border-t">
        <p className="text-[10px] text-muted-foreground/60">© 2026 Corevia Technology</p>
      </div>
    </aside>
  )
}
