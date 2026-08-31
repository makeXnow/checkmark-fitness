/**
 * V5 — one-click rebuild of V4 cached rows through current deterministic logic.
 * No GPT, no FatSecret, no file picker.
 */
import type { ConsumptionKind, ConsumptionPortion } from '../../features/macro/macroAiSchemas'
import type { MacroCustomFood } from '../../types/domain'
import { buildServingPipelineTrace } from './servingAuditTrace'
import { buildV3RowFromTrace, type ServingAuditV3Row } from './servingAuditLib'
import { loadV4Cache } from './servingAuditV4Runner'

export type ServingAuditV5Row = ServingAuditV3Row

const V5_CACHE_KEY = 'checkmark-serving-audit-v5'

export function loadV5Cache(): ServingAuditV5Row[] | null {
  try {
    const raw = localStorage.getItem(V5_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ServingAuditV5Row[]
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveV5Cache(rows: ServingAuditV5Row[]): void {
  localStorage.setItem(V5_CACHE_KEY, JSON.stringify(rows))
}

export function clearV5Cache(): void {
  localStorage.removeItem(V5_CACHE_KEY)
}

function consumptionFromRow(row: ServingAuditV3Row): ConsumptionPortion | null {
  const qtyRaw = row.consumptionQty?.trim() ?? ''
  const unit = row.consumptionUnit?.trim() ?? ''
  const kind = (row.consumptionKind?.trim() || 'count') as ConsumptionKind
  if (!unit && !qtyRaw) return null
  const quantity = qtyRaw === '' ? null : Number(qtyRaw)
  return {
    quantity: quantity != null && Number.isFinite(quantity) ? quantity : null,
    unit: unit || 'serving',
    kind,
  }
}

/** Reprocess saved V4 (or any trace) rows with current code — same FS selections, no API. */
export function rebuildRowsFromCache(
  sourceRows: ServingAuditV3Row[],
  customFoods: MacroCustomFood[] = [],
): ServingAuditV5Row[] {
  return sourceRows.map((row) => {
    const selectedFood = row.selectedFood
    const selectedServing = row.selectedServing
    const foods = row.fatSecretResults?.length
      ? row.fatSecretResults
      : selectedFood
        ? [selectedFood]
        : []

    const macroSnap =
      selectedFood && selectedServing
        ? {
            fatSecretIndex: row.selectedFoodIndex ?? 1,
            servingIndex: row.selectedServingIndex ?? 1,
            multiplier: 1,
            relationship: (row.relationship || null) as
              | 'same_unit'
              | 'unit_conversion'
              | 'count_equivalent'
              | 'fraction_of_whole'
              | 'estimate_required'
              | 'unresolved'
              | null,
          }
        : null

    const trace = buildServingPipelineTrace({
      consumption: consumptionFromRow(row),
      userAmount: row.parsedAmount || row.userInput,
      foodName: row.parsedName,
      userInput: row.userInput,
      macroSnap,
      selectedFood,
      selectedServing,
      customFoods,
      fatSecretResults: foods,
    })

    return buildV3RowFromTrace({
      id: row.id || crypto.randomUUID(),
      userInput: row.userInput,
      parsedName: row.parsedName,
      parsedAmount: row.parsedAmount,
      consumption: trace.consumption ?? undefined,
      fatSecretSearch: row.fatSecretSearch,
      selectedFood,
      selectedFoodIndex: row.selectedFoodIndex,
      selectedServing,
      selectedServingIndex: row.selectedServingIndex,
      fatSecretResults: foods,
      macroSnap: {
        relationship: trace.relationship,
        normalizedEstimate: trace.normalizedEstimate,
      },
      dbServingQty: trace.dbServingQty ?? undefined,
      dbServingUnit: trace.dbServingUnit,
      computedMultiplier: trace.computedMultiplier,
      normalizedEstimatedLabel: trace.normalizedEstimatedLabel,
      rawParserJson: row.rawParserJson,
      rawMacrosJson: row.rawMacrosJson,
      result: trace.result
        ? {
            servingSize: trace.result.servingSize,
            servingUnit: trace.result.servingUnit,
            servingMultiplier: trace.result.servingMultiplier,
          }
        : undefined,
      error: row.error,
    })
  })
}

/** One-click: load V4 localStorage cache → rebuild with new code → save as V5. */
export function rebuildV5FromV4Cache(customFoods: MacroCustomFood[] = []): {
  rows: ServingAuditV5Row[]
  sourceCount: number
} {
  const source = loadV4Cache() ?? []
  const rows = rebuildRowsFromCache(source, customFoods)
  saveV5Cache(rows)
  return { rows, sourceCount: source.length }
}

export { downloadServingAuditV5Csv } from './servingAuditLib'
