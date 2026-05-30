/**
 * Edge-case integration tests — 20 new scenarios not covered by the original suite.
 * Run: node scripts/test-macro-edge.mjs
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
  // ── Fractional oz ─────────────────────────────────────────────────────────
  {
    label: '2.5 oz turkey breast',
    body: { name: 'turkey breast', amount: '2.5 oz', fatSecretSearch: 'turkey breast deli sliced' },
    expect: { calRange: [60, 200] },
    note: 'Fractional oz — mass path should convert 2.5×28.35 = ~71g',
  },
  // ── Pound-based ───────────────────────────────────────────────────────────
  {
    label: '0.5 lb ground beef cooked',
    body: { name: 'ground beef', amount: '0.5 lb', fatSecretSearch: 'ground beef cooked 80 lean' },
    expect: { calRange: [350, 800] },
    note: '0.5 lb = 227g; should not be treated as 0.5 of a 100g serving',
  },
  // ── Very small measure ────────────────────────────────────────────────────
  {
    label: '1 tsp olive oil',
    body: { name: 'olive oil', amount: '1 tsp', fatSecretSearch: 'olive oil' },
    expect: { calRange: [25, 60] },
    note: '1 tsp ≈ 4.5g fat → ~40 cal; FS likely has 1 tbsp = 120 cal base → mult=0.33',
  },
  {
    label: '1 tbsp olive oil',
    body: { name: 'olive oil', amount: '1 tbsp', fatSecretSearch: 'olive oil' },
    expect: { calRange: [80, 160] },
    note: '1 tbsp ≈ 13.5g → ~120 cal; FS 1 tbsp base → mult=1',
  },
  // ── Large volume / beverage ───────────────────────────────────────────────
  {
    label: '16 oz orange juice',
    body: { name: 'orange juice', amount: '16 oz', fatSecretSearch: 'orange juice not from concentrate' },
    expect: { calRange: [140, 380] },
    note: '16 oz ≈ 473ml; FS likely has 240ml/8oz base → mult≈2',
  },
  // ── Decimal count ─────────────────────────────────────────────────────────
  {
    label: 'half an avocado',
    body: { name: 'avocado', amount: 'half an avocado', fatSecretSearch: 'avocado raw' },
    expect: { multApprox: 0.5, calRange: [70, 200] },
    note: 'resolvedAmount: "0.5 avocado"; FS may list "1 avocado" or "50g" serving',
  },
  // ── Multi-word count nouns ────────────────────────────────────────────────
  {
    label: '3 fish sticks',
    body: { name: 'fish sticks', amount: '3 fish sticks', fatSecretSearch: 'fish sticks frozen' },
    expect: { calRange: [100, 360] },
    note: 'Two-word count noun; FS may list "4 sticks" or "3 pieces" — tier-3 fallback',
  },
  {
    label: '2 string cheese sticks',
    body: { name: 'string cheese', amount: '2 sticks', fatSecretSearch: 'string cheese mozzarella stick' },
    expect: { multApprox: 2, calRange: [100, 240] },
    note: '"stick" count match; FS usually "1 stick (28g)"',
  },
  {
    label: '10 baby carrots',
    body: { name: 'baby carrots', amount: '10 baby carrots', fatSecretSearch: 'baby carrots raw' },
    expect: { calRange: [25, 90] },
    note: 'FS may list "3 carrots" or "85g"; tier-3 or mass path',
  },
  // ── Branded items ─────────────────────────────────────────────────────────
  {
    label: '3 Oreo cookies',
    body: { name: 'Oreos', amount: '3 cookies', fatSecretSearch: 'Oreo chocolate sandwich cookies' },
    expect: { multApprox: 3, calRange: [100, 280] },
    note: 'FS "3 cookies (34g)" base → mult=1; "6 cookies" → mult=0.5; Tier-2 or tier-3',
  },
  {
    label: 'half a Clif Bar',
    body: { name: 'Clif Bar', amount: 'half a bar', fatSecretSearch: 'Clif Bar chocolate chip' },
    expect: { multApprox: 0.5, calRange: [100, 300] },
    note: 'resolvedAmount: "0.5 bar"; FS "1 bar" base → mult=0.5',
  },
  {
    label: '2 slices Dave\'s Killer Bread',
    body: { name: "Dave's Killer Bread", amount: '2 slices', fatSecretSearch: "Dave's Killer Bread 21 whole grains" },
    expect: { multApprox: 2, calRange: [140, 380] },
    note: 'Brand-name slice count; FS "1 slice" base → mult=2',
  },
  // ── Dairy / common measures ───────────────────────────────────────────────
  {
    label: '1 cup whole milk',
    body: { name: 'whole milk', amount: '1 cup', fatSecretSearch: 'whole milk' },
    expect: { calRange: [100, 220] },
    note: '1 cup = 240ml; FS likely has 240ml or "1 cup" base → mult=1',
  },
  {
    label: '2 tbsp cream cheese',
    body: { name: 'cream cheese', amount: '2 tbsp', fatSecretSearch: 'cream cheese regular' },
    expect: { calRange: [60, 200] },
    note: '2 tbsp ≈ 29g → ~100 cal; FS "2 tbsp" or "1 tbsp" base',
  },
  {
    label: '150g cottage cheese',
    body: { name: 'cottage cheese', amount: '150g', fatSecretSearch: 'cottage cheese low fat 2%' },
    expect: { calRange: [80, 250] },
    note: 'Explicit grams — Tier-1 mass path; FS may list 113g or 100g base',
  },
  // ── Fruit / produce ───────────────────────────────────────────────────────
  {
    label: '1 cup grapes',
    body: { name: 'grapes', amount: '1 cup', fatSecretSearch: 'grapes red seedless' },
    expect: { calRange: [50, 130] },
    note: '1 cup ≈ 150g; FS may list "1 cup" or "10 grapes" base',
  },
  {
    label: '1 medium apple',
    body: { name: 'apple', amount: '1 medium apple', fatSecretSearch: 'apple raw medium' },
    expect: { multApprox: 1, calRange: [60, 150] },
    note: 'resolvedAmount: "1 apple"; FS "1 medium" base',
  },
  // ── Condiment / sauce ─────────────────────────────────────────────────────
  {
    label: '1 tbsp honey',
    body: { name: 'honey', amount: '1 tbsp', fatSecretSearch: 'honey' },
    expect: { calRange: [40, 100] },
    note: '1 tbsp honey ≈ 21g → ~60 cal',
  },
  // ── Dry measure ───────────────────────────────────────────────────────────
  {
    label: '1 oz potato chips',
    body: { name: 'potato chips', amount: '1 oz', fatSecretSearch: 'potato chips original' },
    expect: { calRange: [100, 220] },
    note: '1 oz ≈ 28g; FS "1 oz (28g)" serving → mult=1',
  },
  // ── Cereal with grams ─────────────────────────────────────────────────────
  {
    label: '32g Cheerios',
    body: { name: 'Cheerios', amount: '32g', fatSecretSearch: 'Cheerios original cereal' },
    expect: { calRange: [90, 200] },
    note: 'Compact grams; FS "28g" or "1 cup (28g)" base → mass path mult=32/28≈1.14',
  },
]

function grade(result, tc) {
  const issues = []
  const { expect: exp } = tc
  if (result.error) return { pass: false, issues: [`API error: ${result.error}`] }
  const mult = result.servingMultiplier ?? 0
  const cal = result.calories ?? 0
  if (exp.multApprox !== undefined) {
    const denom = Math.max(exp.multApprox, 0.01)
    const diff = Math.abs(mult - exp.multApprox) / denom
    if (diff > 0.3) issues.push(`mult ${mult.toFixed(2)} ≠ expected ~${exp.multApprox}`)
  }
  if (exp.calRange) {
    if (cal < exp.calRange[0] || cal > exp.calRange[1])
      issues.push(`cal ${cal} outside [${exp.calRange[0]}–${exp.calRange[1]}]`)
  }
  return { pass: issues.length === 0, issues }
}

async function run() {
  console.log(`\nMacro serving EDGE CASES → ${WORKER}\n`)
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
      const fsIdx = typeof snap.fatSecretIndex === 'number' ? snap.fatSecretIndex : null
      const servIdx = typeof snap.servingIndex === 'number' ? snap.servingIndex : null
      const selectedFood = fsIdx != null && fsIdx >= 1 ? fsResults[fsIdx - 1] : fsResults[0]
      const selectedServing = servIdx != null && servIdx >= 1
        ? selectedFood?.servings?.[servIdx - 1]
        : selectedFood?.servings?.[0]
      const fsName = selectedFood ? (selectedFood.brandName ? `${selectedFood.brandName} ${selectedFood.name}` : selectedFood.name) : '—'
      const fsServing = selectedServing?.description ?? '—'
      rows.push({
        label: tc.label, pass, issues, ms,
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
}

run().catch(console.error)
