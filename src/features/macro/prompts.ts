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

/** Shared short-name rules for parser, packaging vision, and barcode scan. */
export const DIARY_NAME_RULES = `NAMING RULES (for "name" — short diary label):
1. Keep names very short (ideal < 15 characters, max 25).
2. Only include brand in "name" if nutrition varies significantly between brands (e.g., "Quest Bar", "Barebells Key Lime").
3. Exclude brand for generic items (e.g., "Jasmine Rice" not "Mahatma Jasmine Rice").`

export const DIARY_EMOJI_RULES = `EMOJI:
- One emoji matching the food (flavor, category, form), not the brand logo.
- Prefer specific over generic when obvious (e.g. 🥧 for key lime pie bar, 🍫 for chocolate protein bar).`

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
  PARSER: 'Splits spoken or typed food input into diary items (JSON).',
  MACROS: 'Estimates calories/protein from library, FatSecret, or direct AI.',
  ANALYZE_FRONT: 'Reads product name and emoji from packaging photos.',
  ANALYZE_NUTRITION: 'Reads serving size and macros from nutrition label photos.',
  BARCODE_SCAN: 'Short diary name + emoji for barcode-matched packaged foods.',
}

export const DEFAULT_MACRO_PROMPTS: MacroPrompts = {
  TRANSCRIPTION: `Transcribe the audio provided exactly as spoken. Do not add any conversational filler. Only return the transcription text.`,
  PARSER: `You are a culinary transcriptionist. Split the input into separate food items the user ate.

${DIARY_NAME_RULES}

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
2. If FOOD LIBRARY match: libraryIndex (1-based). Do not guess calories/protein.
3. If FATSECRET RESULTS match: fatSecretIndex (1-based food), servingIndex (1-based serving). Do not guess calories/protein.
4. Otherwise: libraryIndex null, fatSecretIndex null, return calories, protein, servingType, and multiplier.

RESOLVED AMOUNT (always required — include in every response):
Output "resolvedAmount" — the user's actual portion as a machine-readable "<number> <unit>" string.
Rules:
- Use the user's exact unit when clearly stated: count noun in singular form ("gummy" not "gummies", "slice" not "slices", "sandwich" not "sandwiches", "egg" not "eggs"), or a standard measure ("oz", "g", "lb", "ml", "cup", "tbsp", "tsp").
- For FatSecret count-based matches (e.g. serving line "7 candies", "3 pieces"), use the FatSecret serving's own unit word in singular form ("candy" not "gummy", "piece" not "nugget") so the app can match quantities precisely.
- For fractions/halves: use decimal form ("0.5 sandwich" not "half sandwich", "1.5 cup" not "one and a half cups").
- For vague portions ("small handful", "a few", "large plate", "some") AND for specific count items when the selected FatSecret serving is gram/oz-based with no count equivalent (e.g., user says "3 fish sticks" but FS only has "100g", user says "1 medium apple" but FS only has "100g"): estimate the total weight in grams (e.g., "84 g" for 3 fish sticks, "182 g" for 1 medium apple). The mass path handles the multiplier math.
- The app uses resolvedAmount to compute the DB multiplier — do NOT compute multiplier yourself for library or FatSecret matches.
- Examples: "6 gummy", "4 oz", "0.5 sandwich", "2 slice", "25 g", "1 serving", "1.5 cup", "3 egg", "100 g", "1 bar", "84 g" (for 3 fish sticks vs gram-only FS)

SERVINGINDEX SELECTION FOR FATSECRET MATCHES:
- Choose the servingIndex whose unit best matches the resolvedAmount unit type.
- resolvedAmount in grams or ounces → prefer a gram or oz-based DB serving line.
- resolvedAmount in count ("6 gummy") → prefer a count-based DB serving line ("3 gummies").
- resolvedAmount in cups/tbsp → prefer a volume-based DB serving line.

USER-CONFIRMED FATSECRET (when the prompt says so, or only one FatSecret result is listed):
- Treat that food as the match. Use fatSecretIndex 1, pick the best servingIndex for the unit type. Do not use library or direct AI estimate instead.

USER-REJECTED FATSECRET (when the prompt says the user rejected database matches):
- Do not use FatSecret. Use direct AI estimate only (libraryIndex null, fatSecretIndex null, return calories, protein, servingType, multiplier).

LIBRARY / FATSECRET RULES:
- Only match when the item is essentially the same product — not a shared ingredient (e.g. "orange chicken" ≠ library "chicken").

SERVING TYPE (servingType) — direct AI estimates (path 4) only:
- Short unit label for ONE base portion (e.g. "can", "cup", "slice", "tbsp", "serving", "1 pouch").
- Pick the most appropriate unit from nutrition facts, context, or resolvedAmount unit.

MULTIPLIER — direct AI estimates (path 4) only:
- How many of the chosen base serving the user's portion represents.
- For ALL library and FatSecret matches: always set to 1 — the app computes the correct value from resolvedAmount. Never compute or adjust the multiplier for library/FatSecret matches, even if you think you know the right value.

JSON only. Examples:
{ "libraryIndex": 3, "resolvedAmount": "2 serving", "multiplier": 1 }
{ "fatSecretIndex": 2, "servingIndex": 1, "resolvedAmount": "6 gummy", "multiplier": 1 }
{ "fatSecretIndex": 1, "servingIndex": 2, "resolvedAmount": "4 oz", "multiplier": 1 }
{ "fatSecretIndex": 1, "servingIndex": 1, "resolvedAmount": "25 g", "multiplier": 1 }
{ "libraryIndex": null, "fatSecretIndex": null, "calories": 180, "protein": 6, "servingType": "can", "resolvedAmount": "1 can", "multiplier": 1 }
{ "libraryIndex": null, "fatSecretIndex": null, "calories": 143, "protein": 5, "servingType": "g", "resolvedAmount": "25 g", "multiplier": 25 }`,
  ANALYZE_FRONT: `Analyze this food packaging front label.

${DIARY_NAME_RULES}

Also extract a single appropriate emoji. Return JSON exactly: { "name": "...", "emoji": "..." }`,
  ANALYZE_NUTRITION: `Analyze this nutrition label. Extract standard base serving size (e.g., '1 pouch', '100g'), and nutrition facts for that EXACT base serving size. Return JSON exactly: { "baseAmount": "...", "calories": n, "protein": n, "fat": n, "carbs": n }`,
  BARCODE_SCAN: `You label barcode-scanned foods for a diet diary. Use the database product details in the user message.

${DIARY_NAME_RULES}

${DIARY_EMOJI_RULES}

JSON only: { "name": "...", "emoji": "..." }`,
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
