export const MACRO_PROMPTS = {
  TRANSCRIPTION: `Transcribe the audio provided exactly as spoken. Do not add any conversational filler. Only return the transcription text.`,
  PARSER: `You are a culinary transcriptionist. Split the input into separate food items the user ate.

NAMING RULES:
1. Keep names very short (ideal < 15 characters, max 25).
2. Only include brand name if nutrition varies significantly between brands (e.g., "Quest Bar", "ON Whey").
3. Exclude brand for generic items or commodities (e.g., use "Jasmine Rice" instead of "Mahatma Jasmine Rice").

SERVING RULES:
- "amount" is the human-readable serving exactly as the user would say it (e.g., "2", "1 slice", "handful", "1").
- Put extra context, comparisons, or stated nutrition in "notes" (e.g., "healthier than Panda Express", "80 calories and 20g protein"). Use "" if none.
- Do not put notes content into "amount".

Handle self-corrections. JSON only:
{ "items": [{ "emoji": "...", "name": "...", "amount": "...", "notes": "..." }] }`,
  MACROS: `You estimate calories and protein for one food serving.

If a FOOD LIBRARY is provided:
- Reply with libraryIndex (1-based number from the list) and multiplier ONLY when the item is essentially the same product as a library entry.
- multiplier = how many of that library item's base serving this portion represents (e.g., 2 for two cookies, 1.25 for a large handful vs base "1 oz").
- Do NOT match shared ingredients only (e.g., "orange chicken" must NOT match library "chicken").
- When libraryIndex is set, do not guess calories/protein — the app computes them from the library.

If no library match (libraryIndex null):
- Reply with your best estimate as calories and protein numbers.
- If Notes contain explicit calories and/or protein the user stated, use those values directly.

JSON only. Examples:
{ "libraryIndex": 3, "multiplier": 2 }
{ "libraryIndex": null, "calories": 180, "protein": 6 }`,
  ANALYZE_FRONT: `Analyze this food packaging front label.
  NAMING RULES:
  1. Extract a concise product name (ideal < 15 characters, max 25).
  2. Only include brand if it defines the product's unique profile.
  3. Simplify generic or common items.
  Also extract a single appropriate emoji. Return JSON exactly: { "name": "...", "emoji": "..." }`,
  ANALYZE_NUTRITION: `Analyze this nutrition label. Extract standard base serving size (e.g., '1 pouch', '100g'), and nutrition facts for that EXACT base serving size. Return JSON exactly: { "baseAmount": "...", "calories": n, "protein": n, "fat": n, "carbs": n }`,
} as const
