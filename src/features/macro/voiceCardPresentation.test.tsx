import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { VoiceJob } from './useVoiceInbox'
import { MacroVoiceTracker } from './MacroVoiceTracker'

const jobs:VoiceJob[]=[]
vi.mock('./useVoiceInbox',()=>({useVoiceInbox:()=>({jobs})}))

it('renders each server split with the existing editable pending food row',()=>{
  jobs.push({id:'voice',phase:'estimating',foods:[
    {id:'voice-0',name:'Chicken Breast',amount:'5 oz',emoji:'🍗'},
    {id:'voice-1',name:'Rice',amount:'1 cup',emoji:'🍚'},
  ]})
  const html=renderToStaticMarkup(<MacroVoiceTracker dateKey="2026-11-20" goals={{calorieGoal:2000,proteinPctGoal:30}}
    logs={{}} customFoods={[]} onSaveLogs={()=>{}} onSaveFoods={()=>{}} />)
  expect(html).toContain('Chicken Breast')
  expect(html).toContain('Rice')
  expect(html.match(/Estimating… Tap to edit/g)).toHaveLength(2)
  expect(html.match(/aria-label="Delete food entry"/g)).toHaveLength(2)
  expect(html).not.toContain('Calculating nutrition…')
  const foods=jobs.pop()!.foods!.map(food=>({...food,status:'pending' as const}))
  const ordinary=renderToStaticMarkup(<MacroVoiceTracker dateKey="2026-11-20" goals={{calorieGoal:2000,proteinPctGoal:30}}
    logs={{'2026-11-20':foods}} customFoods={[]} onSaveLogs={()=>{}} onSaveFoods={()=>{}} />)
  const diary=(markup:string)=>markup.match(/<section class="space-y-3">[\s\S]*?<\/section>/)?.[0]
  expect(diary(html)).toBe(diary(ordinary))
})
