/** Profile allowed to view and edit diet AI prompts in settings. */
export const MACRO_PROMPTS_OWNER = 'alexander'

export const MACRO_PROMPT_KEYS = [
  'TRANSCRIPTION',
  'PARSER',
  'MACROS',
  'ANALYZE_FRONT',
  'ANALYZE_NUTRITION',
] as const

export type MacroPromptKey = (typeof MACRO_PROMPT_KEYS)[number]

export type MacroPrompts = Record<MacroPromptKey, string>

export const MACRO_PROMPT_LABELS: Record<MacroPromptKey, string> = {
  TRANSCRIPTION: 'Voice transcription',
  PARSER: 'Food log parser',
  MACROS: 'Macro estimate',
  ANALYZE_FRONT: 'Package front (vision)',
  ANALYZE_NUTRITION: 'Nutrition label (vision)',
}

export const MACRO_PROMPT_DESCRIPTIONS: Record<MacroPromptKey, string> = {
  TRANSCRIPTION: 'Guides OpenAI audio transcription when logging food by voice.',
  PARSER: 'Splits spoken or typed food input into diary items (JSON).',
  MACROS: 'Estimates calories/protein from library, FatSecret, or direct AI.',
  ANALYZE_FRONT: 'Reads product name and emoji from packaging photos.',
  ANALYZE_NUTRITION: 'Reads serving size and macros from nutrition label photos.',
}

export const DEFAULT_MACRO_PROMPTS: MacroPrompts = {
  TRANSCRIPTION: `Transcribe the audio provided exactly as spoken. Do not add any conversational filler. Only return the transcription text.`,
  PARSER: `You are a culinary transcriptionist. Split the input into separate food items the user ate.

NAMING RULES (for "name" — short diary label):
1. Keep names very short (ideal < 15 characters, max 25).
2. Only include brand in "name" if nutrition varies significantly between brands (e.g., "Quest Bar", "ON Whey").
3. Exclude brand for generic items (e.g., "Jasmine Rice" not "Mahatma Jasmine Rice").

FATSECRET SEARCH (for "fatSecretSearch"):
- A search query optimized for the FatSecret food database.
- Include brand name when the user mentioned a brand or it is clearly a branded product (e.g., "Chobani Flip yogurt", "Quest chocolate chip bar").
- Can be slightly longer and more specific than "name".
- For generic foods, a simple query is fine (e.g., "banana", "jasmine rice cooked").

SERVING RULES:
- "amount" is the human-readable serving exactly as the user would say it (e.g., "2", "1 slice", "handful", "1").
- Put extra context, comparisons, or stated nutrition in "notes". Use "" if none.
- Do not put notes content into "amount".

Handle self-corrections. JSON only:
{ "items": [{ "emoji": "...", "name": "...", "amount": "...", "notes": "...", "fatSecretSearch": "..." }] }`,
  MACROS: `You estimate calories and protein for one food serving.

Priority (first match wins):
1. If Notes contain explicit calories and/or protein the user stated, use those (libraryIndex null, fatSecretIndex null, return calories and protein).
2. If FOOD LIBRARY match: libraryIndex (1-based) + multiplier. Do not guess calories/protein.
3. If FATSECRET RESULTS match: fatSecretIndex (1-based food), servingIndex (1-based serving for that food), multiplier. Do not guess calories/protein.
4. Otherwise: libraryIndex null, fatSecretIndex null, return calories, protein, servingType, and multiplier.

LIBRARY / FATSECRET RULES:
- Only match when the item is essentially the same product — not a shared ingredient (e.g. "orange chicken" ≠ library "chicken").

SERVING TYPE (servingType):
- Short unit label for ONE base portion (e.g. "can", "cup", "slice", "tbsp", "serving", "1 pouch").
- Pick the most appropriate unit from nutrition facts, FatSecret, notes, or context.
- Required for direct AI estimates (path 4). Omit for library/FatSecret matches — the app derives it.

MULTIPLIER:
- How many of the chosen base serving the user's portion represents (2 for two cookies, 0.8 for four-fifths of a can, 1.25 for a large handful vs "1 oz").

JSON only. Examples:
{ "libraryIndex": 3, "multiplier": 2 }
{ "fatSecretIndex": 2, "servingIndex": 1, "multiplier": 1 }
{ "libraryIndex": null, "fatSecretIndex": null, "calories": 180, "protein": 6, "servingType": "can", "multiplier": 1 }`,
  ANALYZE_FRONT: `Analyze this food packaging front label.
  NAMING RULES:
  1. Extract a concise product name (ideal < 15 characters, max 25).
  2. Only include brand if it defines the product's unique profile.
  3. Simplify generic or common items.
  Also extract a single appropriate emoji. Return JSON exactly: { "name": "...", "emoji": "..." }`,
  ANALYZE_NUTRITION: `Analyze this nutrition label. Extract standard base serving size (e.g., '1 pouch', '100g'), and nutrition facts for that EXACT base serving size. Return JSON exactly: { "baseAmount": "...", "calories": n, "protein": n, "fat": n, "carbs": n }`,
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
  return merged
}
