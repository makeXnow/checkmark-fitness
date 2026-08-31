/**
 * V7 serving audit — live PARSER + MACROS with relationship classification + code multiplier.
 */
import { buildV3RowFromTrace, type ServingAuditV7Row } from './servingAuditLib'
import { buildServingPipelineTrace } from './servingAuditTrace'
import type { MacroCustomFood } from '../../types/domain'
import type { MacroEstimateApiResult } from '../../core/api'
import type { ParsedFoodItem } from '../../features/macro/macroLib'
import { parseSnapshotFromItem } from '../../features/macro/macroLib'

export type V7RunProgress = {
  done: number
  total: number
  current?: string
}

export type ServingAuditV7Deps = {
  callParser: (userInput: string) => Promise<{ items?: ParsedFoodItem[] }>
  callMacroEstimate: (body: {
    name: string
    amount: string
    notes?: string
    fatSecretSearch?: string
    parseSnapshot: ReturnType<typeof parseSnapshotFromItem>
    userInput: string
    customFoods: MacroCustomFoodPayload[]
  }) => Promise<MacroEstimateApiResult & { v7CacheHit?: boolean }>
}

type MacroCustomFoodPayload = {
  id: string
  name: string
  emoji?: string
  baseAmount?: string
  calories: number
  protein: number
}

const INPUT_CONCURRENCY = 5

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workerCount = Math.min(concurrency, items.length)
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const i = nextIndex++
        if (i >= items.length) break
        results[i] = await fn(items[i]!, i)
      }
    }),
  )
  return results
}

function emptyV7Fields(): Pick<
  ServingAuditV7Row,
  'unitFamily' | 'estimated' | 'originalPortion' | 'relationshipV7' | 'cacheHit' | 'fatSecretResultCount'
> {
  return {
    unitFamily: '',
    estimated: '',
    originalPortion: '',
    relationshipV7: '',
    cacheHit: '',
    fatSecretResultCount: '',
  }
}

function buildRowFromEstimate(
  userInput: string,
  item: ParsedFoodItem,
  estimate: MacroEstimateApiResult & { v7CacheHit?: boolean },
  customFoods: MacroCustomFood[],
): ServingAuditV7Row {
  const rawParserJson = JSON.stringify(item)
  const snap = parseSnapshotFromItem(item, { userInput })
  const macroSnap = estimate.macroEstimateSnapshot
  const rawMacrosJson = macroSnap ? JSON.stringify(macroSnap) : undefined
  const fsIdx = typeof macroSnap?.fatSecretIndex === 'number' ? macroSnap.fatSecretIndex : null
  const foods = estimate.fatSecretResults ?? []
  const selectedFood = fsIdx != null && fsIdx >= 1 ? foods[fsIdx - 1] ?? null : null
  const servIdx = typeof macroSnap?.servingIndex === 'number' ? macroSnap.servingIndex : null
  const selectedServing =
    selectedFood && servIdx != null && servIdx >= 1
      ? selectedFood.servings[servIdx - 1] ?? null
      : selectedFood?.servings.find((s) => s.isDefault) ?? selectedFood?.servings[0] ?? null

  const trace = buildServingPipelineTrace({
    quantity: snap.quantity,
    unit: snap.unit,
    userAmount: snap.amount,
    foodName: snap.name,
    userInput,
    macroSnap: macroSnap ?? null,
    selectedFood,
    selectedServing,
    customFoods,
    fatSecretResults: foods,
  })

  const base = buildV3RowFromTrace({
    id: crypto.randomUUID(),
    userInput,
    parsedName: snap.name,
    parsedAmount: snap.amount,
    consumption: {
      quantity: snap.quantity,
      unit: snap.unit,
      kind: 'count',
    },
    fatSecretSearch: snap.fatSecretSearch,
    selectedFood,
    selectedFoodIndex: fsIdx,
    selectedServing,
    selectedServingIndex: servIdx,
    fatSecretResults: foods,
    macroSnap: {
      relationship: macroSnap?.relationshipV7 ?? 'v7',
      normalizedEstimate: null,
    },
    dbServingQty: trace.dbServingQty ?? undefined,
    dbServingUnit: trace.dbServingUnit,
    computedMultiplier:
      typeof macroSnap?.multiplier === 'number'
        ? macroSnap.multiplier
        : trace.aiMultiplier,
    rawParserJson,
    rawMacrosJson,
    result: trace.result
      ? {
          servingSize: trace.result.servingSize,
          servingUnit: trace.result.servingUnit,
          servingMultiplier: trace.result.servingMultiplier,
        }
      : undefined,
  })

  return {
    ...base,
    unitFamily: snap.unitFamily ?? item.unitFamily ?? '',
    estimated: typeof snap.estimated === 'boolean' ? String(snap.estimated) : typeof item.estimated === 'boolean' ? String(item.estimated) : '',
    originalPortion: snap.originalPortion ?? item.originalPortion ?? '',
    relationshipV7: macroSnap?.relationshipV7 ?? '',
    cacheHit: estimate.v7CacheHit ? 'yes' : 'no',
    fatSecretResultCount: String(foods.length),
  }
}

async function processUserInput(
  userInput: string,
  customFoods: MacroCustomFood[],
  customFoodsPayload: MacroCustomFoodPayload[],
  deps: ServingAuditV7Deps,
): Promise<ServingAuditV7Row[]> {
  try {
    const parsed = await deps.callParser(userInput)
    const items = parsed.items ?? []
    if (items.length === 0) {
      return [
        {
          ...buildV3RowFromTrace({
            id: crypto.randomUUID(),
            userInput,
            error: 'Parser returned no items',
          }),
          ...emptyV7Fields(),
        },
      ]
    }

    return Promise.all(
      items.map(async (item) => {
        const snap = parseSnapshotFromItem(item, { userInput })
        try {
          const estimate = await deps.callMacroEstimate({
            name: snap.name,
            amount: snap.amount,
            notes: snap.notes,
            fatSecretSearch: snap.fatSecretSearch,
            parseSnapshot: snap,
            userInput,
            customFoods: customFoodsPayload,
          })
          return buildRowFromEstimate(userInput, item, estimate, customFoods)
        } catch (e) {
          return {
            ...buildV3RowFromTrace({
              id: crypto.randomUUID(),
              userInput,
              parsedName: snap.name,
              parsedAmount: snap.amount,
              consumption: {
                quantity: snap.quantity,
                unit: snap.unit,
                kind: 'count',
              },
              fatSecretSearch: snap.fatSecretSearch,
              error: e instanceof Error ? e.message : String(e),
              rawParserJson: JSON.stringify(item),
            }),
            unitFamily: snap.unitFamily ?? item.unitFamily ?? '',
            estimated: typeof snap.estimated === 'boolean' ? String(snap.estimated) : '',
            originalPortion: snap.originalPortion ?? '',
            relationshipV7: '',
            cacheHit: '',
            fatSecretResultCount: '',
          }
        }
      }),
    )
  } catch (e) {
    return [
      {
        ...buildV3RowFromTrace({
          id: crypto.randomUUID(),
          userInput,
          error: e instanceof Error ? e.message : String(e),
        }),
        ...emptyV7Fields(),
      },
    ]
  }
}

export async function runServingAuditV7Core(
  userInputs: string[],
  customFoods: MacroCustomFood[],
  deps: ServingAuditV7Deps,
  onProgress?: (progress: V7RunProgress) => void,
): Promise<ServingAuditV7Row[]> {
  const total = userInputs.length
  let done = 0

  const customFoodsPayload = customFoods.map((f) => ({
    id: f.id,
    name: f.name,
    emoji: f.emoji,
    baseAmount: f.baseAmount,
    calories: f.calories,
    protein: f.protein,
  }))

  const rowGroups = await mapWithConcurrency(userInputs, INPUT_CONCURRENCY, async (userInput) => {
    onProgress?.({ done, total, current: userInput })
    const rows = await processUserInput(userInput, customFoods, customFoodsPayload, deps)
    done++
    onProgress?.({ done, total, current: userInput })
    return rows
  })

  onProgress?.({ done: total, total })
  return rowGroups.flat()
}
