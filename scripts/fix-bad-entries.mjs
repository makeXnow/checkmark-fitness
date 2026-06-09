#!/usr/bin/env node
/**
 * Repairs macro log entries that were corrupted by the AI-multiplier bug.
 * The bug: AI set multiplier = userGrams (e.g. 200 for "200g") instead of 1,
 * and old code used that directly → massively inflated calories.
 *
 * Safe to re-run: only patches entries whose calories match the known-bad value.
 *
 * Run AFTER deploying the fixed worker:
 *   npx wrangler d1 execute checkmark-fitness --remote --file=scripts/fix-bad-entries.sql
 *
 * Or run this script directly (requires wrangler auth):
 *   node scripts/fix-bad-entries.mjs
 */

// ─── Corrections ─────────────────────────────────────────────────────────────
// Each entry: correct values calculated as (userGrams / fsServingGrams) × fsServingMacro

const FIXES = [
  {
    id: '3ef7d75b-d8fa-4e96-8777-f423e0d65f2e',
    description: 'Cauliflower 4 oz (was 2835 cal — AI mult 113.4×25). Correct: 113.4g/100g×25=28 cal',
    // FS: Cauliflower 100g = 25 cal, 1.98g protein
    // User: 113.4g (4 oz). Ratio: 1.134
    correct: { calories: 28, protein: 2.2, fat: 0, carbs: 0, servingMultiplier: 1.13, baseCalories: 25, baseProtein: 1.98 },
    badCalories: 2835,
  },
  {
    id: 'f31225e6-fcd9-404c-8d0f-5c13d1e63b40',
    description: 'Riced cauliflower 2 oz (was 204 cal — AI mult 2×102). Correct: 56.7g/258g×102=22 cal',
    // FS: Cauliflower Rice 258g = 102 cal, 4.6g protein
    // User: 56.7g (2 oz). Ratio: 0.2198
    correct: { calories: 22, protein: 1.0, fat: 0, carbs: 0, servingMultiplier: 0.22, baseCalories: 102, baseProtein: 4.6 },
    badCalories: 204,
  },
  {
    id: 'd81bb2c1-cdc5-47a7-8a95-4d51ecd4897e',
    description: 'Jasmine rice 4 oz (was 1984 cal — AI mult 4×496). Correct: 113.4g/292g×496=193 cal',
    // FS: Jasmine Rice (Cooked) 292g = 496 cal, 11.13g protein
    // User: 113.4g (4 oz). Ratio: 0.3884
    correct: { calories: 193, protein: 4.3, fat: 0, carbs: 0, servingMultiplier: 0.39, baseCalories: 496, baseProtein: 11.13 },
    badCalories: 1984,
  },
  {
    id: '70854ad4-d1b4-4023-a9da-158e6b3849b9',
    description: 'Egg whites 200g (was 10400 cal — AI mult 200×52). Correct: 200g/100g×52=104 cal',
    // FS: Egg White 100g = 52 cal, 10.9g protein
    // User: 200g. Ratio: 2.0
    correct: { calories: 104, protein: 21.8, fat: 0, carbs: 0, servingMultiplier: 2, baseCalories: 52, baseProtein: 10.9 },
    badCalories: 10400,
  },
]

// ─── Wrangler D1 helper ───────────────────────────────────────────────────────

import { execSync } from 'child_process'

function d1Query(sql) {
  const result = execSync(
    `npx wrangler d1 execute checkmark-fitness --remote --json --command ${JSON.stringify(sql)}`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  )
  return JSON.parse(result)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\nFetching current macro_bundle...')
  const rows = d1Query('SELECT device_id, logs_json FROM macro_bundle ORDER BY updated_at DESC LIMIT 5')
  
  let bundle = null
  let deviceId = null

  for (const row of rows[0]?.results ?? []) {
    const logs = JSON.parse(row.logs_json)
    // Find any of our target IDs
    const found = FIXES.some(fix =>
      Object.values(logs).some(items =>
        items.some(item => item.id === fix.id)
      )
    )
    if (found) {
      bundle = logs
      deviceId = row.device_id
      break
    }
  }

  if (!bundle || !deviceId) {
    console.error('❌ Could not find any target entries in macro_bundle.')
    process.exit(1)
  }

  console.log(`Found bundle for device: ${deviceId}`)

  let patchCount = 0

  for (const fix of FIXES) {
    let patched = false
    for (const [date, items] of Object.entries(bundle)) {
      for (const item of items) {
        if (item.id !== fix.id) continue

        if (item.calories !== fix.badCalories) {
          console.log(`⚠  Skipping "${item.name}" on ${date}: cal=${item.calories} (expected bad=${fix.badCalories}) — already fixed or changed`)
          patched = true
          break
        }

        console.log(`\n✏  Patching: ${fix.description}`)
        console.log(`   Before: cal=${item.calories}  protein=${item.protein}  fat=${item.fat}  carbs=${item.carbs}`)

        item.calories = fix.correct.calories
        item.protein = fix.correct.protein
        item.fat = fix.correct.fat
        item.carbs = fix.correct.carbs
        item.servingMultiplier = fix.correct.servingMultiplier
        item.baseCalories = fix.correct.baseCalories
        item.baseProtein = fix.correct.baseProtein

        console.log(`   After:  cal=${item.calories}  protein=${item.protein}`)
        patchCount++
        patched = true
        break
      }
      if (patched) break
    }
    if (!patched) {
      console.log(`⚠  Entry ${fix.id} not found in bundle`)
    }
  }

  if (patchCount === 0) {
    console.log('\nNo patches needed (all entries already correct).')
    return
  }

  console.log(`\nWriting ${patchCount} patch(es) back to D1...`)

  const escapedJson = JSON.stringify(JSON.stringify(bundle)).slice(1, -1)
  const sql = `UPDATE macro_bundle SET logs_json = '${JSON.stringify(bundle).replace(/'/g, "''")}' WHERE device_id = '${deviceId}'`
  
  d1Query(sql)
  
  console.log('✅ Done! Re-run test-macro-real-failures.mjs to verify live behavior.')
  console.log('   Note: existing app sessions may need a refresh to see updated totals.')
}

run().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
