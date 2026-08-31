/**
 * V8 serving audit — live PARSER + MACROS with singular/plural units,
 * relationship classification, optional AI #3 unit bridge, and code multiplier.
 */
import { buildV3RowFromTrace, type ServingAuditV8Row } from './servingAuditLib'
import { buildServingPipelineTrace } from './servingAuditTrace'
import type { MacroCustomFood } from '../../types/domain'
import type { MacroEstimateApiResult } from '../../core/api'
import type { ParsedFoodItem } from '../../features/macro/macroLib'
import { parseSnapshotFromItem } from '../../features/macro/macroLib'

export type V8RunProgress = {
  done: number
  total: number
  current?: string
}

export type ServingAuditV8Deps = {
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

function emptyV8Fields(): Pick<
  ServingAuditV8Row,
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
  | 'rawUnitBridgeJson'
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
    rawUnitBridgeJson: '',
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

function rawUnitBridgeJsonFromSnap(
  macroSnap: NonNullable<MacroEstimateApiResult['macroEstimateSnapshot']> | null | undefined,
): string {
  if (!macroSnap) return ''
  if (typeof macroSnap.rawUnitBridgeJson === 'string' && macroSnap.rawUnitBridgeJson.trim()) {
    return macroSnap.rawUnitBridgeJson
  }
  if (typeof macroSnap.unitsPerServing === 'number' && Number.isFinite(macroSnap.unitsPerServing)) {
    return JSON.stringify({ unitsPerServing: macroSnap.unitsPerServing })
  }
  return ''
}

function buildRowFromEstimate(
  userInput: string,
  item: ParsedFoodItem,
  estimate: MacroEstimateApiResult & { v7CacheHit?: boolean },
  customFoods: MacroCustomFood[],
): ServingAuditV8Row {
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
      relationship: macroSnap?.relationshipV7 ?? 'v8',
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
    rawUnitBridgeJson: rawUnitBridgeJsonFromSnap(macroSnap),
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
  deps: ServingAuditV8Deps,
): Promise<ServingAuditV8Row[]> {
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
          ...emptyV8Fields(),
        },
      ]
    }

    return Promise.all(
      items.map(async (item) => {
        const snap = parseSnapshotFromItem(item, { userInput })
        const mathUnit = snap.unitSingular?.trim() || snap.unit
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
                unit: mathUnit,
                kind: 'count',
              },
              fatSecretSearch: snap.fatSecretSearch,
              error: e instanceof Error ? e.message : String(e),
              rawParserJson: JSON.stringify(item),
            }),
            unitSingular: snap.unitSingular ?? '',
            unitPlural: snap.unitPlural ?? '',
            unitFamily: snap.unitFamily ?? item.unitFamily ?? '',
            estimated: typeof snap.estimated === 'boolean' ? String(snap.estimated) : '',
            originalPortion: snap.originalPortion ?? '',
            relationshipV7: '',
            deterministicOk: '',
            unitBridgeRan: '',
            unitBridgeQuestion: '',
            unitsPerServing: '',
            rawUnitBridgeJson: '',
            resultCalories: '',
            resultProtein: '',
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
        ...emptyV8Fields(),
      },
    ]
  }
}

export async function runServingAuditV8Core(
  userInputs: string[],
  customFoods: MacroCustomFood[],
  deps: ServingAuditV8Deps,
  onProgress?: (progress: V8RunProgress) => void,
): Promise<ServingAuditV8Row[]> {
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
