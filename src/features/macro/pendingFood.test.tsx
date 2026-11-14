import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { MacroVoiceTracker } from './MacroVoiceTracker'
import type { MacroDayItem } from '../../types/domain'

it('renders an editable pending food with a separate enabled delete button', () => {
  const html = renderToStaticMarkup(<MacroVoiceTracker
    dateKey="2026-11-11" goals={{ calorieGoal: 2000, proteinPctGoal: 30 }}
    logs={{ '2026-11-11': [{ id: 'beans', name: 'Green Beans', amount: '5 oz', status: 'pending' } as MacroDayItem] }}
    customFoods={[]} onSaveLogs={() => {}} onSaveFoods={() => {}}
  />)
  expect(html).toContain('Estimating… Tap to edit')
  expect(html).toMatch(/<button[^>]*aria-label="Delete food entry"[^>]*>/)
  expect(html.match(/<button[^>]*aria-label="Delete food entry"[^>]*>/)?.[0]).not.toContain('disabled')
})
