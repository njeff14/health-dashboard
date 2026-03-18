export type MetricSource = 'daily' | 'sleep_stage' | 'workout' | 'computed' | 'tag'

export interface MetricDefinition {
  id: string
  label: string
  source: MetricSource
  group: string        // for grouped dropdown display
  unit?: string
  invertGood?: boolean
  fixedDomain?: [number, number]
}

/** Static metrics available for correlation analysis */
export const STATIC_METRICS: MetricDefinition[] = [
  // Daily health (from Oura)
  { id: 'sleep_score',      label: 'Sleep Score',         source: 'daily',       group: 'Daily Health',  unit: 'pts',  fixedDomain: [40, 100] },
  { id: 'readiness_score',  label: 'Readiness Score',     source: 'daily',       group: 'Daily Health',  unit: 'pts',  fixedDomain: [40, 100] },
  { id: 'hrv',              label: 'HRV',                 source: 'daily',       group: 'Daily Health',  unit: 'ms' },
  { id: 'resting_hr',       label: 'Resting HR',          source: 'daily',       group: 'Daily Health',  unit: 'bpm',  invertGood: true },
  { id: 'activity_score',   label: 'Activity Score',      source: 'daily',       group: 'Daily Health',  unit: 'pts',  fixedDomain: [0, 100] },
  { id: 'body_battery',     label: 'Body Battery',        source: 'computed',    group: 'Daily Health',  unit: 'pts',  fixedDomain: [0, 100] },

  // Sleep stages (from oura_sleep long_sleep)
  { id: 'deep_sleep_min',   label: 'Deep Sleep (min)',    source: 'sleep_stage', group: 'Sleep Stages',  unit: 'min' },
  { id: 'deep_sleep_pct',   label: 'Deep Sleep %',        source: 'sleep_stage', group: 'Sleep Stages',  unit: '%',    fixedDomain: [0, 40] },
  { id: 'rem_sleep_min',    label: 'REM Sleep (min)',      source: 'sleep_stage', group: 'Sleep Stages',  unit: 'min' },
  { id: 'rem_sleep_pct',    label: 'REM Sleep %',          source: 'sleep_stage', group: 'Sleep Stages',  unit: '%',    fixedDomain: [0, 40] },
  { id: 'light_sleep_min',  label: 'Light Sleep (min)',    source: 'sleep_stage', group: 'Sleep Stages',  unit: 'min' },
  { id: 'light_sleep_pct',  label: 'Light Sleep %',        source: 'sleep_stage', group: 'Sleep Stages',  unit: '%',    fixedDomain: [0, 80] },
  { id: 'efficiency',       label: 'Sleep Efficiency',     source: 'sleep_stage', group: 'Sleep Stages',  unit: '%',    fixedDomain: [50, 100] },
  { id: 'total_sleep_min',  label: 'Total Sleep (min)',    source: 'sleep_stage', group: 'Sleep Stages',  unit: 'min' },

  // Workout (from garmin_activities)
  { id: 'average_hr',               label: 'Avg Workout HR',       source: 'workout', group: 'Workout',  unit: 'bpm' },
  { id: 'aerobic_training_effect',   label: 'Aerobic Effect',       source: 'workout', group: 'Workout',  unit: '',     fixedDomain: [0, 5] },
  { id: 'anaerobic_training_effect', label: 'Anaerobic Effect',     source: 'workout', group: 'Workout',  unit: '',     fixedDomain: [0, 5] },
  { id: 'calories',                  label: 'Calories',             source: 'workout', group: 'Workout',  unit: 'kcal' },
  { id: 'duration_min',             label: 'Duration (min)',        source: 'workout', group: 'Workout',  unit: 'min' },
  { id: 'vo2max',                   label: 'VO2max (running)',      source: 'workout', group: 'Workout',  unit: '' },
  { id: 'estimated_vo2max',         label: 'Est. VO2max (all)',     source: 'workout', group: 'Workout',  unit: '' },
]

/** Check if a metric ID refers to a tag (format: "tag:tag_text") */
export function isTagMetric(id: string): boolean {
  return id.startsWith('tag:')
}

/** Extract the tag text from a tag metric ID */
export function getTagText(id: string): string {
  return id.replace(/^tag:/, '')
}

/** Build a MetricDefinition for a tag */
export function tagMetric(tagText: string, count: number): MetricDefinition {
  const label = tagText.startsWith('workout_')
    ? tagText.replace('workout_', '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : tagText.replace(/^tag_[a-z]+_/, '').replace(/_/g, ' ')
  return {
    id: `tag:${tagText}`,
    label: `${label} (${count})`,
    source: 'tag',
    group: 'Tags',
    unit: '0/1',
  }
}

/** Determine if a metric needs workout data (join to garmin_activities) */
export function needsWorkoutJoin(id: string): boolean {
  const def = STATIC_METRICS.find(m => m.id === id)
  return def?.source === 'workout'
}
