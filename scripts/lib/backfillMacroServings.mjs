/** Mirrors src/features/macro/macroLib.ts backfill logic for seed scripts. */

function parseIndex(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw)
  if (typeof raw === 'string' && raw.trim()) {
    const n = parseInt(raw, 10)
    if (Number.isFinite(n)) return n
  }
  return null
}

function formatMultiplier(m) {
  return Number.isInteger(m) ? String(m) : m.toFixed(2).replace(/\.?0+$/, '')
}

function formatServingDisplay(multiplier, servingType) {
  const type = String(servingType || '').trim() || 'serving'
  const m = formatMultiplier(Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1)
  return `${m} ${type}`
}

export function parseLegacyServing(amount) {
  const trimmed = String(amount || '').trim()
  if (!trimmed) return { multiplier: 1, servingType: 'serving' }
  const match = trimmed.match(/^([\d.]+)\s+(.*)$/)
  if (match) {
    const n = parseFloat(match[1])
    if (Number.isFinite(n) && n > 0) return { multiplier: n, servingType: match[2].trim() || 'serving' }
  }
  const compact = trimmed.match(/^([\d.]+)(oz|g|lb|lbs|ml|l)$/i)
  if (compact) {
    const n = parseFloat(compact[1])
    if (Number.isFinite(n) && n > 0) return { multiplier: n, servingType: compact[2].toLowerCase() }
  }
  const numOnly = parseFloat(trimmed)
  if (Number.isFinite(numOnly) && String(numOnly) === trimmed) return { multiplier: numOnly, servingType: 'serving' }
  return { multiplier: 1, servingType: trimmed }
}

export function backfillMacroItemServingFields(item, customFoods = []) {
  if (item.baseCalories != null && item.baseProtein != null && item.servingType?.trim()) {
    const mult = typeof item.servingMultiplier === 'number' && item.servingMultiplier > 0 ? item.servingMultiplier : 1
    return {
      ...item,
      servingMultiplier: mult,
      amount: formatServingDisplay(mult, item.servingType),
    }
  }

  const foodsById = new Map(customFoods.map((f) => [f.id, f]))
  if (item.libraryFoodId) {
    const food = foodsById.get(item.libraryFoodId)
    if (food) {
      const legacy = parseLegacyServing(item.amount || '')
      const mult =
        typeof item.servingMultiplier === 'number' && item.servingMultiplier > 0
          ? item.servingMultiplier
          : legacy.multiplier
      const servingType = food.baseAmount || '1 serving'
      return {
        ...item,
        servingType,
        servingMultiplier: mult,
        baseCalories: food.calories,
        baseProtein: food.protein,
        amount: formatServingDisplay(mult, servingType),
      }
    }
  }

  const snap = item.macroEstimateSnapshot
  const fsIdx = snap ? parseIndex(snap.fatSecretIndex) : null
  if (snap && fsIdx != null && item.fatSecretResults?.length && fsIdx >= 1 && fsIdx <= item.fatSecretResults.length) {
    const food = item.fatSecretResults[fsIdx - 1]
    const servIdx = parseIndex(snap.servingIndex)
    const serving =
      servIdx != null && servIdx >= 1 && servIdx <= food.servings.length
        ? food.servings[servIdx - 1]
        : food.servings.find((s) => s.isDefault) ?? food.servings[0]
    const legacy = parseLegacyServing(item.amount || '')
    const mult =
      typeof item.servingMultiplier === 'number' && item.servingMultiplier > 0
        ? item.servingMultiplier
        : typeof snap.multiplier === 'number' && snap.multiplier > 0
          ? snap.multiplier
          : legacy.multiplier
    const servingType = serving.description
    return {
      ...item,
      servingType,
      servingMultiplier: mult,
      baseCalories: serving.calories,
      baseProtein: serving.protein,
      amount: formatServingDisplay(mult, servingType),
    }
  }

  const legacy = parseLegacyServing(item.amount || '')
  const mult =
    typeof item.servingMultiplier === 'number' && item.servingMultiplier > 0
      ? item.servingMultiplier
      : typeof snap?.multiplier === 'number' && snap.multiplier > 0
        ? snap.multiplier
        : legacy.multiplier
  const servingType = snap?.servingType?.trim() || legacy.servingType
  const calories = item.calories ?? 0
  const protein = item.protein ?? 0

  if (calories > 0 || protein > 0) {
    const baseCalories = mult > 0 ? Math.round(calories / mult) : calories
    const baseProtein = mult > 0 ? Math.round((protein / mult) * 10) / 10 : protein
    return {
      ...item,
      servingType,
      servingMultiplier: mult,
      baseCalories,
      baseProtein,
      amount: formatServingDisplay(mult, servingType),
    }
  }

  return {
    ...item,
    servingType,
    servingMultiplier: mult,
    amount: formatServingDisplay(mult, servingType),
  }
}

export function backfillMacroLogs(logs, customFoods = []) {
  const out = {}
  for (const [date, items] of Object.entries(logs || {})) {
    out[date] = items.map((item) => backfillMacroItemServingFields(item, customFoods))
  }
  return out
}
