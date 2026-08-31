import { aiJson, macroEstimateItem } from '../../core/api'
import type { MacroCustomFood } from '../../types/domain'
import type { ParsedFoodItem } from '../../features/macro/macroLib'
import { parseSnapshotFromItem } from '../../features/macro/macroLib'
import { buildV2RowFromEstimate, type ServingAuditV2Row } from './servingAuditLib'

const V2_CACHE_KEY = 'checkmark-serving-audit-v2'

export type V2RunProgress = {
  done: number
  total: number
  current?: string
}

export function loadV2Cache(): ServingAuditV2Row[] | null {
  try {
    const raw = localStorage.getItem(V2_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ServingAuditV2Row[]
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveV2Cache(rows: ServingAuditV2Row[]): void {
  localStorage.setItem(V2_CACHE_KEY, JSON.stringify(rows))
}

export function clearV2Cache(): void {
  localStorage.removeItem(V2_CACHE_KEY)
}

export async function rerunServingAuditV2(
  userInputs: string[],
  customFoods: MacroCustomFood[],
  onProgress?: (progress: V2RunProgress) => void,
): Promise<ServingAuditV2Row[]> {
  const rows: ServingAuditV2Row[] = []
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
        rows.push({
          id: crypto.randomUUID(),
          userInput,
          parsedName: '—',
          parsedAmount: '—',
          selectedFood: null,
          selectedFoodIndex: null,
          selectedServing: null,
          selectedServingIndex: null,
          fatSecretResults: [],
          fsOriginalServing: '—',
          result: null,
          error: 'Parser returned no items',
        })
        continue
      }

      for (const item of items) {
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

          rows.push(
            buildV2RowFromEstimate(
              userInput,
              snap.name,
              snap.amount,
              {
                servingSize: estimate.servingSize,
                servingUnit: estimate.servingUnit,
                servingMultiplier: estimate.servingMultiplier,
                fatSecretResults: estimate.fatSecretResults,
                macroEstimateSnapshot: estimate.macroEstimateSnapshot,
              },
              crypto.randomUUID(),
            ),
          )
        } catch (e) {
          rows.push({
            id: crypto.randomUUID(),
            userInput,
            parsedName: snap.name,
            parsedAmount: snap.amount,
            selectedFood: null,
            selectedFoodIndex: null,
            selectedServing: null,
            selectedServingIndex: null,
            fatSecretResults: [],
            fsOriginalServing: '—',
            result: null,
            error: e instanceof Error ? e.message : String(e),
          })
        }
      }
    } catch (e) {
      rows.push({
        id: crypto.randomUUID(),
        userInput,
        parsedName: '—',
        parsedAmount: '—',
        selectedFood: null,
        selectedFoodIndex: null,
        selectedServing: null,
        selectedServingIndex: null,
        fatSecretResults: [],
        fsOriginalServing: '—',
        result: null,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  onProgress?.({ done: total, total })
  saveV2Cache(rows)
  return rows
}
