/**
 * V4 serving audit — fixed pipeline trace instrumentation.
 * V3 is kept frozen for comparison (first trace attempt; blank architecture fields).
 */
import { buildV3RowFromTrace, type ServingAuditV3Row } from './servingAuditLib'
import { buildServingPipelineTrace } from './servingAuditTrace'
import { aiJson, macroEstimateItem } from '../../core/api'
import type { MacroCustomFood } from '../../types/domain'
import type { ParsedFoodItem } from '../../features/macro/macroLib'
import { parseSnapshotFromItem } from '../../features/macro/macroLib'

export type { ServingAuditV4Row } from './servingAuditLib'
export {
  buildV4RowFromTrace,
  downloadServingAuditV4Csv,
  servingAuditV4RowsToCsv,
} from './servingAuditLib'

const V4_CACHE_KEY = 'checkmark-serving-audit-v4'

export type V4RunProgress = {
  done: number
  total: number
  current?: string
}

type ServingAuditV4Row = ServingAuditV3Row

export function loadV4Cache(): ServingAuditV4Row[] | null {
  try {
    const raw = localStorage.getItem(V4_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ServingAuditV4Row[]
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveV4Cache(rows: ServingAuditV4Row[]): void {
  localStorage.setItem(V4_CACHE_KEY, JSON.stringify(rows))
}

export function clearV4Cache(): void {
  localStorage.removeItem(V4_CACHE_KEY)
}

export async function rerunServingAuditV4(
  userInputs: string[],
  customFoods: MacroCustomFood[],
  onProgress?: (progress: V4RunProgress) => void,
): Promise<ServingAuditV4Row[]> {
  const rows: ServingAuditV4Row[] = []
  const total = userInputs.length

  for (let i = 0; i < userInputs.length; i++) {
    const userInput = userInputs[i]!
    onProgress?.({ done: i, total, current: userInput })

    try {
      const parsed = (await aiJson({
        promptKey: 'PARSER',
        user: `Input: ${userInput}`,
      })) as { items?: ParsedFoodItem[] }

      const items = parsed.items ?? []
      if (items.length === 0) {
        rows.push(
          buildV3RowFromTrace({
            id: crypto.randomUUID(),
            userInput,
            error: 'Parser returned no items',
          }),
        )
        continue
      }

      for (const item of items) {
        const rawParserJson = JSON.stringify(item)
        const snap = parseSnapshotFromItem(item, { userInput })
        try {
          const estimate = await macroEstimateItem({
            name: snap.name,
            amount: snap.amount,
            notes: snap.notes,
            fatSecretSearch: snap.fatSecretSearch,
            parseSnapshot: snap,
            userInput,
            customFoods: customFoods.map((f) => ({
              id: f.id,
              name: f.name,
              emoji: f.emoji,
              baseAmount: f.baseAmount,
              calories: f.calories,
              protein: f.protein,
            })),
          })

          const macroSnap = estimate.macroEstimateSnapshot
          const rawMacrosJson = macroSnap ? JSON.stringify(macroSnap) : undefined
          const fsIdx =
            typeof macroSnap?.fatSecretIndex === 'number' ? macroSnap.fatSecretIndex : null
          const foods = estimate.fatSecretResults ?? []
          const selectedFood = fsIdx != null && fsIdx >= 1 ? foods[fsIdx - 1] ?? null : null
          const servIdx =
            typeof macroSnap?.servingIndex === 'number' ? macroSnap.servingIndex : null
          const selectedServing =
            selectedFood && servIdx != null && servIdx >= 1
              ? selectedFood.servings[servIdx - 1] ?? null
              : selectedFood?.servings.find((s) => s.isDefault) ?? selectedFood?.servings[0] ?? null

          const trace = buildServingPipelineTrace({
            consumption: snap.consumption,
            userAmount: snap.amount,
            foodName: snap.name,
            userInput,
            macroSnap: macroSnap ?? null,
            selectedFood,
            selectedServing,
            customFoods,
            fatSecretResults: foods,
          })

          rows.push(
            buildV3RowFromTrace({
              id: crypto.randomUUID(),
              userInput,
              parsedName: snap.name,
              parsedAmount: snap.amount,
              consumption: trace.consumption ?? undefined,
              fatSecretSearch: snap.fatSecretSearch,
              selectedFood,
              selectedFoodIndex: fsIdx,
              selectedServing,
              selectedServingIndex: servIdx,
              fatSecretResults: foods,
              macroSnap: {
                relationship: trace.relationship || macroSnap?.relationship,
                normalizedEstimate: trace.normalizedEstimate,
              },
              dbServingQty: trace.dbServingQty ?? undefined,
              dbServingUnit: trace.dbServingUnit,
              computedMultiplier: trace.computedMultiplier,
              normalizedEstimatedLabel: trace.normalizedEstimatedLabel,
              rawParserJson,
              rawMacrosJson,
              result: trace.result
                ? {
                    servingSize: trace.result.servingSize,
                    servingUnit: trace.result.servingUnit,
                    servingMultiplier: trace.result.servingMultiplier,
                  }
                : undefined,
            }),
          )
        } catch (e) {
          rows.push(
            buildV3RowFromTrace({
              id: crypto.randomUUID(),
              userInput,
              parsedName: snap.name,
              parsedAmount: snap.amount,
              consumption: snap.consumption,
              fatSecretSearch: snap.fatSecretSearch,
              error: e instanceof Error ? e.message : String(e),
            }),
          )
        }
      }
    } catch (e) {
      rows.push(
        buildV3RowFromTrace({
          id: crypto.randomUUID(),
          userInput,
          error: e instanceof Error ? e.message : String(e),
        }),
      )
    }
  }

  onProgress?.({ done: total, total })
  saveV4Cache(rows)
  return rows
}
