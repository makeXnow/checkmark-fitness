import type { MacroCustomFood, MacroDayItem } from '../../types/domain'
import type { MacroEstimateApiResult } from '../../core/api'
import { formatServingDisplay, normalizeDiaryLabel } from './macroLib'
/** The server stores exactly the same completed entry that the tracker displays. */
export function applyEstimateResult(item: MacroDayItem, result: MacroEstimateApiResult, foods: MacroCustomFood[], userPick=false, skipFs=false): MacroDayItem {
  const library = result.libraryFoodId ? foods.find(f=>f.id===result.libraryFoodId) : undefined
  return {
    ...item,
    ...(library ? normalizeDiaryLabel({name:library.name,emoji:library.emoji,fallbackName:library.name,fallbackEmoji:library.emoji}) : {}),
    calories:result.calories,protein:result.protein,libraryFoodId:result.libraryFoodId,
    servingType:result.servingType,servingSize:result.servingSize,servingUnit:result.servingUnit,
    servingMultiplier:result.servingMultiplier,baseCalories:result.baseCalories,baseProtein:result.baseProtein,
    amount:result.servingType!=null ? formatServingDisplay(result.servingMultiplier ?? 1,result.servingType) : item.amount,
    fatSecretResults:result.fatSecretResults,macroEstimateSnapshot:result.macroEstimateSnapshot ?? item.macroEstimateSnapshot,
    ...(userPick ? {userConfirmedMatch:skipFs ? undefined : true} : {}),estimateError:undefined,status:'ready',
  }
}
