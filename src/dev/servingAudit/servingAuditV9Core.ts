/**
 * V9 serving audit — live PARSER + MACROS with annotated candidates,
 * optional AI #2 unit bridge fields, relationship retry, and code multiplier.
 * No AI #3.
 */
import { buildV3RowFromTrace, type ServingAuditV9Row } from './servingAuditLib'
import { buildServingPipelineTrace } from './servingAuditTrace'
import type { MacroCustomFood } from '../../types/domain'
import type { MacroEstimateApiResult } from '../../core/api'
import type { ParsedFoodItem } from '../../features/macro/macroLib'
import { parseSnapshotFromItem } from '../../features/macro/macroLib'

export type V9RunProgress = {
  done: number
  total: number
  current?: string
}

export type ServingAuditV9Deps = {
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

function emptyV9Fields(): Pick<
  ServingAuditV9Row,
  | 'unitSingular'
  | 'unitPlural'
  | 'unitFamily'
  | 'estimated'
  | 'originalPortion'
  | 'relationshipV7'
  | 'deterministicOk'
  | 'unitBridgeRan'
  | 'unitBridgeQuestion'
  | 'unitsPerServing'
  | 'relationshipRetryRan'
  | 'rawMacrosPass1Json'
  | 'rawMacrosPass2Json'
  | 'rawMacrosRetryJson'
  | 'candidateAnnotationsJson'
  | 'libraryIndex'
  | 'fatSecretIndex'
  | 'servingIndex'
  | 'resultCalories'
  | 'resultProtein'
  | 'cacheHit'
  | 'fatSecretResultCount'
> {
  return {
    unitSingular: '',
    unitPlural: '',
    unitFamily: '',
    estimated: '',
    originalPortion: '',
    relationshipV7: '',
    deterministicOk: '',
    unitBridgeRan: '',
    unitBridgeQuestion: '',
    unitsPerServing: '',
    relationshipRetryRan: '',
    rawMacrosPass1Json: '',
    rawMacrosPass2Json: '',
    rawMacrosRetryJson: '',
    candidateAnnotationsJson: '',
    libraryIndex: '',
    fatSecretIndex: '',
    servingIndex: '',
    resultCalories: '',
    resultProtein: '',
    cacheHit: '',
    fatSecretResultCount: '',
  }
}

function boolLabel(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  return ''
}

function idxLabel(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : ''
}

function buildRowFromEstimate(
  userInput: string,
  item: ParsedFoodItem,
  estimate: MacroEstimateApiResult & { v7CacheHit?: boolean },
  customFoods: MacroCustomFood[],
): ServingAuditV9Row {
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

  const mathUnit = snap.unitSingular?.trim() || snap.unit
  const trace = buildServingPipelineTrace({
    quantity: snap.quantity,
    unit: mathUnit,
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
      unit: mathUnit,
      kind: 'count',
    },
    fatSecretSearch: snap.fatSecretSearch,
    selectedFood,
    selectedFoodIndex: fsIdx,
    selectedServing,
    selectedServingIndex: servIdx,
    fatSecretResults: foods,
    macroSnap: {
      relationship: macroSnap?.relationshipV7 ?? 'v9',
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
    unitSingular: snap.unitSingular ?? item.unitSingular ?? '',
    unitPlural: snap.unitPlural ?? item.unitPlural ?? '',
    unitFamily: snap.unitFamily ?? item.unitFamily ?? '',
    estimated:
      typeof snap.estimated === 'boolean'
        ? String(snap.estimated)
        : typeof item.estimated === 'boolean'
          ? String(item.estimated)
          : '',
    originalPortion: snap.originalPortion ?? item.originalPortion ?? '',
    relationshipV7: macroSnap?.relationshipV7 ?? '',
    deterministicOk: boolLabel(macroSnap?.deterministicOk),
    unitBridgeRan: boolLabel(macroSnap?.unitBridgeRan),
    unitBridgeQuestion: macroSnap?.unitBridgeQuestion ?? '',
    unitsPerServing:
      typeof macroSnap?.unitsPerServing === 'number' && Number.isFinite(macroSnap.unitsPerServing)
        ? String(macroSnap.unitsPerServing)
        : '',
    relationshipRetryRan: boolLabel(macroSnap?.relationshipRetryRan),
    rawMacrosPass1Json: macroSnap?.rawMacrosPass1Json ?? '',
    rawMacrosPass2Json: macroSnap?.rawMacrosPass2Json ?? '',
    rawMacrosRetryJson: macroSnap?.rawMacrosRetryJson ?? '',
    candidateAnnotationsJson: macroSnap?.candidateAnnotationsJson ?? '',
    libraryIndex: idxLabel(macroSnap?.libraryIndex),
    fatSecretIndex: idxLabel(macroSnap?.fatSecretIndex),
    servingIndex: idxLabel(macroSnap?.servingIndex),
    resultCalories: Number.isFinite(estimate.calories) ? String(estimate.calories) : '',
    resultProtein: Number.isFinite(estimate.protein) ? String(estimate.protein) : '',
    cacheHit: estimate.v7CacheHit ? 'yes' : 'no',
    fatSecretResultCount: String(foods.length),
  }
}

async function processUserInput(
  userInput: string,
  customFoods: MacroCustomFood[],
  customFoodsPayload: MacroCustomFoodPayload[],
  deps: ServingAuditV9Deps,
): Promise<ServingAuditV9Row[]> {
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
          ...emptyV9Fields(),
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
              fatSecretSearch: snap.fatSecretSearch,
              rawParserJson: JSON.stringify(item),
              error: e instanceof Error ? e.message : String(e),
            }),
            ...emptyV9Fields(),
            unitSingular: snap.unitSingular ?? '',
            unitPlural: snap.unitPlural ?? '',
            unitFamily: snap.unitFamily ?? '',
            estimated: typeof snap.estimated === 'boolean' ? String(snap.estimated) : '',
            originalPortion: snap.originalPortion ?? '',
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
        ...emptyV9Fields(),
      },
    ]
  }
}

export async function runServingAuditV9Core(
  userInputs: string[],
  customFoods: MacroCustomFood[],
  deps: ServingAuditV9Deps,
  onProgress?: (p: V9RunProgress) => void,
): Promise<ServingAuditV9Row[]> {
  const customFoodsPayload: MacroCustomFoodPayload[] = customFoods.map((f) => ({
    id: f.id,
    name: f.name,
    emoji: f.emoji,
    baseAmount: f.baseAmount,
    calories: f.calories,
    protein: f.protein,
  }))

  let done = 0
  const total = userInputs.length
  const nested = await mapWithConcurrency(userInputs, INPUT_CONCURRENCY, async (userInput) => {
    onProgress?.({ done, total, current: userInput })
    const rows = await processUserInput(userInput, customFoods, customFoodsPayload, deps)
    done += 1
    onProgress?.({ done, total, current: userInput })
    return rows
  })
  return nested.flat()
}
