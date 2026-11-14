import type { MacroCustomFood, MacroDayItem } from '../../types/domain'
import { normalizeSingular, parseLeadingQuantity } from './macroMass'

/** Only explicit measurements qualify: a yogurt/container with a weight note stays a count. */
export function libraryMeasurement(amount: string): { quantity: number; unit: string } | null {
  // FatSecret's Cheddy Mac serving contains "2..6 oz"; its 74 g equivalent confirms 2.6 oz.
  const text = amount.trim().toLowerCase().replace(/^(\d+)\.{2}(\d+)(?=\s*(?:oz|g|kg|lb)\b)/, '$1.$2')
  const quantity = parseLeadingQuantity(text)
  if (quantity == null || quantity <= 0 || !Number.isFinite(quantity)) return null
  const rawUnit = text.replace(/^(\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:\.\d+)?)\s*/, '')
    .replace(/\s*\([^)]*\)/g, '').trim()
  const modifier = rawUnit.match(/\s+(drained|cooked|raw|prepared|dry|frozen|salad \+ dressing)$/)?.[0] ?? ''
  const unit = normalizeSingular(modifier ? rawUnit.slice(0, -modifier.length) : rawUnit)
  const aliases: Record<string, string> = { kilogram: 'kg', kilograms: 'kg', milligram: 'mg', milligrams: 'mg',
    cups: 'cup', tablespoons: 'tbsp', tablespoon: 'tbsp', teaspoons: 'tsp', teaspoon: 'tsp',
    'fluid ounce': 'fl oz', 'fluid ounces': 'fl oz' }
  const canonical = aliases[unit] ?? unit
  return ['g', 'oz', 'lb', 'kg', 'mg', 'ml', 'l', 'cup', 'tbsp', 'tsp', 'fl oz'].includes(canonical)
    ? { quantity, unit: canonical + modifier } : null
}

export function normalizeLibraryFood(food: MacroCustomFood): MacroCustomFood {
  const measurement = libraryMeasurement(food.baseAmount ?? '')
  if (!measurement) return food
  const baseAmount = `1 ${measurement.unit}`
  if (measurement.quantity === 1 && food.baseAmount === baseAmount) return food
  return { ...food, baseAmount, calories: food.calories / measurement.quantity,
    protein: food.protein / measurement.quantity, fat: food.fat / measurement.quantity, carbs: food.carbs / measurement.quantity }
}

/** Keep one nutrition definition, never average incompatible estimates or add their totals. */
export function normalizeFoodLibrary(foods: MacroCustomFood[], logs: Record<string, MacroDayItem[]> = {}): MacroCustomFood[] {
  const result: MacroCustomFood[] = []
  const brands = new Map<string, string>()
  for (const item of Object.values(logs).flat()) {
    for (const source of item.fatSecretResults ?? []) {
      if (source.brandName?.trim()) brands.set(source.foodId, source.brandName.trim())
    }
  }
  // A name without a product ID must not bridge two different known products.
  const productsByName = new Map<string, Set<string>>()
  for (const food of foods) {
    if (!food.sourceFoodId) continue
    const name = foodName(food.name)
    const products = productsByName.get(name) ?? new Set<string>()
    products.add(food.sourceFoodId)
    productsByName.set(name, products)
  }
  for (const original of foods) {
    let food = normalizeLibraryFood(original)
    const brand = food.sourceBrandName ?? (food.sourceFoodId ? brands.get(food.sourceFoodId) : undefined)
    if (brand && brand !== food.sourceBrandName) food = { ...food, sourceBrandName: brand }
    const existingIndex = result.findIndex(candidate =>
      (food.sourceFoodId && [candidate.sourceFoodId, ...(candidate.sourceFoodIds ?? [])].includes(food.sourceFoodId)) ||
      (foodName(candidate.name) === foodName(food.name)
        && ((productsByName.get(foodName(food.name))?.size ?? 0) <= 1
          || (food.autoAdded && candidate.autoAdded && !food.sourceBrandName && !candidate.sourceBrandName))))
    if (existingIndex < 0) { result.push(food); continue }
    const existing = result[existingIndex]
    // Prefer manually saved nutrition over automatically learned estimates.
    const preferred = existing.autoAdded && !food.autoAdded ? food : existing
    result[existingIndex] = { ...preferred,
      sourceFoodId: preferred.sourceFoodId ?? existing.sourceFoodId ?? food.sourceFoodId,
      sourceBrandName: preferred.sourceBrandName ?? existing.sourceBrandName ?? food.sourceBrandName,
      sourceFoodIds: [...new Set([existing.sourceFoodId, food.sourceFoodId, ...(existing.sourceFoodIds ?? []), ...(food.sourceFoodIds ?? [])])]
        .filter((id): id is string => Boolean(id)),
      sourceNames: [...new Set([existing.name, food.name, ...(existing.sourceNames ?? []), ...(food.sourceNames ?? [])])],
      mergedFoodIds: [...new Set([existing.id, food.id, ...(existing.mergedFoodIds ?? []), ...(food.mergedFoodIds ?? [])])]
        .filter(id => id !== preferred.id),
    }
  }
  return result.length === foods.length && result.every((food, i) => food === foods[i]) ? foods : result
}

/** Prepare once per library change; typing only scans these cached strings. */
export function indexFoodLibrary(foods: MacroCustomFood[]) {
  return foods.map(food => ({ food, names: [food.name, ...(food.sourceNames ?? [])].map(searchText) }))
}

function searchText(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ')
}

/** Literal substring matching keeps partial words useful from the first keystroke. */
export function searchFoodLibrary(index: ReturnType<typeof indexFoodLibrary>, query: string): MacroCustomFood[] {
  const text = searchText(query)
  return index.filter(entry => !text || entry.names.some(name => name.includes(text))).map(entry => entry.food)
}

/** Conservative spelling normalization; retain brands, flavors and preparation words. */
function foodName(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
    .map(word => word.length > 3 && word.endsWith('s') && !/(ss|us|is)$/.test(word) ? word.slice(0, -1) : word).join(' ')
}
function productId(item: MacroDayItem): string | undefined {
  const index = item.fromBarcode ? 1 : item.macroEstimateSnapshot?.fatSecretIndex
  return typeof index === 'number' && index >= 1 ? item.fatSecretResults?.[index - 1]?.foodId : undefined
}
function completed(item: MacroDayItem): boolean {
  return (!item.status || item.status === 'ready') && Boolean(item.name?.trim() && item.amount?.trim())
    && typeof item.calories === 'number' && Number.isFinite(item.calories) && item.calories >= 0
    && typeof item.protein === 'number' && Number.isFinite(item.protein) && item.protein >= 0
}

type Group = { key: string; food?: MacroCustomFood; product?: string; names: Set<string>; items: MacroDayItem[] }
function groupsFor(foods: MacroCustomFood[], logs: Record<string, MacroDayItem[]>): Group[] {
  const groups: Group[] = foods.map(food => ({ key: `library:${food.id}`, food,
    product: food.sourceFoodId, names: new Set([foodName(food.name), ...(food.sourceNames ?? []).map(foodName)]), items: [] }))
  const byId = new Map(groups.flatMap(group => [group.food!.id, ...(group.food!.mergedFoodIds ?? [])].map(id => [id, group] as const)))
  const entries = Object.entries(logs).sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([, items]) => items).filter(completed)
  // Learn product identities from existing linked history before matching unlinked entries.
  for (const item of entries) {
    const group = item.libraryFoodId ? byId.get(item.libraryFoodId) : undefined
    const product = productId(item)
    if (group && product && !group.product) group.product = product
  }
  const seen = new Set<string>()
  // Resolve known products first so name-only history can join an unambiguous product.
  for (const item of [...entries.filter(item => productId(item)), ...entries.filter(item => !productId(item))]) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    const product = productId(item)
    const name = foodName(item.name)
    let group = item.libraryFoodId ? byId.get(item.libraryFoodId) : undefined
    if (!group && product) group = groups.find(candidate => candidate.product === product || candidate.food?.sourceFoodIds?.includes(product))
    if (!group) {
      const matches = groups.filter(candidate => candidate.names.has(name)
        && (!product || !candidate.product || candidate.product === product))
      if (matches.length === 1) group = matches[0]
    }
    if (!group) {
      group = { key: product ? `product:${product}` : `name:${name}`, product, names: new Set(), items: [] }
      groups.push(group)
    }
    if (product && !group.product) group.product = product
    group.names.add(name)
    group.items.push(item)
  }
  return groups
}

/** Reuse a manually saved entry instead of duplicating it on every scan. */
export function findMatchingLibraryFood(foods: MacroCustomFood[], candidate: Pick<MacroCustomFood, 'name' | 'sourceFoodId'>): MacroCustomFood | undefined {
  if (candidate.sourceFoodId) {
    const exact = foods.find(food => food.sourceFoodId === candidate.sourceFoodId || food.sourceFoodIds?.includes(candidate.sourceFoodId!))
    if (exact) return exact
  }
  const matches = foods.filter(food => (!candidate.sourceFoodId || !food.sourceFoodId || food.sourceFoodId === candidate.sourceFoodId)
    && [food.name, ...(food.sourceNames ?? [])].some(name => foodName(name) === foodName(candidate.name)))
  return matches.length === 1 ? matches[0] : undefined
}

/** Include completed historical entries, regardless of scan/voice/text origin or library link. */
export function libraryUsage(foods: MacroCustomFood[], logs: Record<string, MacroDayItem[]>): Map<string, number> {
  return new Map(groupsFor(foods, logs).filter(group => group.food).map(group => [group.food!.id, group.items.length]))
}

/** Normalize/deduplicate existing foods and promote repeated completed entries.
 * Diary amounts and totals remain untouched. */
export function reconcileFoodLibrary(foods: MacroCustomFood[], logs: Record<string, MacroDayItem[]>): MacroCustomFood[] {
  foods = normalizeFoodLibrary(foods, logs)
  const additions: MacroCustomFood[] = []
  for (const group of groupsFor(foods, logs)) {
    if (group.food || group.items.length < 2) continue
    const ordered = [...group.items].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
    const item = ordered.find(item => item.fromBarcode || item.fromPackagingScan) ?? ordered[0]
    additions.push({
      id: `auto-food:${encodeURIComponent(group.key)}`,
      name: item.name.trim(), emoji: item.emoji, baseAmount: item.amount.trim(),
      calories: item.calories!, protein: item.protein!, fat: item.fat ?? 0, carbs: item.carbs ?? 0,
      createdAt: item.timestamp ?? 0, sourceFoodId: group.product,
      sourceNames: [...new Set(group.items.map(item => item.name.trim()))], autoAdded: true,
    })
  }
  return additions.length ? normalizeFoodLibrary([...foods, ...additions], logs) : foods
}
