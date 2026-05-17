#!/usr/bin/env node
/**
 * Migrate a legacy LiftCalc JSON export into Checkmark Fitness lift_bundle format.
 *
 * Usage:
 *   node scripts/migrate-liftcalc.mjs "/path/to/liftcalc_backup.json" [--out seed-data/lift.json]
 *
 * Merges with existing seed-data/lift.json when present: backup wins for plan/statuses;
 * history is unioned by id (backup entries override on conflict).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const defaultOut = join(root, 'seed-data', 'lift.json')
const defaultMerge = defaultOut

const DEFAULT_STATUSES = [
  { id: 's1', name: 'Success', multiplier: 1 },
  { id: 's2', name: 'Fail', multiplier: 0 },
  { id: 's3', name: 'Big Fail', multiplier: -1 },
  { id: 's1777853428489', name: 'Too Easy', multiplier: 2 },
  { id: 's_d26d967c-16ec-4b1c-9d53-9cf9a0a2b9ad', name: 'Too Hard', multiplier: '0' },
]

const rawArgs = process.argv.slice(2)
const outIdx = rawArgs.indexOf('--out')
const mergeIdx = rawArgs.indexOf('--merge')
const outPath = outIdx !== -1 ? rawArgs[outIdx + 1] : defaultOut
const mergePath = mergeIdx !== -1 ? rawArgs[mergeIdx + 1] : defaultMerge
const skip = new Set()
if (outIdx >= 0) {
  skip.add(outIdx)
  skip.add(outIdx + 1)
}
if (mergeIdx >= 0) {
  skip.add(mergeIdx)
  skip.add(mergeIdx + 1)
}
const legacyPath = rawArgs.filter((_, i) => !skip.has(i))[0]

if (!legacyPath || legacyPath.startsWith('--')) {
  console.error(
    'Usage: node scripts/migrate-liftcalc.mjs <legacy.json> [--out path] [--merge path]',
  )
  process.exit(1)
}

function parseDateMs(date) {
  if (!date) return 0
  const t = Date.parse(date)
  return Number.isFinite(t) ? t : 0
}

function mergeNotes(workouts, donorWorkouts, { overwrite = true } = {}) {
  const noteById = {}
  for (const w of donorWorkouts || []) {
    const n = w.notes
    if (n != null && String(n).trim() !== '') noteById[w.id] = String(n)
  }
  for (const w of workouts) {
    if (noteById[w.id] == null) continue
    if (overwrite || w.notes == null || String(w.notes).trim() === '') {
      w.notes = noteById[w.id]
    }
  }
}

function mergeHistory(primary, secondary) {
  const byId = new Map()
  for (const entry of secondary || []) {
    if (entry?.id) byId.set(entry.id, entry)
  }
  for (const entry of primary || []) {
    if (entry?.id) byId.set(entry.id, entry)
  }
  return [...byId.values()].sort((x, y) => parseDateMs(y.date) - parseDateMs(x.date))
}

function migrateLegacy(legacy, existing) {
  const workouts = legacy.workouts?.length ? legacy.workouts : existing?.workouts || []
  const statuses = legacy.statuses?.length
    ? legacy.statuses
    : existing?.statuses?.length
      ? existing.statuses
      : DEFAULT_STATUSES

  mergeNotes(workouts, legacy.workouts, { overwrite: true })
  if (existing?.workouts) mergeNotes(workouts, existing.workouts, { overwrite: false })

  const payload = {
    days: legacy.days?.length ? legacy.days : existing?.days || [],
    workouts,
    history: mergeHistory(legacy.history, existing?.history),
    availablePlates:
      legacy.availablePlates?.length ? legacy.availablePlates : existing?.availablePlates || [],
    statuses,
    weightUnit: existing?.weightUnit || legacy.weightUnit || 'lbs',
    plateUnit: existing?.plateUnit || legacy.plateUnit || 'lbs',
  }

  return payload
}

const legacy = JSON.parse(readFileSync(legacyPath, 'utf8'))
const existing = existsSync(mergePath) ? JSON.parse(readFileSync(mergePath, 'utf8')) : null
const migrated = migrateLegacy(legacy, existing)

const json = `${JSON.stringify(migrated, null, 2)}\n`
writeFileSync(outPath, json, 'utf8')

const legacyHist = legacy.history?.length ?? 0
const mergedHist = migrated.history?.length ?? 0
const workoutSource = legacy.workouts?.length ? 'backup' : 'existing seed'
console.error(`Wrote ${outPath}`)
console.error(`  workouts: ${migrated.workouts.length} (${workoutSource})`)
console.error(`  history: ${mergedHist} entries (${legacyHist} from backup + app session logs)`)
console.error(`  statuses: ${migrated.statuses.length}`)
