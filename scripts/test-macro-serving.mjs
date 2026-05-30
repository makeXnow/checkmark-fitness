/**
 * Integration tests for the serving-resolution system.
 * Calls the deployed Worker directly — no local server needed.
 * Run: node scripts/test-macro-serving.mjs
 *
 * Two-phase expectations:
 *   Phase A (old D1 prompt — no resolvedAmount): calorie range checks only for mass/volume
 *   Phase B (new D1 prompt — with resolvedAmount): mult + unit checks unlock for all cases
 *   "note" fields explain what Phase B will fix.
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

const CASES = [
  // ── Count mismatches ──────────────────────────────────────────────
  // Tier-3 fallback in resolveCountServingMultiplier:
  //   "6 gummies" / "6 pieces" → ratio 1 → 100 cal  (not 6×100=600)
  {
    label: '6 gummies (FS may say "pieces")',
    body: { name: 'gummies', amount: '6 gummies', fatSecretSearch: 'gummy candy' },
    expect: { calRange: [20, 250] },
    note: 'Tier-3 fix: mult = 6 / dbCount. New prompt: resolvedAmount drives mult=6 display',
  },
  {
    label: '4 chicken nuggets',
    body: { name: 'chicken nuggets', amount: '4 nuggets', fatSecretSearch: 'chicken nuggets' },
    expect: { calRange: [60, 420] },
    note: 'FS may use 100g base — cal check only for now',
  },
  // ── Mass: oz / lb → grams ─────────────────────────────────────────
  // Old path (no resolvedAmount): mass correction runs, unit shows as g, cal is correct
  // New prompt path: resolvedAmount "4 oz" → mult=4 unit=oz (honors user)
  {
    label: '4 oz chicken breast (cal)',
    body: { name: 'chicken breast', amount: '4 oz', fatSecretSearch: 'chicken breast cooked' },
    expect: { calRange: [100, 265] },
    note: 'New prompt: mult=4 unit=oz; old path: mult=1.1 unit=g (cal still correct)',
  },
  {
    label: '6 oz salmon (cal)',
    body: { name: 'salmon', amount: '6 oz', fatSecretSearch: 'salmon fillet' },
    expect: { calRange: [150, 430] },
  },
  {
    label: '8 oz steak (cal)',
    body: { name: 'steak', amount: '8 oz', fatSecretSearch: 'beef steak grilled' },
    expect: { calRange: [280, 750] },
  },
  {
    label: '4 oz green beans (cal)',
    body: { name: 'green beans', amount: '4 oz', fatSecretSearch: 'green beans cooked' },
    expect: { calRange: [20, 95] },
  },
  // ── Grams explicit ────────────────────────────────────────────────
  {
    label: '100g greek yogurt (cal)',
    body: { name: 'greek yogurt', amount: '100g', fatSecretSearch: 'greek yogurt plain nonfat' },
    expect: { calRange: [50, 200] },
    note: 'New prompt: mult=100 unit=g; old path: mass-corrected to FS serving',
  },
  // ── Fractions ─────────────────────────────────────────────────────
  {
    label: 'half a sandwich',
    body: { name: 'turkey sandwich', amount: 'half a sandwich', fatSecretSearch: 'turkey sandwich' },
    expect: { multApprox: 0.5, calRange: [100, 520] },
  },
  {
    label: '1.5 scoops protein powder',
    body: { name: 'whey protein', amount: '1.5 scoops', fatSecretSearch: 'whey protein powder' },
    expect: { multApprox: 1.5, calRange: [70, 350] },
  },
  // ── Vague amounts ─────────────────────────────────────────────────
  {
    label: 'small handful of almonds',
    body: { name: 'almonds', amount: 'small handful', fatSecretSearch: 'raw almonds' },
    expect: { calRange: [60, 300] },
    note: 'AI estimates ~20–30g',
  },
  {
    label: 'large handful trail mix',
    body: { name: 'trail mix', amount: 'large handful', fatSecretSearch: 'trail mix nuts' },
    expect: { calRange: [80, 550] },
    note: 'Wide range — AI judgment. Old path can over-estimate if it picks a large FS base.',
  },
  {
    label: 'a few blueberries',
    body: { name: 'blueberries', amount: 'a few', fatSecretSearch: 'fresh blueberries' },
    expect: { calRange: [5, 90] },
  },
  // ── Volume units ──────────────────────────────────────────────────
  {
    label: '1 cup oatmeal cooked (cal)',
    body: { name: 'oatmeal', amount: '1 cup', fatSecretSearch: 'oatmeal cooked' },
    expect: { calRange: [100, 310] },
    note: 'New prompt: mult=1 unit=cup; old path: grams-based mult',
  },
  {
    label: '2 tbsp peanut butter (cal)',
    body: { name: 'peanut butter', amount: '2 tbsp', fatSecretSearch: 'peanut butter smooth' },
    expect: { calRange: [100, 420] },
    note: 'Old path may inflate if AI uses 100g base × 2 instead of ~32g',
  },
  {
    label: '2 cups cooked jasmine rice (cal)',
    body: { name: 'jasmine rice', amount: '2 cups cooked', fatSecretSearch: 'jasmine rice cooked' },
    expect: { calRange: [250, 1100] },
    note: 'Wide range — 2 cups ~450 cal ideal; old path may over-estimate',
  },
  // ── Simple counts ─────────────────────────────────────────────────
  {
    label: '3 whole eggs (cal)',
    body: { name: 'eggs', amount: '3 eggs', fatSecretSearch: 'whole egg large' },
    expect: { calRange: [150, 650] },
    note: 'FS "100g" serving: old path mult=3 → ~441 cal (too high). New prompt: resolvedAmount "150 g"',
  },
  {
    label: '2 plain rice cakes (cal)',
    body: { name: 'rice cakes', amount: '2 rice cakes', fatSecretSearch: 'plain rice cakes' },
    expect: { calRange: [50, 260] },
  },
  {
    label: '2 slices whole wheat bread',
    body: { name: 'bread', amount: '2 slices', fatSecretSearch: 'whole wheat bread sliced' },
    expect: { multApprox: 2, unitContains: ['slice'], calRange: [100, 310] },
    note: 'Count match "slice"/"slice" should work on both old and new path',
  },
  // ── Bare count ────────────────────────────────────────────────────
  {
    label: '1 medium banana',
    body: { name: 'banana', amount: '1', fatSecretSearch: 'banana medium' },
    expect: { multApprox: 1, calRange: [60, 165] },
  },
  {
    label: '1 Quest protein bar',
    body: { name: 'Quest bar', amount: '1 bar', fatSecretSearch: 'Quest protein bar chocolate chip' },
    expect: { multApprox: 1, calRange: [150, 340] },
    note: 'Count match "bar"/"bar" should work on both paths',
  },
]

function grade(result, tc) {
  const issues = []
  const { expect: exp } = tc
  if (result.error) return { pass: false, issues: [`API error: ${result.error}`] }
  const mult = result.servingMultiplier ?? 0
  const unit = ((result.servingUnit ?? '') + ' ' + (result.servingType ?? '')).toLowerCase()
  const cal = result.calories ?? 0
  if (exp.multApprox !== undefined) {
    const denom = Math.max(exp.multApprox, 0.01)
    const diff = Math.abs(mult - exp.multApprox) / denom
    if (diff > 0.25) issues.push(`mult ${mult.toFixed(2)} ≠ expected ~${exp.multApprox}`)
  }
  if (exp.unitContains) {
    const matched = exp.unitContains.some(u => unit.includes(u))
    if (!matched) issues.push(`unit "${unit.trim()}" — expected [${exp.unitContains.join('/')}]`)
  }
  if (exp.calRange) {
    if (cal < exp.calRange[0] || cal > exp.calRange[1])
      issues.push(`cal ${cal} outside [${exp.calRange[0]}–${exp.calRange[1]}]`)
  }
  return { pass: issues.length === 0, issues }
}

async function run() {
  console.log(`\nMacro serving tests → ${WORKER}\n`)
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
      const resolved = result.macroEstimateSnapshot?.resolvedAmount ?? '—'
      const snap = result.macroEstimateSnapshot ?? {}
      const fsResults = result.fatSecretResults ?? []
      const fsName = fsResults[0] ? (fsResults[0].brandName ? `${fsResults[0].brandName} ${fsResults[0].name}` : fsResults[0].name) : '—'
      // Show the selected serving, not just the first one
      const fsIdx = typeof snap.fatSecretIndex === 'number' ? snap.fatSecretIndex : null
      const servIdx = typeof snap.servingIndex === 'number' ? snap.servingIndex : null
      const selectedFood = fsIdx != null && fsIdx >= 1 ? fsResults[fsIdx - 1] : fsResults[0]
      const selectedServing = servIdx != null && servIdx >= 1
        ? selectedFood?.servings?.[servIdx - 1]
        : selectedFood?.servings?.[0]
      const fsServing = selectedServing?.description ?? '—'
      rows.push({ label: tc.label, pass, issues, ms,
        mult: (result.servingMultiplier ?? 0).toFixed(2),
        unit: result.servingUnit ?? result.servingType ?? '—',
        cal: result.calories ?? 0,
        resolved,
        fsIdx: snap.fatSecretIndex ?? '—',
        servIdx: snap.servingIndex ?? '—',
        libIdx: snap.libraryIndex ?? '—',
        fsName: (fsName ?? '—').slice(0, 38),
        fsServing: fsServing.slice(0, 30),
        fsSource: result.fatSecretSource ?? '—',
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
    console.log(`    resolvedAmount: ${r.resolved}   fsIdx:${r.fsIdx} servIdx:${r.servIdx} libIdx:${r.libIdx}`)
    console.log(`    mult=${r.mult}  unit=${r.unit}  cal=${r.cal}  (${r.ms}ms)`)
    console.log(`    FS: "${r.fsName}" | serving: "${r.fsServing}" | source: ${r.fsSource}`)
    if (r.note)   console.log(`    ℹ ${r.note}`)
    if (r.issues?.length) r.issues.forEach(i => console.log(`    ⚠ ${i}`))
    console.log()
  }

  console.log('─'.repeat(80))
  console.log('NEXT STEP: Go to Alexander settings → Diet AI Prompts → Macro estimate → Reset to default')
  console.log('           Then re-run this script to see resolvedAmount in every response.')
}

run().catch(console.error)
