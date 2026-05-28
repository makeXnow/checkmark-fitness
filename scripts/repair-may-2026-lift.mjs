/**
 * One-off repair: align May 2026 lift history with user's paper backup.
 * Run: node scripts/repair-may-2026-lift.mjs [--dry-run]
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const dryRun = process.argv.includes('--dry-run')

function localDateISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dateAtLocalNoonISO(localDate) {
  const [y, m, d] = localDate.split('-').map((x) => parseInt(x, 10))
  return new Date(y, m - 1, d, 12, 0, 0, 0).toISOString()
}

/** @type {Record<string, [string, number][]>} */
const BACKUP = {
  'Bench Press': [
    ['2026-05-02', 155],
    ['2026-05-10', 160],
    ['2026-05-20', 165],
  ],
  'Incline Bench': [
    ['2026-05-02', 125],
    ['2026-05-10', 120],
    ['2026-05-20', 125],
  ],
  'Military Press': [
    ['2026-05-03', 100],
    ['2026-05-11', 105],
    ['2026-05-21', 110],
  ],
  Deadlift: [
    ['2026-05-04', 195],
    ['2026-05-12', 205],
    ['2026-05-25', 215],
  ],
  Rows: [
    ['2026-05-04', 135],
    ['2026-05-12', 140],
    ['2026-05-25', 145],
  ],
  'Bicep Curls & Scull Crushers': [
    ['2026-05-05', 35],
    ['2026-05-13', 35],
    ['2026-05-26', 40],
  ],
  Squat: [
    ['2026-05-01', 195],
    ['2026-05-07', 205],
    ['2026-05-14', 215],
    ['2026-05-27', 225],
  ],
  'Romanian Deadlift': [
    ['2026-05-01', 215],
    ['2026-05-07', 205],
    ['2026-05-14', 215],
    ['2026-05-27', 225],
  ],
}

function nextWeightFor(exerciseName, date, weight) {
  const rows = BACKUP[exerciseName]
  if (!rows) return weight
  const i = rows.findIndex(([d]) => d === date)
  if (i >= 0 && i < rows.length - 1) return rows[i + 1][1]
  const inc =
    exerciseName === 'Rows' || exerciseName === 'Bicep Curls & Scull Crushers'
      ? 2
      : exerciseName === 'Deadlift' || exerciseName === 'Squat' || exerciseName === 'Romanian Deadlift'
        ? 10
        : 5
  return weight + inc
}

function fetchPayload() {
  const out = execSync(
    'npx wrangler d1 execute checkmark-fitness --remote --command "SELECT payload_json FROM lift_bundle WHERE device_id = \'alexander\'" --json',
    { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
  )
  const j = JSON.parse(out)
  return JSON.parse(j[0].results[0].payload_json)
}

function repair(payload) {
  const nameToWorkout = Object.fromEntries(payload.workouts.map((w) => [w.name, w]))
  for (const exerciseName of Object.keys(BACKUP)) {
    if (!nameToWorkout[exerciseName]) throw new Error(`Missing workout: ${exerciseName}`)
  }

  // Remove all May 2026 entries for exercises we're rebuilding from backup
  let history = (payload.history || []).filter((entry) => {
    const w = payload.workouts.find((x) => x.id === entry.workoutId)
    if (!w || !BACKUP[w.name]) return true
    const local = localDateISO(new Date(entry.date))
    if (local.startsWith('2026-05')) return false
    return true
  })

  // Remove Apr 30 squat/rdl (will re-add as May 1)
  history = history.filter((entry) => {
    const w = payload.workouts.find((x) => x.id === entry.workoutId)
    if (!w || (w.name !== 'Squat' && w.name !== 'Romanian Deadlift')) return true
    return localDateISO(new Date(entry.date)) !== '2026-04-30'
  })

  // Preserve status from existing entries before rebuild
  /** @type {Map<string, string|undefined>} */
  const statusByKey = new Map()
  for (const entry of payload.history || []) {
    const w = payload.workouts.find((x) => x.id === entry.workoutId)
    if (!w) continue
    const local = localDateISO(new Date(entry.date))
    statusByKey.set(`${entry.workoutId}|${local}`, entry.statusName)
  }

  for (const [exerciseName, rows] of Object.entries(BACKUP)) {
    const workout = nameToWorkout[exerciseName]
    for (const [date, weight] of rows) {
      const key = `${workout.id}|${date}`
      const status = statusByKey.get(key)
      const newWeight = nextWeightFor(exerciseName, date, weight)
      history.push({
        id: crypto.randomUUID(),
        workoutId: workout.id,
        workoutName: workout.name,
        date: dateAtLocalNoonISO(date),
        weight,
        oldWeight: weight,
        newWeight,
        ...(status !== undefined && status !== '' ? { statusName: status } : {}),
      })
    }
  }

  // Update plan main weights to post-May targets (after last log + increment)
  const mainAfterMay = {
    'Bench Press': 170,
    'Incline Bench': 130,
    'Military Press': 115,
    Deadlift: 225,
    Rows: 147,
    'Bicep Curls & Scull Crushers': 42,
    Squat: 225,
    'Romanian Deadlift': 225,
  }

  const workouts = payload.workouts.map((w) => ({
    ...w,
    mainWeight: mainAfterMay[w.name] ?? w.mainWeight,
  }))

  history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return { ...payload, history, workouts }
}

function verify(payload) {
  const issues = []
  const workoutNames = Object.fromEntries(payload.workouts.map((w) => [w.id, w.name]))

  for (const [exerciseName, rows] of Object.entries(BACKUP)) {
    for (const [date, weight] of rows) {
      const w = payload.workouts.find((x) => x.name === exerciseName)
      const hits = (payload.history || []).filter(
        (e) => e.workoutId === w.id && localDateISO(new Date(e.date)) === date,
      )
      if (hits.length !== 1) {
        issues.push(`${date} ${exerciseName}: expected 1 entry, got ${hits.length}`)
        continue
      }
      if (hits[0].weight !== weight) {
        issues.push(`${date} ${exerciseName}: expected ${weight}, got ${hits[0].weight}`)
      }
    }
  }

  const mayExtra = (payload.history || []).filter((e) => {
    const local = localDateISO(new Date(e.date))
    if (!local.startsWith('2026-05')) return false
    const name = workoutNames[e.workoutId]
    return !BACKUP[name]
  })
  if (mayExtra.length) issues.push(`Extra May entries: ${mayExtra.map((e) => workoutNames[e.workoutId]).join(', ')}`)

  return issues
}

const before = fetchPayload()
const after = repair(JSON.parse(JSON.stringify(before)))
const issues = verify(after)

console.log('Verification:', issues.length === 0 ? 'PASS' : 'FAIL')
for (const i of issues) console.log(' ', i)

if (dryRun) {
  console.log('\n--dry-run: no database write')
  process.exit(issues.length === 0 ? 0 : 1)
}

if (issues.length > 0) {
  console.error('Refusing to write: verification failed')
  process.exit(1)
}

const json = JSON.stringify(after).replace(/'/g, "''")
const sql = `UPDATE lift_bundle SET payload_json = '${json}', updated_at = ${Date.now()} WHERE device_id = 'alexander';`
const sqlPath = join(root, 'scripts', '.repair-may-lift.sql')
writeFileSync(sqlPath, sql)

execSync(`npx wrangler d1 execute checkmark-fitness --remote --file="${sqlPath}"`, {
  cwd: root,
  stdio: 'inherit',
})

console.log('Database updated successfully.')
