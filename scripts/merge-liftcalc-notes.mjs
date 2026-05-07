#!/usr/bin/env node
/**
 * Merge non-empty workout `notes` from a donor LiftCalc-style export into a base export,
 * keyed by workout `id`. Writes JSON to stdout or --out path.
 *
 * Usage:
 *   node scripts/merge-liftcalc-notes.mjs \
 *     "/path/to/base.json" \
 *     "/path/to/donor_with_notes.json" \
 *     --out "/path/to/merged.json"
 */

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const outIdx = args.indexOf('--out')
const outPath = outIdx !== -1 ? args[outIdx + 1] : null
const posArgs = outIdx !== -1 ? args.filter((_, i) => i !== outIdx && i !== outIdx + 1) : args

const [basePath, donorPath] = posArgs
if (!basePath || !donorPath) {
  console.error(
    'Usage: node scripts/merge-liftcalc-notes.mjs <base.json> <donor.json> [--out merged.json]',
  )
  process.exit(1)
}

const base = JSON.parse(fs.readFileSync(basePath, 'utf8'))
const donor = JSON.parse(fs.readFileSync(donorPath, 'utf8'))

const noteById = {}
for (const w of donor.workouts || []) {
  const n = w.notes
  if (n != null && String(n).trim() !== '') noteById[w.id] = String(n)
}

let applied = 0
for (const w of base.workouts || []) {
  if (noteById[w.id] != null) {
    w.notes = noteById[w.id]
    applied++
  }
}

const json = `${JSON.stringify(base, null, 2)}\n`
if (outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, json, 'utf8')
  console.error(`Merged notes for ${applied} workout(s) (donor had ${Object.keys(noteById).length} id(s) with notes).`)
  console.error(`Wrote ${outPath}`)
} else {
  process.stdout.write(json)
}
