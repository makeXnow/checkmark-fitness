export const MACRO_PROMPTS = {
  TRANSCRIPTION: `Transcribe the audio provided exactly as spoken. Do not add any conversational filler. Only return the transcription text.`,
  PARSER: `You are a culinary transcriptionist. Identify food items.
  NAMING RULES:
  1. Keep names very short (ideal < 15 characters, max 25).
  2. Only include brand name if nutrition varies significantly between brands (e.g., "Quest Bar", "ON Whey").
  3. Exclude brand for generic items or commodities (e.g., use "Jasmine Rice" instead of "Mahatma Jasmine Rice").
  Handle self-corrections. Format: Emoji, Name, Amount. JSON only. { "items": [{ "emoji": "...", "name": "...", "amount": "..." }] }`,
  MACROS: `Precise nutrition calculator. Provide calories, protein, fat, carbs as numbers for the given amount/food.
  IMPORTANT: Refer to the USER CUSTOM FOODS DATABASE if provided. If the food matches a custom food, mathematically calculate the macros for the requested amount based on the base amount in the custom database.
  JSON only. { "calories": n, "protein": n, "fat": n, "carbs": n }`,
  ANALYZE_FRONT: `Analyze this food packaging front label.
  NAMING RULES:
  1. Extract a concise product name (ideal < 15 characters, max 25).
  2. Only include brand if it defines the product's unique profile.
  3. Simplify generic or common items.
  Also extract a single appropriate emoji. Return JSON exactly: { "name": "...", "emoji": "..." }`,
  ANALYZE_NUTRITION: `Analyze this nutrition label. Extract standard base serving size (e.g., '1 pouch', '100g'), and nutrition facts for that EXACT base serving size. Return JSON exactly: { "baseAmount": "...", "calories": n, "protein": n, "fat": n, "carbs": n }`,
} as const
