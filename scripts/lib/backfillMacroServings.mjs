/** Mirrors src/features/macro/macroLib.ts backfill logic for seed scripts. */

function parseIndex(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw)
  if (typeof raw === 'string' && raw.trim()) {
    const n = parseInt(raw, 10)
    if (Number.isFinite(n)) return n
  }
  return null
}

function trimTrailingZeros(s) {
  return s.replace(/\.?0+$/, '')
}

function isNearInteger(n, epsilon = 0.001) {
  return Math.abs(n - Math.round(n)) < epsilon
}

function servingUnitKind(unit) {
  const u = String(unit || '').toLowerCase().trim()
  if (/^(g|grams?)$/.test(u)) return 'gram'
  if (/^(oz|ounces?)$/.test(u) || /\boz\b/.test(u)) return 'ounce'
  if (/^(lb|lbs|pounds?)$/.test(u) || /\blb\b/.test(u)) return 'pound'
  if (/^(ml|milliliters?)$/.test(u)) return 'milliliter'
  if (/^(l|liters?)$/.test(u)) return 'liter'
  if (/\b(cups?|tbsp|tablespoons?|tsp|teaspoons?|fl\s*oz)\b/.test(u)) return 'volume'
  return 'count'
}

function formatServingQuantity(value, unit) {
  if (!Number.isFinite(value) || value <= 0) return '1'
  switch (servingUnitKind(unit)) {
    case 'gram':
    case 'milliliter':
      return String(Math.round(value))
    case 'ounce':
    case 'pound':
      if (isNearInteger(value)) return String(Math.round(value))
      return trimTrailingZeros(value.toFixed(1))
    case 'liter':
      if (value >= 10 || isNearInteger(value)) return String(Math.round(value))
      return trimTrailingZeros(value.toFixed(2))
    case 'volume':
      if (isNearInteger(value)) return String(Math.round(value))
      if (value < 1) return trimTrailingZeros(value.toFixed(2))
      return trimTrailingZeros(value.toFixed(1))
    default:
      if (isNearInteger(value)) return String(Math.round(value))
      return trimTrailingZeros(value.toFixed(2))
  }
}

function formatMultiplier(m) {
  return formatServingQuantity(m, 'serving')
}

function parseFractionToken(raw) {
  const m = String(raw).replace(/\s/g, '').match(/^(\d+)\/(\d+)$/)
  if (!m) return null
  const num = parseInt(m[1], 10)
  const den = parseInt(m[2], 10)
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null
  return num / den
}

export function parseServingDefinition(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return { servingSize: 1, servingUnit: 'serving', label: '1 serving' }

  const fracMatch = trimmed.match(/^(\d+\s*\/\s*\d+)\s+(.*)$/i)
  if (fracMatch) {
    const size = parseFractionToken(fracMatch[1])
    const unit = fracMatch[2].trim() || 'serving'
    if (size != null && size > 0) {
      return { servingSize: size, servingUnit: unit, label: trimmed }
    }
  }

  const numMatch = trimmed.match(/^([\d.]+)\s+(.*)$/)
  if (numMatch) {
    const size = parseFloat(numMatch[1])
    const unit = numMatch[2].trim()
    if (Number.isFinite(size) && size > 0 && unit) {
      return { servingSize: size, servingUnit: unit, label: trimmed }
    }
  }

  const compact = trimmed.match(/^([\d.]+)(oz|g|lb|lbs|ml|l)$/i)
  if (compact) {
    const size = parseFloat(compact[1])
    if (Number.isFinite(size) && size > 0) {
      const unit = compact[2].toLowerCase()
      return { servingSize: size, servingUnit: unit, label: trimmed }
    }
  }

  if (/^servings?$/i.test(trimmed)) {
    return { servingSize: 1, servingUnit: 'serving', label: '1 serving' }
  }

  return { servingSize: 1, servingUnit: trimmed, label: `1 ${trimmed}` }
}

export function formatServingTotal(count, servingSize, servingUnit) {
  const mult = Number.isFinite(count) && count > 0 ? count : 1
  const size = Number.isFinite(servingSize) && servingSize > 0 ? servingSize : 1
  const unit = String(servingUnit || '').trim() || 'serving'
  return `${formatServingQuantity(mult * size, unit)} ${unit}`
}

function servingDefinitionFromFields(item) {
  const hasSize = typeof item.servingSize === 'number' && item.servingSize > 0
  const unit = item.servingUnit?.trim()
  if (hasSize && unit) {
    const label =
      item.servingType?.trim() ||
      (item.servingSize === 1 ? `1 ${unit}` : `${formatMultiplier(item.servingSize)} ${unit}`)
    return { servingSize: item.servingSize, servingUnit: unit, label }
  }
  return parseServingDefinition(item.servingType?.trim() || '1 serving')
}

function applyStructuredServingFields(item, mult, def) {
  return {
    ...item,
    servingType: def.label,
    servingSize: def.servingSize,
    servingUnit: def.servingUnit,
    servingMultiplier: mult,
    amount: formatServingTotal(mult, def.servingSize, def.servingUnit),
  }
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

function scaleMacros(baseCalories, baseProtein, mult) {
  const m = Number.isFinite(mult) && mult > 0 ? mult : 1
  return {
    baseCalories,
    baseProtein,
    calories: Math.round(baseCalories * m),
    protein: Math.round(baseProtein * m * 10) / 10,
  }
}

function resolveItemServingMultiplier(item) {
  if (typeof item.servingMultiplier === 'number' && item.servingMultiplier > 0) return item.servingMultiplier
  const snap = item.macroEstimateSnapshot
  if (typeof snap?.multiplier === 'number' && snap.multiplier > 0) return snap.multiplier
  return parseLegacyServing(item.amount || '').multiplier
}

function fatSecretServingFromItem(item) {
  const snap = item.macroEstimateSnapshot
  const fsIdx = snap ? parseIndex(snap.fatSecretIndex) : null
  if (fsIdx == null || !item.fatSecretResults?.length || fsIdx < 1 || fsIdx > item.fatSecretResults.length) {
    return null
  }
  const food = item.fatSecretResults[fsIdx - 1]
  const servIdx = parseIndex(snap?.servingIndex)
  if (servIdx != null && servIdx >= 1 && servIdx <= food.servings.length) return food.servings[servIdx - 1]
  return food.servings.find((s) => s.isDefault) ?? food.servings[0] ?? null
}

function resolveCanonicalBaseMacros(item, customFoods = []) {
  if (item.libraryFoodId) {
    const food = customFoods.find((f) => f.id === item.libraryFoodId)
    if (food) return { baseCalories: food.calories, baseProtein: food.protein }
  }
  const serving = fatSecretServingFromItem(item)
  if (serving) return { baseCalories: serving.calories, baseProtein: serving.protein }
  if (item.baseCalories != null && item.baseProtein != null) {
    const mult = resolveItemServingMultiplier(item)
    const synced = scaleMacros(item.baseCalories, item.baseProtein, mult)
    const storedCal = item.calories ?? 0
    if (storedCal <= 0 || Math.abs(storedCal - synced.calories) <= 1) {
      return { baseCalories: item.baseCalories, baseProtein: item.baseProtein }
    }
  }
  const cal = item.calories ?? 0
  const pro = item.protein ?? 0
  if (cal > 0 || pro > 0) {
    const mult = resolveItemServingMultiplier(item)
    if (mult > 0) {
      return {
        baseCalories: Math.round(cal / mult),
        baseProtein: Math.round((pro / mult) * 10) / 10,
      }
    }
  }
  return null
}

function servingDefinitionForBackfill(item, customFoods) {
  if (item.servingType?.trim() || (typeof item.servingSize === 'number' && item.servingUnit?.trim())) {
    return servingDefinitionFromFields(item)
  }
  const serving = fatSecretServingFromItem(item)
  if (serving) return parseServingDefinition(serving.description)
  if (item.libraryFoodId) {
    const food = customFoods.find((f) => f.id === item.libraryFoodId)
    if (food) return parseServingDefinition(food.baseAmount || '1 serving')
  }
  const legacy = parseLegacyServing(item.amount || '')
  return parseServingDefinition(item.macroEstimateSnapshot?.servingType?.trim() || legacy.servingType)
}

export function backfillMacroItemServingFields(item, customFoods = []) {
  const mult = resolveItemServingMultiplier(item)
  const def = servingDefinitionForBackfill(item, customFoods)
  const structured = applyStructuredServingFields(item, mult, def)
  const base = resolveCanonicalBaseMacros(item, customFoods)
  if (base) {
    return { ...structured, ...scaleMacros(base.baseCalories, base.baseProtein, mult) }
  }
  return structured
}

export function backfillMacroLogs(logs, customFoods = []) {
  const out = {}
  for (const [date, items] of Object.entries(logs || {})) {
    out[date] = items.map((item) => backfillMacroItemServingFields(item, customFoods))
  }
  return out
}
