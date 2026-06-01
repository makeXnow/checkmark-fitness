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
3. Exclude brand for generic items (e.g., "Jasmine Rice" not "Mahatma Jasmine Rice").
4. Put emoji only in "emoji", never in "name" (no leading emoji in the name field).`

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

RESOLVED PORTION (always required — include BOTH fields in every response):
Output two separate JSON fields for the user's actual portion:
- "resolvedQty": the amount as a JSON number (e.g. 6, 4, 0.5, 25, 2, 1, 1.5, 84)
- "resolvedUnit": the unit as a single lowercase singular word (e.g. "gummy", "oz", "g", "sandwich", "slice", "cracker", "cup", "tbsp")

Rules for resolvedUnit:
- Use the user's exact unit in singular form ("gummy" not "gummies", "slice" not "slices", "egg" not "eggs").
- When the user's amount is a bare number with no stated unit (e.g., "2") and FatSecret has a count-based serving (e.g., "12 crackers", "4 nuggets"), set resolvedUnit to the FS item's singular noun — NOT "serving". Example: amount "2" + FS "12 crackers" → resolvedQty: 2, resolvedUnit: "cracker".
- For FatSecret count-based matches (e.g. serving "7 candies", "3 pieces"), use the FS serving's own unit in singular form ("candy" not "gummy", "piece" not "nugget") so the app can match quantities precisely.
- For fractions/halves: resolvedQty is the decimal (0.5 for "half", 1.5 for "one and a half").
- For vague portions ("small handful", "a few", "large plate", "some") AND for specific count items where the selected FatSecret serving is gram/oz-based with no count equivalent (e.g. user says "3 fish sticks" but FS only has "100g", user says "1 medium apple" but FS only has "100g"): set resolvedQty to estimated total grams and resolvedUnit to "g". The mass path handles the multiplier math.
- Only use "serving" as resolvedUnit when the food is a whole packaged item where "1 serving" is the natural description (e.g. a protein bar, a can of soup).
- Standard measures: "oz", "g", "lb", "ml", "cup", "tbsp", "tsp".
- The app uses resolvedQty + resolvedUnit to compute the DB multiplier — do NOT compute it yourself for library or FatSecret matches.

SERVINGINDEX SELECTION FOR FATSECRET MATCHES:
- Choose the servingIndex whose unit best matches the resolvedUnit type.
- resolvedUnit "g" or "oz" → prefer a gram or oz-based DB serving line.
- resolvedUnit a count noun (e.g. "gummy", "cracker") → prefer a count-based DB serving line.
- resolvedUnit "cup" / "tbsp" → prefer a volume-based DB serving line.

USER-CONFIRMED FATSECRET (when the prompt says so, or only one FatSecret result is listed):
- Treat that food as the match. Use fatSecretIndex 1, pick the best servingIndex for the unit type. Do not use library or direct AI estimate instead.

USER-REJECTED FATSECRET (when the prompt says the user rejected database matches):
- Do not use FatSecret. Use direct AI estimate only (libraryIndex null, fatSecretIndex null, return calories, protein, servingType, multiplier).

LIBRARY / FATSECRET RULES:
- Only match when the item is essentially the same product — not a shared ingredient (e.g. "orange chicken" ≠ library "chicken").

SERVING TYPE (servingType) — direct AI estimates (path 4) only:
- Short unit label for ONE base portion (e.g. "can", "cup", "slice", "tbsp", "serving", "1 pouch").
- Pick the most appropriate unit from nutrition facts, context, or resolvedUnit.

MULTIPLIER — direct AI estimates (path 4) only:
- How many of the chosen base serving the user's portion represents.
- For ALL library and FatSecret matches: always set to 1 — the app computes the correct value from resolvedQty + resolvedUnit. Never compute or adjust the multiplier for library/FatSecret matches, even if you think you know the right value.

JSON only. Examples:
{ "libraryIndex": 3, "resolvedQty": 2, "resolvedUnit": "serving", "multiplier": 1 }
{ "fatSecretIndex": 2, "servingIndex": 1, "resolvedQty": 6, "resolvedUnit": "gummy", "multiplier": 1 }
{ "fatSecretIndex": 1, "servingIndex": 2, "resolvedQty": 4, "resolvedUnit": "oz", "multiplier": 1 }
{ "fatSecretIndex": 1, "servingIndex": 1, "resolvedQty": 25, "resolvedUnit": "g", "multiplier": 1 }
{ "fatSecretIndex": 1, "servingIndex": 1, "resolvedQty": 2, "resolvedUnit": "cracker", "multiplier": 1 }
{ "libraryIndex": null, "fatSecretIndex": null, "calories": 180, "protein": 6, "servingType": "can", "resolvedQty": 1, "resolvedUnit": "can", "multiplier": 1 }
{ "libraryIndex": null, "fatSecretIndex": null, "calories": 143, "protein": 5, "servingType": "g", "resolvedQty": 25, "resolvedUnit": "g", "multiplier": 25 }`,
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
