/**
 * V6 serving audit — live PARSER + MACROS with the simplified V6 architecture.
 */
import { aiJson, macroEstimateItem } from '../../core/api'
import type { MacroCustomFood } from '../../types/domain'
import type { ParsedFoodItem } from '../../features/macro/macroLib'
import { runServingAuditV6Core, type V6RunProgress } from './servingAuditV6Core'

export type { ServingAuditV6Row } from './servingAuditLib'

export {
  downloadServingAuditV6Csv,
  servingAuditV6RowsToCsv,
} from './servingAuditLib'

const V6_CACHE_KEY = 'checkmark-serving-audit-v6'

export type { V6RunProgress }

export function loadV6Cache(): import('./servingAuditLib').ServingAuditV6Row[] | null {
  try {
    const raw = localStorage.getItem(V6_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as import('./servingAuditLib').ServingAuditV6Row[]
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveV6Cache(rows: import('./servingAuditLib').ServingAuditV6Row[]): void {
  localStorage.setItem(V6_CACHE_KEY, JSON.stringify(rows))
}

export function clearV6Cache(): void {
  localStorage.removeItem(V6_CACHE_KEY)
}

export async function rerunServingAuditV6(
  userInputs: string[],
  customFoods: MacroCustomFood[],
  onProgress?: (progress: V6RunProgress) => void,
): Promise<import('./servingAuditLib').ServingAuditV6Row[]> {
  const rows = await runServingAuditV6Core(
    userInputs,
    customFoods,
    {
      callParser: async (userInput) =>
        (await aiJson({
          promptKey: 'PARSER',
          user: `Input: ${userInput}`,
        })) as { items?: ParsedFoodItem[] },
      callMacroEstimate: macroEstimateItem,
    },
    onProgress,
  )
  saveV6Cache(rows)
  return rows
}
