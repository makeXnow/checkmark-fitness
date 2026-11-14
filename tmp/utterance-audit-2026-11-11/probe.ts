import fs from 'node:fs'
import {resolveMacroEstimate,macrosForServingCount} from '../../src/features/macro/macroLib'
import {resolvePackagingAmount} from '../../src/features/macro/packagingScan'
import {parseStatedNutrition,applyStatedNutrition} from '../../src/features/macro/macroStatedNutrition'
import {computeV8Multiplier} from '../../src/features/macro/macroV8Resolve'
const result=resolveMacroEstimate({libraryIndex:1,multiplier:180/139,relationshipV7:'DIRECT'},[{id:'x',name:'Grilled Chicken',baseAmount:'139 g',calories:228,protein:42.8,fat:0,carbs:0}],[],{quantity:180,unit:'g',userAmount:'180 g',foodName:'Grilled Chicken'})
const notes='170 calories per serving, 680 calories total'
const out={precision:{initial:result,afterSameQuantity:macrosForServingCount(result.baseCalories!,result.baseProtein!,180)},percentage:resolvePackagingAmount('70% of the whole thing'),stated:{notes,parsed:parseStatedNutrition(notes),result:applyStatedNutrition(parseStatedNutrition(notes)!,{quantity:4,unit:'serving',unitFamily:'serving'})},hedged:parseStatedNutrition('I think 280 calories, maybe 350 calories'),genericServingVsPieces:computeV8Multiplier({quantity:1,unit:'serving',servingDescription:'21 pieces',relationship:'EQUIVALENT_COUNT'}),haloSameBasis:computeV8Multiplier({quantity:5,unit:'serving',servingDescription:'2/3 cup (87 g)',relationship:'NEEDS_UNIT_BRIDGE',unitsPerServing:3})}
fs.writeFileSync('tmp/utterance-audit-2026-11-11/current-code-probes.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2))
