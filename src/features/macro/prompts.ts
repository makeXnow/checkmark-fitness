/** Profile allowed to view and edit diet AI prompts in settings. */
export const MACRO_PROMPTS_OWNER = 'alexander'

export const MACRO_PROMPT_KEYS = [
  'TRANSCRIPTION',
  'PARSER',
  'MACROS',
  'ANALYZE_FRONT',
  'ANALYZE_NUTRITION',
  'BARCODE_SCAN',
] as const

export type MacroPromptKey = (typeof MACRO_PROMPT_KEYS)[number]

export type MacroPrompts = Record<MacroPromptKey, string>

export { DIARY_EMOJI_RULES, DIARY_NAME_RULES } from './prompts.shared'

export {
  ANALYZE_FRONT_PROMPT,
  ANALYZE_NUTRITION_PROMPT,
  BARCODE_SCAN_PROMPT,
  MACROS_PROMPT,
  PARSER_PROMPT,
  TRANSCRIPTION_PROMPT,
  UNIT_BRIDGE_PROMPT,
} from './macroPromptContent'

import {
  ANALYZE_FRONT_PROMPT,
  ANALYZE_NUTRITION_PROMPT,
  BARCODE_SCAN_PROMPT,
  MACROS_PROMPT,
  PARSER_PROMPT,
  TRANSCRIPTION_PROMPT,
} from './macroPromptContent'

export const MACRO_PROMPT_LABELS: Record<MacroPromptKey, string> = {
  TRANSCRIPTION: 'Voice transcription',
  PARSER: 'Food log parser',
  MACROS: 'Macro estimate',
  ANALYZE_FRONT: 'Package front (vision)',
  ANALYZE_NUTRITION: 'Nutrition label (vision)',
  BARCODE_SCAN: 'Barcode scan',
}

export const MACRO_PROMPT_DESCRIPTIONS: Record<MacroPromptKey, string> = {
  TRANSCRIPTION: 'Guides OpenAI audio transcription when logging food by voice.',
  PARSER: 'Splits spoken or typed food input into diary items (structured JSON).',
  MACROS: 'Matches consumption to library/FatSecret, classifies relationship, optional unit bridge.',
  ANALYZE_FRONT: 'Reads product name and emoji from packaging photos.',
  ANALYZE_NUTRITION: 'Reads serving size and macros from nutrition label photos.',
  BARCODE_SCAN: 'Short diary name + emoji for barcode-matched packaged foods.',
}

export const DEFAULT_MACRO_PROMPTS: MacroPrompts = {
  TRANSCRIPTION: TRANSCRIPTION_PROMPT,
  PARSER: PARSER_PROMPT,
  MACROS: MACROS_PROMPT,
  ANALYZE_FRONT: ANALYZE_FRONT_PROMPT,
  ANALYZE_NUTRITION: ANALYZE_NUTRITION_PROMPT,
  BARCODE_SCAN: BARCODE_SCAN_PROMPT,
}

/** @deprecated Use DEFAULT_MACRO_PROMPTS; kept for imports during transition. */
export const MACRO_PROMPTS = DEFAULT_MACRO_PROMPTS

export function isMacroPromptKey(value: string): value is MacroPromptKey {
  return (MACRO_PROMPT_KEYS as readonly string[]).includes(value)
}

export function mergeMacroPrompts(partial: Partial<MacroPrompts> | null | undefined): MacroPrompts {
  const merged = { ...DEFAULT_MACRO_PROMPTS }
  if (!partial) return merged
  for (const key of MACRO_PROMPT_KEYS) {
    const text = partial[key]
    if (typeof text === 'string' && text.trim()) merged[key] = text.trim()
  }
  const legacy = partial as Record<string, unknown>
  if (typeof legacy.BARCODE_EMOJI === 'string' && legacy.BARCODE_EMOJI.trim() && !partial.BARCODE_SCAN) {
    merged.BARCODE_SCAN = legacy.BARCODE_EMOJI.trim()
  }
  return merged
}
