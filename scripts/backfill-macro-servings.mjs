/**
 * One-time / maintenance backfill for seed-data/macro.json serving fields.
 * Run: node scripts/backfill-macro-servings.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { backfillMacroLogs } from './lib/backfillMacroServings.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const macroPath = join(root, 'seed-data/macro.json')

const macro = JSON.parse(readFileSync(macroPath, 'utf8'))
macro.logs = backfillMacroLogs(macro.logs, macro.customFoods || [])
writeFileSync(macroPath, `${JSON.stringify(macro, null, 2)}\n`)
console.log('Backfilled serving fields in seed-data/macro.json')
