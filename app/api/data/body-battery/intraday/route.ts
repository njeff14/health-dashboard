import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { computeDailyBodyBattery } from '@/lib/analytics/bodyBattery'

export const dynamic = 'force-dynamic'

interface OuraSleepInterval {
  heart_rate: { interval: number; items: (number | null)[] }
  hrv: { interval: number; items: (number | null)[] }
  sleep_phase_5_min: string | null
  bedtime_start: string
  bedtime_end: string
}

interface OuraSleepResponse {
  data: OuraSleepInterval[]
}

interface GarminActivity {
  start_time_local: string
  duration_sec: number
  aerobic_training_effect: number | null
  anaerobic_training_effect: number | null
  activity_name: string
}

interface IntradayPoint {
  time: string       // HH:MM
  minuteOfDay: number
  battery: number
  phase: string      // 'sleep_deep' | 'sleep_rem' | 'sleep_light' | 'sleep_awake' | 'workout' | 'passive'
  event?: string     // label for workout events
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export async function GET(req: NextRequest) {
  const day = req.nextUrl.searchParams.get('day')
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json({ error: 'day parameter required (YYYY-MM-DD)' }, { status: 400 })
  }

  const token = process.env.OURA_PERSONAL_ACCESS_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'OURA_PERSONAL_ACCESS_TOKEN not set' }, { status: 500 })
  }

  // Fetch Oura sleep data with 5-min intervals
  // Oura's "day" = the morning the sleep ends. Query the target day to get the
  // previous night's sleep, plus the next day to capture any sleep starting in the evening.
  const [y, m, d] = day.split('-').map(Number)
  const prevDay = new Date(y, m - 1, d - 1)
  const prevDayStr = `${prevDay.getFullYear()}-${String(prevDay.getMonth() + 1).padStart(2, '0')}-${String(prevDay.getDate()).padStart(2, '0')}`
  const nextDay = new Date(y, m - 1, d + 1)
  const nextDayStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`

  let sleepData: OuraSleepInterval[] = []
  try {
    // Query day-1 through day+1 to capture any sleep that overlaps with this calendar day
    const res = await fetch(
      `https://api.ouraring.com/v2/usercollection/sleep?start_date=${prevDayStr}&end_date=${nextDayStr}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
    )
    if (res.ok) {
      const json: OuraSleepResponse = await res.json()
      sleepData = json.data || []
    }
  } catch (e) {
    console.error('Failed to fetch Oura sleep intervals:', e)
  }

  // Get Garmin activities for this day
  const db = getDb()
  const garminActivities = db.prepare(`
    SELECT start_time_local, duration_sec, aerobic_training_effect, anaerobic_training_effect, activity_name
    FROM garmin_activities
    WHERE start_day = ?
    ORDER BY start_time_local
  `).all(day) as GarminActivity[]

  // Get previous day's body battery as starting level
  const prevBB = computeDailyBodyBattery(prevDayStr, prevDayStr)
  let startingBattery = prevBB.length > 0 && prevBB[0].body_battery > 0
    ? prevBB[0].body_battery
    : 50 // fallback

  // Get user's resting HR for baseline comparison
  const hrRow = db.prepare(`SELECT value FROM user_settings WHERE key = 'hr_resting'`).get() as { value: string } | undefined
  const hrResting = hrRow ? Number(hrRow.value) : 55

  // Build intraday timeline (5-min resolution, full 24 hours = 288 points)
  const points: IntradayPoint[] = []

  // Phase 1: Build sleep charging data from Oura intervals
  interface SleepBlock {
    startMinute: number  // minute of day relative to target day midnight
    hrItems: (number | null)[]
    hrvItems: (number | null)[]
    phases: string       // sleep_phase_5_min string
  }

  const sleepBlocks: SleepBlock[] = []
  const targetMidnight = parseLocalDate(day).getTime()

  for (const sleep of sleepData) {
    if (!sleep.bedtime_start || !sleep.bedtime_end) continue
    if (!sleep.sleep_phase_5_min) continue

    const bedStart = new Date(sleep.bedtime_start).getTime()
    // Snap to nearest 5-minute boundary so keys align with the 5-min slot grid
    const rawMinute = (bedStart - targetMidnight) / 60000
    const startMinute = Math.round(rawMinute / 5) * 5

    sleepBlocks.push({
      startMinute,
      hrItems: sleep.heart_rate?.items || [],
      hrvItems: sleep.hrv?.items || [],
      phases: sleep.sleep_phase_5_min,
    })
  }

  // Phase map: 1=deep, 2=light, 3=REM, 4=awake
  const phaseLabels: Record<string, string> = {
    '1': 'sleep_deep',
    '2': 'sleep_light',
    '3': 'sleep_rem',
    '4': 'sleep_awake',
  }

  // Build a minute-by-minute map of sleep data
  const sleepMap = new Map<number, { hr: number | null; hrv: number | null; phase: string }>()
  for (const block of sleepBlocks) {
    for (let i = 0; i < block.phases.length; i++) {
      const minute = block.startMinute + i * 5
      const phaseChar = block.phases[i]
      const phase = phaseLabels[phaseChar] || 'sleep_light'
      const hr = i < block.hrItems.length ? block.hrItems[i] : null
      const hrv = i < block.hrvItems.length ? block.hrvItems[i] : null
      sleepMap.set(minute, { hr, hrv, phase })
    }
  }

  // Build workout time ranges (minute of day)
  interface WorkoutBlock {
    startMinute: number
    endMinute: number
    drain: number // total drain points
    name: string
  }

  const workoutBlocks: WorkoutBlock[] = []
  for (const act of garminActivities) {
    const actStart = new Date(act.start_time_local).getTime()
    const rawMin = (actStart - targetMidnight) / 60000
    const startMin = Math.round(rawMin / 5) * 5
    const durationMin = Math.round(act.duration_sec / 60)
    const aero = act.aerobic_training_effect ?? 0
    const anaero = act.anaerobic_training_effect ?? 0
    const drain = (aero * 10) + (anaero * 15) // matches session stress formula
    workoutBlocks.push({
      startMinute: startMin,
      endMinute: startMin + durationMin,
      drain: Math.max(5, Math.min(40, drain)), // clamp drain to reasonable range
      name: act.activity_name || 'Workout',
    })
  }

  // Generate 288 five-minute points starting at midnight
  let battery = startingBattery
  const PASSIVE_DRAIN_PER_5MIN = 0.15  // ~1.8 pts/hr

  for (let slot = 0; slot < 288; slot++) {
    const minute = slot * 5
    const hours = Math.floor(minute / 60)
    const mins = minute % 60
    const timeStr = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`

    const sleepInfo = sleepMap.get(minute)

    // Check if in a workout
    const workout = workoutBlocks.find(w => minute >= w.startMinute && minute < w.endMinute)

    let phase = 'passive'
    let event: string | undefined

    if (workout) {
      phase = 'workout'
      const totalSlots = Math.max(1, Math.round((workout.endMinute - workout.startMinute) / 5))
      const drainPerSlot = workout.drain / totalSlots
      battery = Math.max(0, battery - drainPerSlot)
      if (minute === workout.startMinute) {
        event = workout.name
      }
    } else if (sleepInfo) {
      phase = sleepInfo.phase

      // Charge rate depends on sleep phase and HR/HRV
      let chargeRate = 0
      if (phase === 'sleep_deep') {
        chargeRate = 0.8 // fast charge in deep sleep
      } else if (phase === 'sleep_rem') {
        chargeRate = 0.3
      } else if (phase === 'sleep_light') {
        chargeRate = 0.5
      } else if (phase === 'sleep_awake') {
        chargeRate = 0 // no charging while awake
      }

      // Modulate by HR (lower = better charging) and HRV (higher = better)
      if (sleepInfo.hr != null && sleepInfo.hr > 0) {
        const hrFactor = Math.max(0.5, Math.min(1.5, hrResting / sleepInfo.hr))
        chargeRate *= hrFactor
      }
      if (sleepInfo.hrv != null && sleepInfo.hrv > 0) {
        const hrvFactor = Math.max(0.7, Math.min(1.3, sleepInfo.hrv / 50))
        chargeRate *= hrvFactor
      }

      battery = Math.min(100, battery + chargeRate)
    } else {
      // Passive daytime drain
      battery = Math.max(0, battery - PASSIVE_DRAIN_PER_5MIN)
    }

    points.push({
      time: timeStr,
      minuteOfDay: minute,
      battery: Math.round(battery * 10) / 10,
      phase,
      event,
    })
  }

  return NextResponse.json({
    day,
    startingBattery,
    points,
    workouts: garminActivities.map(a => ({
      name: a.activity_name,
      start_time_local: a.start_time_local,
      duration_sec: a.duration_sec,
      aerobic_te: a.aerobic_training_effect,
      anaerobic_te: a.anaerobic_training_effect,
    })),
    sleepBlockCount: sleepBlocks.length,
  })
}
