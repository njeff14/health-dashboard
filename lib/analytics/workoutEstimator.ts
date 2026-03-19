/**
 * Estimates Garmin-style workout metrics from basic Oura workout data.
 * Only used when aerobic/anaerobic training effect are unavailable (i.e. Oura-only workouts).
 *
 * Method:
 *  - HR Reserve (Karvonen): (avgHr - restingHr) / (maxHr - restingHr)
 *  - Zone + duration → aerobic TE (1–5 scale)
 *  - Zone + intensity field → anaerobic TE (1–5 scale)
 *  - Zone + intensity + duration → training effect label
 */

export interface WorkoutMetricEstimate {
  aerobic_training_effect: number
  anaerobic_training_effect: number
  training_effect_label: string
}

export function estimateWorkoutMetrics({
  avgHr,
  maxHr,
  restingHr,
  durationMin,
  intensity,
}: {
  avgHr: number
  maxHr: number
  restingHr: number
  durationMin: number
  intensity?: string | null
}): WorkoutMetricEstimate {
  // Karvonen HR reserve — clamp to [0, 1]
  const hrr = Math.max(0, Math.min(1, (avgHr - restingHr) / Math.max(1, maxHr - restingHr)))

  // Duration factor: 1.0 at 60 min, scales linearly, capped at 1.5
  const durationFactor = Math.min(1.5, durationMin / 60)

  // ── Aerobic TE ────────────────────────────────────────────────────────
  // Base value by HR zone (approximate EPOC loading)
  let baseAerobic: number
  if      (hrr < 0.50) baseAerobic = 1.5  // Z1: recovery
  else if (hrr < 0.65) baseAerobic = 2.5  // Z2: aerobic base
  else if (hrr < 0.78) baseAerobic = 3.2  // Z3: tempo
  else if (hrr < 0.90) baseAerobic = 3.8  // Z4: lactate threshold
  else                 baseAerobic = 4.5  // Z5: VO2max

  const aerobic = Math.min(5, Math.max(0.5, baseAerobic * durationFactor))

  // ── Anaerobic TE ──────────────────────────────────────────────────────
  // Driven by high-intensity surges above lactate threshold
  const isHard = intensity === 'hard'
  const isMod  = intensity === 'moderate'

  let anaerobic: number
  if      (hrr < 0.65)               anaerobic = 0.3
  else if (hrr < 0.78) anaerobic = isHard ? 1.5 : isMod ? 0.8  : 0.5
  else if (hrr < 0.90) anaerobic = isHard ? 2.5 : isMod ? 1.5  : 1.0
  else                 anaerobic = isHard ? 3.5 : 2.0

  // ── Training Effect Label ─────────────────────────────────────────────
  let training_effect_label: string
  if (durationMin < 10 || hrr < 0.40) {
    training_effect_label = 'RECOVERY'
  } else if (hrr < 0.50) {
    training_effect_label = 'AEROBIC_BASE'
  } else if (hrr < 0.65) {
    training_effect_label = durationMin >= 45 ? 'AEROBIC_BASE' : 'TEMPO'
  } else if (hrr < 0.78) {
    training_effect_label = 'TEMPO'
  } else if (hrr < 0.88) {
    training_effect_label = 'LACTATE_THRESHOLD'
  } else if (isHard && durationMin < 40) {
    training_effect_label = 'SPEED'
  } else {
    training_effect_label = 'VO2MAX'
  }

  return {
    aerobic_training_effect:  Math.round(aerobic  * 10) / 10,
    anaerobic_training_effect: Math.round(anaerobic * 10) / 10,
    training_effect_label,
  }
}
