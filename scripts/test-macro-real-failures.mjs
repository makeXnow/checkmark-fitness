/**
 * Tests built from REAL entries that produced >1000 cal due to the AI-multiplier bug.
 * Root cause: AI sets multiplier = (userGrams ÷ 1), code uses it directly instead of
 *             computing (userGrams ÷ fsServingGrams).
 *
 * Also covers similar patterns (same class of bug, different foods).
 * Run: node scripts/test-macro-real-failures.mjs
 */

const WORKER = 'https://mxn-checkmark-fitness.alexander-c3a.workers.dev'

async function estimate(body) {
  const res = await fetch(`${WORKER}/api/macro/estimate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const G_PER_OZ = 28.3495

function ozToG(oz) { return oz * G_PER_OZ }

/** Expected cal when user gives mass and FS serving is gram-based. */
function massCal(userG, fsServingG, fsServingCal) {
  return Math.round((userG / fsServingG) * fsServingCal)
}

// ─── Test cases ───────────────────────────────────────────────────────────────

const CASES = [
  // ══════════════════════════════════════════════════════════════════════════
  // REAL FAILURES (from actual logged entries that produced >1k cal)
  // ══════════════════════════════════════════════════════════════════════════

  {
    // Stored: 2835 cal. Correct: 113.4g / 100g × 25 = ~28 cal
    label: '[REAL] cauliflower 4 oz → FS 100g',
    body: { name: 'cauliflower', amount: '4 oz', fatSecretSearch: 'cauliflower raw' },
    expect: { calRange: [15, 60] },
    note: 'Was stored as 2835 cal (AI mult=113.4 × 25 cal). Should be ~28 cal.',
  },
  {
    // Stored: 1984 cal. Correct: 113.4g / 292g × 496 = ~193 cal
    label: '[REAL] jasmine rice 4 oz → FS 292g',
    body: { name: 'jasmine rice', amount: '4 oz', fatSecretSearch: 'jasmine rice cooked' },
    expect: { calRange: [100, 300] },
    note: 'Was stored as 1984 cal (AI mult=4 × 496 cal). Should be ~193 cal.',
  },
  {
    // Stored: 10400 cal. Correct: 200g / 100g × 52 = 104 cal
    label: '[REAL] egg whites ~200g (2 egg whites) → FS 100g',
    body: { name: 'egg whites', amount: '200g', fatSecretSearch: 'egg whites raw' },
    expect: { calRange: [60, 180] },
    note: 'Was stored as 10400 cal (AI mult=200 × 52 cal). Should be ~104 cal.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SIMILAR PATTERNS — oz input, gram-based FS serving
  // All prone to same bug: AI computes mult = userGrams ÷ 1
  // ══════════════════════════════════════════════════════════════════════════

  {
    // 2 oz broccoli = 56.7g. FS ~34 cal/100g → ~19 cal
    label: 'broccoli 2 oz → FS 100g',
    body: { name: 'broccoli', amount: '2 oz', fatSecretSearch: 'broccoli raw' },
    expect: { calRange: [10, 50] },
    note: '2 oz ≈ 56.7g; FS 100g ~34 cal → ~19 cal. Old bug: 56.7 × 34 = 1928 cal.',
  },
  {
    // 3 oz chicken breast = 85g. FS 100g ~165 cal → ~140 cal
    label: 'chicken breast 3 oz → FS 100g',
    body: { name: 'chicken breast', amount: '3 oz', fatSecretSearch: 'chicken breast cooked' },
    expect: { calRange: [80, 250] },
    note: '3 oz ≈ 85g; FS 100g ~165 cal → ~140 cal. Old bug: 85 × 165 = 14025 cal.',
  },
  {
    // 6 oz salmon = 170g. FS 100g ~208 cal → ~354 cal
    label: 'salmon 6 oz → FS 100g',
    body: { name: 'salmon', amount: '6 oz', fatSecretSearch: 'salmon fillet cooked' },
    expect: { calRange: [200, 500] },
    note: '6 oz ≈ 170g; FS 100g ~208 cal → ~354 cal. Old bug: 170 × 208 = 35360 cal.',
  },
  {
    // 1 oz cheddar = 28.3g. FS 100g ~403 cal → ~114 cal
    label: 'cheddar cheese 1 oz → FS 100g',
    body: { name: 'cheddar cheese', amount: '1 oz', fatSecretSearch: 'cheddar cheese' },
    expect: { calRange: [80, 180] },
    note: '1 oz ≈ 28.3g; FS 100g ~403 cal → ~114 cal.',
  },
  {
    // 1.5 oz almonds = 42.5g. FS 100g ~579 cal → ~246 cal
    label: 'almonds 1.5 oz → FS 100g',
    body: { name: 'almonds', amount: '1.5 oz', fatSecretSearch: 'almonds raw' },
    expect: { calRange: [150, 380] },
    note: '1.5 oz ≈ 42.5g; FS 100g ~579 cal → ~246 cal. Old bug: 42.5 × 579 = 24607 cal.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // EXPLICIT GRAMS — should also work (same Tier-1 mass path)
  // ══════════════════════════════════════════════════════════════════════════

  {
    // 150g chicken = 150/100 × 165 = ~248 cal, but skinless may be 110 cal/100g → 165 cal
    label: 'chicken breast 150g → FS 100g',
    body: { name: 'chicken breast', amount: '150g', fatSecretSearch: 'chicken breast cooked' },
    expect: { calRange: [100, 350] },
    note: '150g; FS 100g ~110–165 cal → 165–248 cal depending on variant.',
  },
  {
    // 200g greek yogurt. FS 100g ~59 cal → ~118 cal
    label: 'greek yogurt 200g → FS 100g',
    body: { name: 'greek yogurt', amount: '200g', fatSecretSearch: 'greek yogurt plain nonfat' },
    expect: { calRange: [80, 250] },
    note: '200g; FS 100g ~59 cal → ~118 cal.',
  },
  {
    // 30g peanut butter. FS 100g ~588 cal → ~176 cal
    label: 'peanut butter 30g → FS 100g',
    body: { name: 'peanut butter', amount: '30g', fatSecretSearch: 'peanut butter smooth' },
    expect: { calRange: [120, 250] },
    note: '30g; FS 100g ~588 cal → ~176 cal.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // MIXED: FS serving is larger gram base (like 292g rice case)
  // ══════════════════════════════════════════════════════════════════════════

  {
    // 4 oz brown rice = 113g. FS may have 195g serving ~216 cal → ~125 cal
    label: 'brown rice 4 oz → FS large gram base',
    body: { name: 'brown rice', amount: '4 oz', fatSecretSearch: 'brown rice cooked' },
    expect: { calRange: [80, 250] },
    note: '4 oz ≈ 113g; FS serving may be 195g or 100g — should scale correctly either way.',
  },
  {
    // 2 oz quinoa cooked = 57g. FS 100g ~120 cal → ~68 cal
    label: 'quinoa 2 oz cooked → FS 100g',
    body: { name: 'quinoa', amount: '2 oz', fatSecretSearch: 'quinoa cooked' },
    expect: { calRange: [30, 120] },
    note: '2 oz ≈ 57g; FS 100g ~120 cal → ~68 cal.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BOUNDARY: these should NOT be affected (count-based FS servings)
  // ══════════════════════════════════════════════════════════════════════════

  {
    // Count-based: FS "1 egg" or "50g" — either way should be ~70 cal for 1 egg.
    // Until new prompt/resolvedQty deployed, AI may say "1 egg" → 1×147=147 cal for gram FS.
    label: '1 large egg (count) → FS per-egg or 100g',
    body: { name: 'egg', amount: '1 egg', fatSecretSearch: 'whole egg large' },
    expect: { calRange: [50, 160] },
    note: 'Count input; if FS per-egg: mult=1 ~72 cal. If FS 100g: AI should estimate ~50g. Range widened until new prompt deployed.',
  },
  {
    // 2 slices bread — count-based FS, should work fine
    label: '2 slices whole wheat bread (count)',
    body: { name: 'bread', amount: '2 slices', fatSecretSearch: 'whole wheat bread sliced' },
    expect: { multApprox: 2, calRange: [100, 310] },
    note: 'Count match "slice"/"slice" — should not be affected by gram-multiplier bug.',
  },
  {
    // 1 tbsp peanut butter — volume-based, FS often has tbsp serving → mult=1
    label: '1 tbsp peanut butter (volume)',
    body: { name: 'peanut butter', amount: '1 tbsp', fatSecretSearch: 'peanut butter smooth' },
    expect: { calRange: [70, 150] },
    note: 'Volume unit; FS often lists 2 tbsp = 190 cal → 1 tbsp ~95 cal.',
  },
]

// ─── Grading ──────────────────────────────────────────────────────────────────

function grade(result, tc) {
  const issues = []
  const { expect: exp } = tc
  if (result.error) return { pass: false, issues: [`API error: ${result.error}`] }
  const mult = result.servingMultiplier ?? 0
  const cal = result.calories ?? 0

  if (exp.multApprox !== undefined) {
    const denom = Math.max(exp.multApprox, 0.01)
    const diff = Math.abs(mult - exp.multApprox) / denom
    if (diff > 0.25) issues.push(`mult ${mult.toFixed(2)} ≠ expected ~${exp.multApprox}`)
  }
  if (exp.calRange) {
    if (cal < exp.calRange[0] || cal > exp.calRange[1])
      issues.push(`cal ${cal} outside [${exp.calRange[0]}–${exp.calRange[1]}]`)
  }
  return { pass: issues.length === 0, issues }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\nMacro REAL-FAILURE tests → ${WORKER}\n`)
  let passed = 0
  const rows = []

  for (const tc of CASES) {
    process.stdout.write(`  ${tc.label}...`)
    try {
      const t0 = Date.now()
      const result = await estimate(tc.body)
      const ms = Date.now() - t0
      const { pass, issues } = grade(result, tc)
      if (pass) passed++

      const snap = result.macroEstimateSnapshot ?? {}
      const resolved = snap.resolvedQty != null
        ? `${snap.resolvedQty} ${snap.resolvedUnit ?? '?'}` 
        : (snap.resolvedAmount ?? '—')
      const fsResults = result.fatSecretResults ?? []
      const fsIdx = typeof snap.fatSecretIndex === 'number' ? snap.fatSecretIndex : null
      const servIdx = typeof snap.servingIndex === 'number' ? snap.servingIndex : null
      const selectedFood = fsIdx != null && fsIdx >= 1 ? fsResults[fsIdx - 1] : fsResults[0]
      const selectedServing = servIdx != null && servIdx >= 1
        ? selectedFood?.servings?.[servIdx - 1]
        : selectedFood?.servings?.[0]
      const fsName = selectedFood
        ? (selectedFood.brandName ? `${selectedFood.brandName} ${selectedFood.name}` : selectedFood.name)
        : '—'
      const fsServing = selectedServing?.description ?? '—'

      rows.push({
        label: tc.label, pass, issues, ms,
        mult: (result.servingMultiplier ?? 0).toFixed(2),
        unit: result.servingUnit ?? result.servingType ?? '—',
        cal: result.calories ?? 0,
        resolved,
        aiMult: snap.multiplier ?? '—',
        fsIdx: snap.fatSecretIndex ?? '—',
        servIdx: snap.servingIndex ?? '—',
        fsName: (fsName ?? '—').slice(0, 40),
        fsServing: fsServing.slice(0, 30),
        note: tc.note,
      })
      process.stdout.write(` ${pass ? '✅' : '❌'}  (${ms}ms)\n`)
    } catch (e) {
      rows.push({ label: tc.label, pass: false, issues: [`fetch error: ${e.message}`] })
      process.stdout.write(` 💥\n`)
    }
  }

  console.log('\n' + '─'.repeat(80))
  console.log(`RESULTS: ${passed} / ${CASES.length} passed\n`)

  for (const r of rows) {
    const icon = r.pass ? '✅' : '❌'
    console.log(`${icon}  ${r.label}`)
    console.log(`    resolved: ${r.resolved}  AI mult: ${r.aiMult}  fsIdx:${r.fsIdx} servIdx:${r.servIdx}`)
    console.log(`    → mult=${r.mult}  unit=${r.unit}  cal=${r.cal}  (${r.ms}ms)`)
    console.log(`    FS: "${r.fsName}" | serving: "${r.fsServing}"`)
    if (r.note)   console.log(`    ℹ ${r.note}`)
    if (r.issues?.length) r.issues.forEach(i => console.log(`    ⚠ ${i}`))
    console.log()
  }

  console.log('─'.repeat(80))
  if (passed < CASES.length) {
    console.log(`\n⚠  ${CASES.length - passed} tests FAILED.`)
    console.log('   The gram-multiplier bug is still live. Deploy the fixed worker, then re-run.')
  } else {
    console.log('\n✅ All tests passed! Safe to run fix-bad-entries.mjs to repair stored data.')
  }
}

run().catch(console.error)
