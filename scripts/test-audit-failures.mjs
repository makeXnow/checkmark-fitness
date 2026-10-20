#!/usr/bin/env node
/**
 * Isolated replay of the food logs that failed the Oct 2026 30-day accuracy audit.
 * Runs each utterance through PARSER (/api/ai/json) → /api/macro/estimate exactly like the
 * app does, then checks each target item against the audited expected range.
 *
 *   npx wrangler dev --port 8788   # in another terminal (reads D1, writes nothing)
 *   node scripts/test-audit-failures.mjs
 *
 * Env: AUDIT_WORKER (default http://127.0.0.1:8788), AUDIT_ONLY=<substring>[|<substring>…], AUDIT_CONCURRENCY,
 *      AUDIT_LIBRARY_FILE (JSON { [profile]: customFoods[] }; otherwise read via /bootstrap),
 *      AUDIT_OUT (write JSON results), AUDIT_SET=holdout (scripts/holdout-cases.mjs instead)
 */

const WORKER = (process.env.AUDIT_WORKER || 'http://127.0.0.1:8788').replace(/\/$/, '')
const ONLY = process.env.AUDIT_ONLY?.toLowerCase().split('|').filter(Boolean)
const CONCURRENCY = Number(process.env.AUDIT_CONCURRENCY || 4)
const OWNER = 'alexander'

/**
 * targets: { item: RegExp on parsed item name, cal: [lo, hi], before: what production logged }
 * sum: total-calorie range across every parsed item
 * expectItems: exact parsed item count
 */
const CASES = [
  { id: 'cafe-rio-salad', profile: OWNER, said: "I had a Cafe Rio small salad with, I don't know if it's pulled chicken or shredded chicken or whatever they call it, and with the rice and bean. Make sure you get the serving size for the small salad for it. I did not eat the tortilla and I did not get cheese on it, so split up the things.", sum: { cal: [480, 820], before: '423 (Icon Meals meal-prep + extras)' } },
  { id: 'ramen-half + walmart-can', profile: OWNER, said: 'Half of one of those ramen things like that really popular brand in the U.S., one can of Walmart chicken.', targets: [
    { item: /ramen|noodle/i, cal: [160, 215], before: '185 (card base "1 package = 185")', basePerUnit: [320, 430] },
    { item: /chicken/i, cal: [185, 245], before: '184 / 25 g' },
  ] },
  { id: 'chicken-5oz + large-onion', profile: OWNER, said: '5 ounces of chicken breast, 5 ounces of broccoli, one large red onion.', targets: [
    { item: /chicken/i, cal: [200, 260], before: '113 (raw basis)' },
    { item: /onion/i, cal: [50, 130], before: '45' }, // USDA large onion ≈ 150 g ≈ 60 cal
  ] },
  { id: 'reeses-oreo-1', profile: OWNER, said: "Reese's Oreo.", targets: [{ item: /./, cal: [70, 115], before: '14 (1/9 of mini Oreos)' }] },
  { id: 'grilled-168g', profile: OWNER, said: '168 grams of chicken breast, grilled.', targets: [{ item: /chicken/i, cal: [255, 300], before: '327 (skin-on)' }] },
  { id: 'half-can', profile: OWNER, said: 'half can of chicken', targets: [{ item: /chicken/i, cal: [90, 125], before: '55 (Hormel 5 oz can)' }] },
  { id: 'grilled-100g', profile: OWNER, said: '100 grams of grilled chicken.', targets: [{ item: /chicken/i, cal: [150, 180], before: '237' }] },
  { id: 'chobani-choc-chip', profile: OWNER, said: 'the chocolate chip cookie Chobani flip.', targets: [{ item: /./, cal: [160, 200], before: '190 (Cookies & Cream)' }] },
  { id: 'sourdough + mozzarella', profile: OWNER, said: 'Strawberry cheesecake Chobani flip, and two slices of sourdough bread, eight slices of deli chicken, three slices of fresh mozzarella from Costco.', targets: [
    { item: /sourdough|bread/i, cal: [180, 280], before: '170 (baguette slices)' },
    { item: /mozz/i, cal: [170, 260], before: '260 (low-moisture)' },
  ] },
  { id: 'meal-9-19', profile: OWNER, said: 'I had eight ounces of chicken, two-thirds of a pack of ramen, an egg, one ounce of beef jerky, six ounces of broccoli, four ounces of rice,', expectItems: 6, sum: { cal: [820, 1150], before: 'logged 3× (18 items), 7 stuck pending' } },
  { id: 'can-75pct', profile: OWNER, said: '75% can of chicken Walmart', targets: [{ item: /chicken/i, cal: [140, 185], before: '188' }] },
  { id: 'non-food-frozen', profile: OWNER, said: "Sorry, I plugged in someone's car. It was frozen when I pulled it out of the freezer. I wasn't even thinking about it. It was frozen? Milk was frozen, the chicken was frozen.", expectItems: 0, sum: { cal: [0, 0], before: '160 (1 cup milk)' } },
  { id: 'grilled-250g', profile: OWNER, said: '250 grams of chicken, grilled chicken.', targets: [{ item: /chicken/i, cal: [385, 445], before: '598' }] },
  { id: 'reese-oreo-2', profile: OWNER, said: 'Reese Oreo', targets: [{ item: /./, cal: [70, 115], before: '14' }] },
  { id: 'grilled-300g', profile: OWNER, said: '300 grams of grilled chicken breast.', targets: [{ item: /chicken/i, cal: [465, 530], before: '585' }] },
  { id: 'arbys-steak-nuggets', profile: OWNER, said: 'Arby’s Angie’s sandwhich and small steak nuggets', targets: [{ item: /nugget/i, cal: [290, 390], before: '68 / 3.4 g' }] },
  { id: 'grilled-150g', profile: OWNER, said: '150g grilled chicken', targets: [{ item: /chicken/i, cal: [230, 265], before: '356' }] },
  { id: 'cookie-dough-one-bar', profile: OWNER, said: "I had eight ounces of chicken, and then later six ounces of chicken, and then the Trader Joe's miso salad kit, like the whole thing. So make sure you get the serving size right. And a chocolate chip cookie dough, uh, one bar, protein bar, and that's it.", targets: [{ item: /bar|cookie/i, cal: [190, 240], before: '190 (Quest)' }] },
  { id: 'cfa-4-nuggets', profile: OWNER, said: 'Chick-fil-A spicy chicken sandwich and four of the fried Chick-fil-A nuggets.', targets: [{ item: /nugget/i, cal: [105, 155], before: '160 (card "1 nugget")' }] },
  { id: 'maple-donut-one-bar', profile: OWNER, said: "Maple Donut, one protein bar, and MyProtein, it's like a clear isolate. I think it's like a strawberry something combo.", expectItems: 3, targets: [{ item: /bar/i, cal: [180, 260], before: 'dropped' }] },
  { id: 'lasagna-stated', profile: OWNER, said: "200 grams of grilled chicken breast and an entire container, which is 620 calories, of lasagna soup with turkey from Trader Joe's. It has 11 grams of protein in it. Oh, but the whole container has 26 grams of protein in it.", targets: [
    { item: /lasagna|soup/i, cal: [600, 640], before: '473 / 19 g' },
    { item: /chicken/i, cal: [305, 355], before: '(ok)' },
  ] },
  { id: 'rice-cakes-3', profile: OWNER, said: 'Three rice cakes and three ounces of beef jerky.', targets: [{ item: /rice cake/i, cal: [90, 120], before: '78' }] },
  { id: 'halo-top-third', profile: OWNER, said: '1/3 peanut butter halo top', targets: [{ item: /./, cal: [95, 125], before: '165' }] },
  { id: 'oct5-meal', profile: OWNER, said: "143 grams of grilled chicken breast, a full thing of the Trader Joe's arugula lemon salad, a black cherry Yasso ice cream bar, a Costco egg white feta sandwich thing.", targets: [
    { item: /chicken/i, cal: [220, 255], before: '(ok)' },
    { item: /arugula|salad/i, cal: [460, 560], before: '410 (Lemon Chicken & Arugula)' },
    { item: /yasso|cherry/i, cal: [90, 110], before: '80' },
    { item: /feta|sandwich|wrap/i, cal: [260, 320], before: '390 (Kirkland breakfast sandwich)' },
  ] },
  { id: 'oct6-meal', profile: OWNER, said: "three-fourths of a box of Goodles and one can of Great Value chicken, the whole can, and one Hershey's almond cluster, which is 80 calories, and one Reese's Oreo, and one apple.", targets: [
    { item: /chicken/i, cal: [185, 245], before: '160 / 36 g' },
    { item: /almond|cluster|hershey/i, cal: [75, 85], before: '(ok)' },
    { item: /oreo|reese/i, cal: [70, 115], before: '14' },
  ] },
  { id: 'grilled-100g-b', profile: OWNER, said: '100g grilled chicken', targets: [{ item: /chicken/i, cal: [150, 180], before: '237' }] },
  { id: 'grilled-200g', profile: OWNER, said: 'I had 70% of a bag of the lime cilantro microwavable rice from Costco, and one of those egg white spinach wrap things from Costco, and 200 grams of grilled chicken, and 100 grams of grilled broccoli, and...', targets: [
    { item: /chicken/i, cal: [305, 355], before: '473' },
    { item: /wrap/i, cal: [260, 320], before: '(barcode 290)' },
  ] },
  { id: 'aristas-oreo', profile: OWNER, said: "Arista's Oreo.", targets: [{ item: /./, cal: [70, 115], before: '53 (regular Oreo)' }] },
  { id: 'grilled-222g', profile: OWNER, said: '222g of grilled chicken', targets: [{ item: /chicken/i, cal: [340, 390], before: '526' }] },
  { id: 'steak-strips + cucumber', profile: OWNER, said: '50 grams of Kirkland steak strips and a large cucumber.', expectItems: 2, targets: [{ item: /cucumber/i, cal: [25, 65], before: 'dropped' }] },
  { id: 'dal-stated + grilled-166g', profile: OWNER, said: '144 grams of broccoli, frozen broccoli, 166 grams of frozen grilled chicken, sorry, not frozen, just regular grilled chicken, and Trader Joe\'s Indian fare, yellow tadka dal, the whole pouch. And the pouch is 260 calories.', targets: [
    { item: /chicken/i, cal: [250, 295], before: '392' },
    { item: /dal/i, cal: [255, 265], before: '(ok)' },
  ] },
  { id: 'hot-dogs-buns + popcorn', profile: OWNER, said: 'Two Hebrew National hot dogs with buns and two cups of popped popcorn.', targets: [
    { item: /hot dog|frank/i, cal: [260, 360], before: '300 (buns dropped)' },
    { item: /bun/i, cal: [180, 300], before: 'dropped' },
    { item: /popcorn/i, cal: [50, 100], before: '0 saved as ready' },
  ] },
  { id: 'reeses-oreos-2', profile: OWNER, said: "Two Reese's Oreos.", targets: [{ item: /./, cal: [150, 220], before: '31' }] },
  { id: 'tasso-car', profile: OWNER, said: 'Tasso black cherry car I think', targets: [{ item: /./, cal: [90, 110], before: '168 (black cherry drink)' }] },
  { id: 'cafe-rio-bowl', profile: OWNER, said: 'A steak, rice, and beans burrito bowl from Cafe Rio.', sum: { cal: [500, 820], before: '2,840 / 236 g' } },
  { id: 'great-value-can', profile: OWNER, said: 'Can of great value chicken', targets: [{ item: /chicken/i, cal: [185, 245], before: '(varied 160–240)' }] },
  { id: 'pad-see-ew', profile: OWNER, said: 'Pad see ew', targets: [{ item: /./, cal: [800, 1250], before: '1,271 (user halved)' }] },
  { id: 'mac-bites-long', profile: null, said: "I had an Ensure Plus shake, the one that's like 350 calories, and then I had a Premier Protein shake, the vanilla flavor, and then I had like a fourth of a cup of mac and cheese Goodles, a fourth of a box of the mac and cheese Goodles, and three Trader Joe's mac and cheese bites.", targets: [{ item: /bite|ball/i, cal: [120, 230], before: 'dropped' }] },
  { id: 'amazing-sauce', profile: null, said: '3 Mac and cheese balls from Trader Joe’s, 1 tablespoon of Trader Joe’s burger amazing sauce', targets: [{ item: /sauce/i, cal: [40, 75], before: '70 (Dynamite sauce)' }] },
  { id: 'elote + pub-cheese', profile: null, said: '1/4 cup Trader Joe’s Elote corn chip dippers and 1/8 cup trader Joe’s pub cheese', expectItems: 2, targets: [
    { item: /elote|chip|dipper/i, cal: [25, 75], before: '160 / 2 g' },
    { item: /cheese/i, cal: [45, 110], before: 'dropped' },
  ] },
]

async function postJson(path, body) {
  const res = await fetch(`${WORKER}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-checkmark-source': 'test' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`${path} ${res.status}: ${text.slice(0, 200)}`)
  }
  if (!res.ok) throw new Error(`${path} ${res.status}: ${data.error || text.slice(0, 200)}`)
  return data
}

const libraryCache = new Map()
/** Food library per profile: AUDIT_LIBRARY_FILE ({ [profile]: foods[] }) or the bootstrap route. */
async function libraryFor(profile) {
  if (!profile) return []
  if (libraryCache.has(profile)) return libraryCache.get(profile)
  let foods = []
  if (process.env.AUDIT_LIBRARY_FILE) {
    const fs = await import('node:fs')
    foods = JSON.parse(fs.readFileSync(process.env.AUDIT_LIBRARY_FILE, 'utf8'))[profile] ?? []
  } else {
    const res = await fetch(`${WORKER}/api/u/${encodeURIComponent(profile)}/bootstrap`)
    const data = await res.json()
    foods = data?.macro?.customFoods ?? []
  }
  libraryCache.set(profile, foods)
  return foods
}

function displayUnit(q, singular, plural) {
  return Math.abs(q - 1) < 1e-9 ? singular : plural || singular
}

function parseSnapshotFor(it) {
  const singular = it.unitSingular?.trim() || 'serving'
  const plural = it.unitPlural?.trim() || singular
  const q = Number(it.quantity) > 0 ? Number(it.quantity) : 1
  const unit = displayUnit(q, singular, plural)
  const qs = Number.isInteger(q) ? String(q) : String(Math.round(q * 1000) / 1000)
  return {
    emoji: it.emoji,
    name: it.name,
    amount: `${qs} ${unit}`,
    quantity: q,
    unit,
    unitSingular: singular,
    unitPlural: plural,
    unitFamily: it.unitFamily,
    estimated: it.estimated,
    originalPortion: it.originalPortion || undefined,
    notes: it.notes || undefined,
    fatSecretSearch: it.fatSecretSearch || undefined,
  }
}

async function runCase(cse) {
  const started = Date.now()
  const parsed = await postJson('/api/ai/json', {
    promptKey: 'PARSER',
    user: `Input: ${cse.said}`,
    profile: cse.profile ?? undefined,
  })
  const items = parsed.result?.items ?? []
  const customFoods = await libraryFor(cse.profile)
  const estimates = await Promise.all(
    items.map(async (it) => {
      const snap = parseSnapshotFor(it)
      try {
        const r = await postJson('/api/macro/estimate', {
          name: snap.name,
          amount: snap.amount,
          notes: snap.notes,
          fatSecretSearch: snap.fatSecretSearch,
          parseSnapshot: snap,
          userInput: cse.said,
          customFoods,
          profile: cse.profile ?? undefined,
        })
        const s = r.macroEstimateSnapshot ?? {}
        const fs = typeof s.fatSecretIndex === 'number' ? r.fatSecretResults?.[s.fatSecretIndex - 1] : null
        const serving = fs && typeof s.servingIndex === 'number' ? fs.servings?.[s.servingIndex - 1] : null
        const lib = r.libraryFoodId ? customFoods.find((f) => f.id === r.libraryFoodId) : null
        const pick = lib
          ? `library: ${lib.name} (${lib.baseAmount || '1 serving'})`
          : fs
            ? `${fs.brandName ? `${fs.brandName} ` : ''}${fs.name} — "${serving?.description ?? '?'}" ${s.relationshipV7 ?? ''}`
            : s.statedNutritionApplied
              ? 'user-stated nutrition'
              : 'direct AI estimate'
        return { name: snap.name, amount: snap.amount, calories: r.calories, protein: r.protein, baseCalories: r.baseCalories, servingMultiplier: r.servingMultiplier, pick, flags: s.guardrailFlags ?? [], crossCheck: s.crossCheckCalories, escalated: s.escalatedModel, memory: Boolean(s.personalMemoryHit) }
      } catch (e) {
        return { name: snap.name, amount: snap.amount, error: e.message }
      }
    }),
  )
  return { items: estimates, ms: Date.now() - started }
}

function grade(cse, out) {
  const checks = []
  if (typeof cse.expectItems === 'number') {
    checks.push({ label: `item count = ${cse.expectItems}`, got: String(out.items.length), pass: out.items.length === cse.expectItems, before: '' })
  }
  if (cse.sum) {
    const total = out.items.reduce((a, i) => a + (i.calories ?? 0), 0)
    checks.push({ label: `total ${cse.sum.cal[0]}–${cse.sum.cal[1]} cal`, got: `${total}`, pass: total >= cse.sum.cal[0] && total <= cse.sum.cal[1], before: cse.sum.before })
  }
  const used = new Set()
  for (const t of cse.targets ?? []) {
    const idx = out.items.findIndex((i, k) => !used.has(k) && t.item.test(i.name))
    if (idx < 0) {
      checks.push({ label: `${t.item} ${t.cal[0]}–${t.cal[1]}`, got: 'missing', pass: false, before: t.before })
      continue
    }
    used.add(idx)
    const it = out.items[idx]
    let pass = !it.error && it.calories >= t.cal[0] && it.calories <= t.cal[1]
    let got = it.error ? `ERROR ${it.error}` : `${it.calories} cal / ${it.protein} g`
    if (pass && t.basePerUnit && typeof it.baseCalories === 'number') {
      const okBase = it.baseCalories >= t.basePerUnit[0] && it.baseCalories <= t.basePerUnit[1]
      got += ` (base ${it.baseCalories}/unit)`
      pass = okBase
    }
    checks.push({ label: `${it.name} ${t.cal[0]}–${t.cal[1]}`, got, pass, before: t.before })
  }
  return checks
}

async function main() {
  const set = process.env.AUDIT_SET === 'holdout' ? (await import('./holdout-cases.mjs')).HOLDOUT_CASES : CASES
  const cases = set.filter((c) => !ONLY?.length || ONLY.some((o) => c.id.toLowerCase().includes(o)))
  const results = new Array(cases.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, cases.length) }, async () => {
      while (next < cases.length) {
        const i = next++
        const cse = cases[i]
        try {
          const out = await runCase(cse)
          results[i] = { cse, out, checks: grade(cse, out) }
        } catch (e) {
          results[i] = { cse, out: { items: [], ms: 0 }, checks: [{ label: 'run', got: `ERROR ${e.message}`, pass: false, before: '' }] }
        }
        const r = results[i]
        const ok = r.checks.every((c) => c.pass)
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${cse.id}  (${Math.round(r.out.ms / 1000)}s)`)
        for (const c of r.checks) console.log(`   ${c.pass ? '✓' : '✗'} ${c.label}: ${c.got}${c.before ? `   [before: ${c.before}]` : ''}`)
        for (const it of r.out.items) {
          const extra = [
            it.flags?.length ? `flags=${it.flags.join(',')}` : '',
            it.crossCheck != null ? `xcheck=${it.crossCheck}` : '',
            it.escalated ? `escalated=${it.escalated}` : '',
            it.memory ? 'memory' : '',
          ].filter(Boolean).join(' ')
          console.log(`     · ${it.name} ${it.amount} → ${it.error ? `ERROR ${it.error}` : `${it.calories}/${it.protein}`}  [${it.pick ?? ''}] ${extra}`)
        }
      }
    }),
  )
  const allChecks = results.flatMap((r) => r.checks)
  const passCases = results.filter((r) => r.checks.every((c) => c.pass)).length
  console.log(`\n${passCases}/${results.length} cases fully pass · ${allChecks.filter((c) => c.pass).length}/${allChecks.length} checks pass`)
  if (process.env.AUDIT_OUT) {
    const fs = await import('node:fs')
    fs.writeFileSync(process.env.AUDIT_OUT, JSON.stringify(results.map((r) => ({ id: r.cse.id, said: r.cse.said, checks: r.checks, items: r.out.items, ms: r.out.ms })), null, 2))
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
