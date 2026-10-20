import type { MacroCustomFood, MacroDayItem } from '../../types/domain'

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
  const byId = new Map(groups.map(group => [group.food!.id, group]))
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
    if (!group && product) group = groups.find(candidate => candidate.product === product)
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
    const exact = foods.find(food => food.sourceFoodId === candidate.sourceFoodId)
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

/** Idempotent promotion after two distinct completed entries. Existing nutrition and diary
 * entries remain untouched: use the recorded portion and its totals as the new base. */
export function reconcileFoodLibrary(foods: MacroCustomFood[], logs: Record<string, MacroDayItem[]>): MacroCustomFood[] {
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
  return additions.length ? [...foods, ...additions] : foods
}
