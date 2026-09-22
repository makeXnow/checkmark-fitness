/**
 * Model bakeoff for PARSER + FatSecret + MACROS (same path as the app).
 *
 * Gold outcomes were set BEFORE the run from:
 * - last week's real voice/text logs
 * - live FatSecret catalog probes (same foods.search the Worker uses)
 *
 * Run (local Worker with .dev.vars):
 *   npx wrangler dev --port 8787 --ip 127.0.0.1
 *   node scripts/macro-model-bakeoff.mjs
 *
 * Optional:
 *   BAKEOFF_WORKER=http://127.0.0.1:8787
 *   BAKEOFF_MODELS=gpt-5-nano,gpt-5.4-nano,gpt-5.6-luna,gpt-5-mini
 */

const WORKER = (process.env.BAKEOFF_WORKER || 'http://127.0.0.1:8787').replace(/\/$/, '')
const MODELS = (process.env.BAKEOFF_MODELS || 'gpt-5-nano,gpt-5.4-nano,gpt-5.6-luna,gpt-5-mini')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

/**
 * GOLD — what a correct pipeline should produce.
 *
 * Scoring (per expected item):
 * 1. parse: quantity ±0.05, unit family, search/name brand cues
 * 2. fatsecret: rewritten search returns a food matching foodIncludes (brand+name)
 * 3. macros: selected food matches foodIncludes / foodExcludes; calories & protein in range
 *
 * Calorie ranges assume FatSecret default servings we probed live:
 * - ONE Maple Glazed Doughnut: 230 kcal / 20 g protein per 1 bar
 * - Goodles Cheddy Mac: 270 kcal / 15 g protein per 2.6 oz (~0.4 box); full box ≈ 2.5 servings
 * - Great Value Canned Chicken: 60 kcal / 13 g protein per 3 oz drained; ~3–4 servings/can
 */
const CASES = [
  {
    id: 'one-maple-bar',
    userInput: 'Maple one bar',
    why: 'Brand ONE after flavor must not become a maple doughnut',
    expect: [
      {
        qty: 1,
        unitFamily: 'count',
        unitIncludes: ['bar'],
        searchIncludes: ['one'],
        nameIncludesAny: ['one', 'maple'],
        foodIncludesAny: ['one'],
        foodNameIncludesAny: ['maple'],
        foodExcludesAny: ['top pot', 'winchell'],
        calRange: [200, 250],
        proteinRange: [18, 22],
      },
    ],
  },
  {
    id: 'one-maple-quantity-control',
    userInput: 'One maple bar',
    why: 'Leading one is a count — doughnut/maple bar OK; must NOT force ONE brand',
    expect: [
      {
        qty: 1,
        unitFamily: 'count',
        unitIncludes: ['bar'],
        searchExcludes: ['one'],
        foodExcludesAny: ['one'],
        // Accept bakery maple bar OR protein maple bar that is not ONE brand
        calRange: [180, 650],
        proteinRange: [3, 22],
      },
    ],
  },
  {
    id: 'goodles-75-box',
    userInput: '75% box of Mac n cheese goodles',
    why: 'Box product Cheddy Mac, not Cheesy Mac Cup treated as a whole box',
    expect: [
      {
        qty: 0.75,
        unitFamily: 'count',
        unitIncludes: ['box'],
        searchIncludes: ['goodles'],
        foodIncludesAny: ['goodles'],
        foodNameIncludesAny: ['cheddy', 'mac'],
        foodExcludesAny: ['cup'],
        calRange: [450, 560],
        proteinRange: [22, 35],
      },
    ],
  },
  {
    id: 'goodles-half-box',
    userInput: 'Goodles half box',
    why: 'Same box scaling as 9/17 log (stored wrongly as 1 serving / 270 cal)',
    expect: [
      {
        qty: 0.5,
        unitFamily: 'count',
        unitIncludes: ['box'],
        searchIncludes: ['goodles'],
        foodIncludesAny: ['goodles'],
        foodNameIncludesAny: ['cheddy', 'mac'],
        foodExcludesAny: ['cup'],
        calRange: [300, 380],
        proteinRange: [15, 25],
      },
    ],
  },
  {
    id: 'walmart-chicken-75-can',
    userInput: '75% can of chicken Walmart',
    why: 'Walmart → Great Value canned chicken; can-scale bridge, not 100g≈1.18 cans',
    expect: [
      {
        qty: 0.75,
        unitFamily: 'count',
        unitIncludes: ['can'],
        searchIncludesAny: ['great value', 'canned chicken'],
        foodIncludesAny: ['great value', 'canned chicken'],
        foodExcludesAny: ['fried', 'rotisserie', 'sandwich', 'broth', 'soup'],
        calRange: [130, 240],
        proteinRange: [25, 50],
      },
    ],
  },
  {
    id: 'walmart-chicken-full-can',
    userInput: 'one can of Walmart chicken',
    why: 'From 9/16 utterance; store alias + full can',
    expect: [
      {
        qty: 1,
        unitFamily: 'count',
        unitIncludes: ['can'],
        foodIncludesAny: ['great value', 'canned chicken'],
        foodExcludesAny: ['fried', 'rotisserie', 'sandwich', 'broth'],
        calRange: [160, 320],
        proteinRange: [30, 65],
      },
    ],
  },
  {
    id: 'half-can-chicken',
    userInput: 'half can of chicken',
    why: 'Generic canned chicken half-can (9/17)',
    expect: [
      {
        qty: 0.5,
        unitFamily: 'count',
        unitIncludes: ['can'],
        foodIncludesAny: ['canned chicken'],
        foodExcludesAny: ['soup', 'broth', 'gravy'],
        calRange: [90, 200],
        proteinRange: [18, 45],
      },
    ],
  },
  {
    id: 'chicken-breast-168g',
    userInput: '168 grams of chicken breast, grilled.',
    why: 'Easy mass control — should stay accurate on every model',
    expect: [
      {
        qty: 168,
        unitFamily: 'mass',
        unitIncludes: ['g'],
        searchIncludes: ['chicken'],
        foodIncludesAny: ['chicken'],
        calRange: [250, 400],
        proteinRange: [40, 60],
      },
    ],
  },
  {
    id: 'beef-jerky-4oz',
    userInput: 'Four ounces of beef jerky.',
    why: 'Easy mass control',
    expect: [
      {
        qty: 4,
        unitFamily: 'mass',
        unitIncludes: ['oz'],
        searchIncludes: ['jerky'],
        foodIncludesAny: ['jerky'],
        calRange: [240, 360],
        proteinRange: [35, 55],
      },
    ],
  },
  {
    id: 'chobani-flip',
    userInput: 'the chocolate chip cookie Chobani flip.',
    why: 'Brand+flavor container; WHOLE_ITEM ~160–200 cal',
    expect: [
      {
        qty: 1,
        unitFamily: 'count',
        unitIncludesAny: ['container', 'flip', 'cup'],
        searchIncludes: ['chobani'],
        foodIncludesAny: ['chobani', 'flip'],
        calRange: [140, 230],
        proteinRange: [8, 14],
      },
    ],
  },
]

function includesAll(hay, needles) {
  const h = String(hay || '').toLowerCase()
  return (needles || []).every((n) => h.includes(String(n).toLowerCase()))
}

function includesAny(hay, needles) {
  if (!needles?.length) return true
  const h = String(hay || '').toLowerCase()
  return needles.some((n) => h.includes(String(n).toLowerCase()))
}

function excludesAny(hay, needles) {
  if (!needles?.length) return true
  const h = String(hay || '').toLowerCase()
  return !needles.some((n) => h.includes(String(n).toLowerCase()))
}

function near(a, b, tol = 0.051) {
  return Math.abs(Number(a) - Number(b)) <= tol
}

function foodLabel(food) {
  if (!food) return ''
  return `${food.brandName || ''} ${food.name || ''}`.trim()
}

async function post(path, body) {
  const res = await fetch(`${WORKER}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`${path} non-JSON: ${text.slice(0, 200)}`)
  }
  if (!res.ok) throw new Error(`${path} ${res.status}: ${JSON.stringify(json).slice(0, 400)}`)
  return json
}

function amountFromItem(item) {
  const q = item.quantity
  const singular = item.unitSingular || item.unit || 'serving'
  const plural = item.unitPlural || singular
  const unit = q === 1 ? singular : plural
  return `${q} ${unit}`
}

function scoreItem(expect, parsed, estimate) {
  const checks = []
  const pass = (ok, label, detail) => {
    checks.push({ ok, label, detail })
    return ok
  }

  const parseOk =
    pass(near(parsed?.quantity, expect.qty), 'qty', `${parsed?.quantity} vs ${expect.qty}`) &&
    pass(
      !expect.unitFamily || parsed?.unitFamily === expect.unitFamily,
      'unitFamily',
      parsed?.unitFamily,
    ) &&
    pass(
      includesAny(`${parsed?.unitSingular || ''} ${parsed?.unitPlural || ''}`, expect.unitIncludes || expect.unitIncludesAny),
      'unit',
      `${parsed?.unitSingular}/${parsed?.unitPlural}`,
    ) &&
    pass(includesAll(parsed?.fatSecretSearch, expect.searchIncludes), 'search+', parsed?.fatSecretSearch) &&
    pass(includesAny(parsed?.fatSecretSearch, expect.searchIncludesAny), 'searchAny', parsed?.fatSecretSearch) &&
    pass(excludesAny(parsed?.fatSecretSearch, expect.searchExcludes), 'search-', parsed?.fatSecretSearch) &&
    pass(includesAny(parsed?.name, expect.nameIncludesAny), 'name', parsed?.name)

  const foods = estimate?.fatSecretResults || []
  const snap = estimate?.macroEstimateSnapshot || {}
  const fsIdx = typeof snap.fatSecretIndex === 'number' ? snap.fatSecretIndex : null
  const selected = fsIdx != null && fsIdx >= 1 ? foods[fsIdx - 1] : null
  const label = foodLabel(selected)

  const hitInResults = foods.some(
    (f) =>
      includesAny(foodLabel(f), expect.foodIncludesAny) &&
      includesAny(f.name, expect.foodNameIncludesAny) &&
      excludesAny(foodLabel(f), expect.foodExcludesAny),
  )

  const fsOk = pass(hitInResults || foods.length === 0, 'fsCandidate', `${foods.length} foods; hit=${hitInResults}`)

  const selectOk =
    pass(includesAny(label, expect.foodIncludesAny), 'pickBrand', label) &&
    pass(includesAny(selected?.name, expect.foodNameIncludesAny), 'pickName', selected?.name) &&
    pass(excludesAny(label, expect.foodExcludesAny), 'pickExclude', label)

  const cal = estimate?.calories
  const pro = estimate?.protein
  const macroOk =
    pass(
      expect.calRange ? cal >= expect.calRange[0] && cal <= expect.calRange[1] : true,
      'calories',
      `${cal} in ${expect.calRange}`,
    ) &&
    pass(
      expect.proteinRange ? pro >= expect.proteinRange[0] && pro <= expect.proteinRange[1] : true,
      'protein',
      `${pro} in ${expect.proteinRange}`,
    )

  const parts = { parse: parseOk, fatsecret: fsOk, select: selectOk, macros: macroOk }
  const score = Object.values(parts).filter(Boolean).length
  return { score, max: 4, parts, checks, selected: label, calories: cal, protein: pro, search: parsed?.fatSecretSearch }
}

async function runCase(model, cse) {
  const rewrittenHint = cse.userInput
  const parsed = await post('/api/ai/json', {
    promptKey: 'PARSER',
    model,
    user: `Input: ${rewrittenHint}`,
  })
  const items = parsed.result?.items || []
  if (items.length < cse.expect.length) {
    return {
      id: cse.id,
      ok: false,
      score: 0,
      max: cse.expect.length * 4,
      error: `parser returned ${items.length} items, expected ≥${cse.expect.length}`,
      items,
    }
  }

  const itemScores = []
  for (let i = 0; i < cse.expect.length; i++) {
    const expect = cse.expect[i]
    const item = items[i]
    const estimate = await post('/api/macro/estimate', {
      model,
      name: item.name,
      amount: amountFromItem(item),
      notes: item.notes || '',
      fatSecretSearch: item.fatSecretSearch,
      userInput: cse.userInput,
      parseSnapshot: {
        emoji: item.emoji,
        name: item.name,
        quantity: item.quantity,
        unit: item.unitSingular,
        unitSingular: item.unitSingular,
        unitPlural: item.unitPlural,
        unitFamily: item.unitFamily,
        estimated: item.estimated,
        originalPortion: item.originalPortion || '',
        notes: item.notes || '',
        fatSecretSearch: item.fatSecretSearch,
        amount: amountFromItem(item),
      },
      customFoods: [],
    })
    itemScores.push(scoreItem(expect, item, estimate))
  }

  const score = itemScores.reduce((s, x) => s + x.score, 0)
  const max = itemScores.reduce((s, x) => s + x.max, 0)
  return {
    id: cse.id,
    why: cse.why,
    ok: score === max,
    score,
    max,
    itemScores,
    parsedNames: items.map((it) => `${it.quantity} ${it.unitSingular} ${it.name} [${it.fatSecretSearch}]`),
  }
}

async function main() {
  console.log(`Worker: ${WORKER}`)
  console.log(`Models: ${MODELS.join(', ')}`)
  console.log(`Cases: ${CASES.length}`)
  console.log('')

  // health
  try {
    await post('/api/ai/json', {
      promptKey: 'PARSER',
      model: MODELS[0],
      user: 'Input: 1 banana',
    })
  } catch (e) {
    console.error('Worker not reachable / PARSER failed:', e.message)
    console.error('Start: npx wrangler dev --port 8787 --ip 127.0.0.1')
    process.exit(1)
  }

  const summary = []

  for (const model of MODELS) {
    console.log(`\n######## ${model} ########`)
    let score = 0
    let max = 0
    const rows = []
    for (const cse of CASES) {
      process.stdout.write(`  ${cse.id} ... `)
      try {
        const result = await runCase(model, cse)
        score += result.score
        max += result.max
        rows.push(result)
        const mark = result.ok ? 'PASS' : 'FAIL'
        const detail = result.error
          ? result.error
          : result.itemScores
              .map(
                (is) =>
                  `${is.calories}c/${is.protein}p pick=${is.selected || '—'} [${Object.entries(is.parts)
                    .filter(([, v]) => !v)
                    .map(([k]) => k)
                    .join(',') || 'ok'}]`,
              )
              .join('; ')
        console.log(`${mark} ${result.score}/${result.max} — ${detail}`)
      } catch (e) {
        max += cse.expect.length * 4
        rows.push({ id: cse.id, ok: false, score: 0, max: cse.expect.length * 4, error: e.message })
        console.log(`ERR ${e.message.slice(0, 160)}`)
      }
    }
    summary.push({ model, score, max, pct: max ? Math.round((100 * score) / max) : 0, rows })
  }

  console.log('\n======== SUMMARY ========')
  summary.sort((a, b) => b.pct - a.pct || b.score - a.score)
  for (const s of summary) {
    console.log(`${s.pct}%  ${s.score}/${s.max}  ${s.model}`)
  }

  const hardIds = new Set([
    'one-maple-bar',
    'goodles-75-box',
    'goodles-half-box',
    'walmart-chicken-75-can',
    'walmart-chicken-full-can',
  ])
  console.log('\nHard cases only:')
  for (const s of summary) {
    let score = 0
    let max = 0
    for (const r of s.rows) {
      if (!hardIds.has(r.id)) continue
      score += r.score || 0
      max += r.max || 0
    }
    const pct = max ? Math.round((100 * score) / max) : 0
    console.log(`${pct}%  ${score}/${max}  ${s.model}`)
  }

  const outPath = new URL('../tmp/macro-model-bakeoff.json', import.meta.url)
  const { writeFileSync, mkdirSync } = await import('fs')
  mkdirSync(new URL('../tmp', import.meta.url), { recursive: true })
  writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), worker: WORKER, summary, cases: CASES }, null, 2))
  console.log(`\nWrote ${outPath.pathname}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
