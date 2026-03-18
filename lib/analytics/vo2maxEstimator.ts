import { getDb } from '@/lib/db'

// ── Types ────────────────────────────────────────────────────────────────────

export interface VO2maxDataPoint {
  day: string
  actual_vo2max: number | null
  estimated_vo2max: number | null
  estimate_lower: number | null
  estimate_upper: number | null
  source: 'garmin' | 'estimated' | null
  hr_efficiency: number | null
  activity_type: string | null
}

export interface RegressionModel {
  coefficients: {
    intercept: number
    hr_pct_max: number
    aerobic_te: number
    resting_hr: number
  }
  r_squared: number
  standard_error: number
  n_training: number
}

export interface VO2maxResult {
  series: VO2maxDataPoint[]
  model: RegressionModel
}

// ── OLS Regression (small matrix, no library needed) ─────────────────────────

/**
 * Fit ordinary least squares regression: y = X·β
 * X should include an intercept column (column of 1s).
 * Returns coefficients, R², and standard error.
 */
function fitOLS(X: number[][], y: number[]): { beta: number[]; rSquared: number; se: number } {
  const n = X.length
  const p = X[0].length // number of parameters (including intercept)

  // X'X  (p×p)
  const XtX: number[][] = Array.from({ length: p }, () => new Array(p).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      for (let k = 0; k < p; k++) {
        XtX[j][k] += X[i][j] * X[i][k]
      }
    }
  }

  // X'y  (p×1)
  const Xty: number[] = new Array(p).fill(0)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      Xty[j] += X[i][j] * y[i]
    }
  }

  // Solve via Gaussian elimination with partial pivoting
  // Augment [XtX | Xty]
  const aug: number[][] = XtX.map((row, i) => [...row, Xty[i]])

  for (let col = 0; col < p; col++) {
    // Partial pivoting
    let maxRow = col
    for (let row = col + 1; row < p; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row
    }
    if (maxRow !== col) {
      const tmp = aug[col]; aug[col] = aug[maxRow]; aug[maxRow] = tmp
    }

    const pivot = aug[col][col]
    if (Math.abs(pivot) < 1e-12) {
      // Singular matrix — return defaults
      return { beta: new Array(p).fill(0), rSquared: 0, se: 999 }
    }

    // Eliminate below
    for (let row = col + 1; row < p; row++) {
      const factor = aug[row][col] / pivot
      for (let j = col; j <= p; j++) {
        aug[row][j] -= factor * aug[col][j]
      }
    }
  }

  // Back-substitution
  const beta: number[] = new Array(p).fill(0)
  for (let row = p - 1; row >= 0; row--) {
    let sum = aug[row][p]
    for (let j = row + 1; j < p; j++) {
      sum -= aug[row][j] * beta[j]
    }
    beta[row] = sum / aug[row][row]
  }

  // Compute R² and SE
  const yMean = y.reduce((a, b) => a + b, 0) / n
  let ssTot = 0
  let ssRes = 0
  for (let i = 0; i < n; i++) {
    const yPred = X[i].reduce((s, x, j) => s + x * beta[j], 0)
    ssRes += (y[i] - yPred) ** 2
    ssTot += (y[i] - yMean) ** 2
  }
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0
  const se = n > p ? Math.sqrt(ssRes / (n - p)) : 999

  return { beta, rSquared, se }
}

// ── Main computation ─────────────────────────────────────────────────────────

export function computeVO2maxEstimates(startDate: string, endDate: string): VO2maxResult {
  const db = getDb()

  // 1. HR settings (fallbacks)
  const settingsRows = db.prepare(
    `SELECT key, value FROM user_settings WHERE key IN ('hr_max', 'hr_resting')`
  ).all() as { key: string; value: string }[]
  const settings = Object.fromEntries(settingsRows.map(s => [s.key, Number(s.value)]))
  const hrMax = settings.hr_max ?? 190
  const hrRestingDefault = settings.hr_resting ?? 60

  // 2. ALL running activities with VO2max (training data — no date filter, use full history)
  const trainingRows = db.prepare(`
    SELECT start_day, average_hr, max_hr, duration_sec, distance_meters,
           aerobic_training_effect, vo2max
    FROM garmin_activities
    WHERE vo2max > 0 AND average_hr > 0 AND aerobic_training_effect > 0
    ORDER BY start_day
  `).all() as {
    start_day: string; average_hr: number; max_hr: number;
    duration_sec: number; distance_meters: number | null;
    aerobic_training_effect: number; vo2max: number
  }[]

  // 3. ALL activities in the date range (for predictions + display)
  const allActivities = db.prepare(`
    SELECT activity_id, start_day, activity_type, average_hr, max_hr,
           duration_sec, aerobic_training_effect, anaerobic_training_effect,
           vo2max
    FROM garmin_activities
    WHERE start_day BETWEEN ? AND ? AND average_hr > 0
    ORDER BY start_day
  `).all(startDate, endDate) as {
    activity_id: number; start_day: string; activity_type: string;
    average_hr: number; max_hr: number; duration_sec: number;
    aerobic_training_effect: number; anaerobic_training_effect: number;
    vo2max: number | null
  }[]

  // 4. Daily resting HR from Oura sleep
  const sleepRows = db.prepare(`
    SELECT day, lowest_heart_rate, average_hrv
    FROM oura_sleep
    WHERE sleep_type = 'long_sleep' AND day BETWEEN ? AND ?
  `).all(startDate, endDate) as { day: string; lowest_heart_rate: number | null; average_hrv: number | null }[]
  const rhrMap = new Map(sleepRows.map(s => [s.day, s.lowest_heart_rate ?? hrRestingDefault]))

  // Also load resting HR for training data days (may be outside date range)
  const trainingDays = Array.from(new Set(trainingRows.map(r => r.start_day)))
  const trainingRhrMap = new Map<string, number>()
  if (trainingDays.length > 0) {
    const placeholders = trainingDays.map(() => '?').join(',')
    const tSleep = db.prepare(`
      SELECT day, lowest_heart_rate
      FROM oura_sleep
      WHERE sleep_type = 'long_sleep' AND day IN (${placeholders})
    `).all(...trainingDays) as { day: string; lowest_heart_rate: number | null }[]
    tSleep.forEach(s => trainingRhrMap.set(s.day, s.lowest_heart_rate ?? hrRestingDefault))
  }

  // 5. Build feature matrix for training data
  const X: number[][] = []
  const y: number[] = []
  for (const r of trainingRows) {
    const rhr = trainingRhrMap.get(r.start_day) ?? hrRestingDefault
    X.push([
      1,                                    // intercept
      r.average_hr / hrMax,                 // hr_pct_max
      r.aerobic_training_effect,            // aerobic_te
      (rhr - 50) / 20,                      // resting_hr_norm
    ])
    y.push(r.vo2max)
  }

  // Fit regression model
  const emptyModel: RegressionModel = {
    coefficients: { intercept: 0, hr_pct_max: 0, aerobic_te: 0, resting_hr: 0 },
    r_squared: 0, standard_error: 999, n_training: 0,
  }

  if (X.length < 5) {
    // Not enough training data
    const series: VO2maxDataPoint[] = allActivities.map(a => ({
      day: a.start_day,
      actual_vo2max: a.vo2max ?? null,
      estimated_vo2max: null,
      estimate_lower: null,
      estimate_upper: null,
      source: a.vo2max ? 'garmin' as const : null,
      hr_efficiency: null,
      activity_type: a.activity_type,
    }))
    return { series, model: emptyModel }
  }

  const { beta, rSquared, se } = fitOLS(X, y)

  const model: RegressionModel = {
    coefficients: {
      intercept: beta[0],
      hr_pct_max: beta[1],
      aerobic_te: beta[2],
      resting_hr: beta[3],
    },
    r_squared: rSquared,
    standard_error: se,
    n_training: X.length,
  }

  // 6. Build output series — one entry per day (pick activity with highest aerobic TE)
  const dayMap = new Map<string, typeof allActivities[number]>()
  for (const a of allActivities) {
    const existing = dayMap.get(a.start_day)
    if (!existing || a.aerobic_training_effect > existing.aerobic_training_effect) {
      dayMap.set(a.start_day, a)
    }
  }

  const series: VO2maxDataPoint[] = []
  const ci = 1.96 * se

  for (const [day, a] of Array.from(dayMap.entries())) {
    const rhr = rhrMap.get(day) ?? hrRestingDefault

    // HR efficiency: (avg_hr - resting_hr) / aerobic_te (lower = fitter)
    const hrEff = a.aerobic_training_effect >= 1.0
      ? (a.average_hr - rhr) / a.aerobic_training_effect
      : null

    if (a.vo2max && a.vo2max > 0) {
      // Actual Garmin VO2max
      series.push({
        day,
        actual_vo2max: a.vo2max,
        estimated_vo2max: null,
        estimate_lower: null,
        estimate_upper: null,
        source: 'garmin',
        hr_efficiency: hrEff,
        activity_type: a.activity_type,
      })
    } else {
      // Estimate from regression
      const features = [
        1,
        a.average_hr / hrMax,
        a.aerobic_training_effect,
        (rhr - 50) / 20,
      ]
      const predicted = features.reduce((s, x, i) => s + x * beta[i], 0)
      const clamped = Math.max(35, Math.min(60, predicted))

      series.push({
        day,
        actual_vo2max: null,
        estimated_vo2max: Math.round(clamped * 10) / 10,
        estimate_lower: Math.round(Math.max(35, clamped - ci) * 10) / 10,
        estimate_upper: Math.round(Math.min(60, clamped + ci) * 10) / 10,
        source: 'estimated',
        hr_efficiency: hrEff,
        activity_type: a.activity_type,
      })
    }
  }

  // Sort by day ascending
  series.sort((a, b) => a.day.localeCompare(b.day))

  return { series, model }
}
