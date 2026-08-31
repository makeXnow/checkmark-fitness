/** Shared prompt fragments (no circular imports with macroPromptContent). */

export const DIARY_NAME_RULES = `NAMING RULES (for "name" — short diary label):
1. Keep names very short (ideal < 15 characters, max 25).
2. Only include brand in "name" if nutrition varies significantly between brands (e.g., "Quest Bar", "Barebells Key Lime").
3. Exclude brand for generic items (e.g., "Jasmine Rice" not "Mahatma Jasmine Rice").
4. Put emoji only in "emoji", never in "name" (no leading emoji in the name field).`

export const DIARY_EMOJI_RULES = `EMOJI:
- One emoji matching the food (flavor, category, form), not the brand logo.
- Prefer specific over generic when obvious (e.g. 🥧 for key lime pie bar, 🍫 for chocolate protein bar).`
