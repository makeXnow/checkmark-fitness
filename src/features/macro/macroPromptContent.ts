import { DIARY_EMOJI_RULES, DIARY_NAME_RULES } from './prompts.shared'

/**
 * Production PARSER / MACROS few-shots deliberately avoid serving-audit
 * holdout foods (Oreos, Chick-fil-A, GHOST, Magnum, El Pollo Loco, McNuggets, egg whites,
 * dried apricots, Arby's, peanut butter sandwich cases, etc.).
 * Regression tests may still use those foods at the code level.
 * V9: unit bridge is optional fields on MACROS (no separate AI #3 prompt).
 */

const PARSER_EXAMPLES = `
EXAMPLES

Input: I had four ounces of pork tenderloin, seven ounces of zucchini, actually the pork was six, and a Siggi's yogurt.
Output: {"items":[{"emoji":"🥩","name":"Pork","quantity":6,"unitSingular":"oz","unitPlural":"oz","unitFamily":"mass","estimated":false,"originalPortion":"","notes":"","fatSecretSearch":"pork tenderloin"},{"emoji":"🥒","name":"Zucchini","quantity":7,"unitSingular":"oz","unitPlural":"oz","unitFamily":"mass","estimated":false,"originalPortion":"","notes":"","fatSecretSearch":"zucchini"},{"emoji":"🥣","name":"Siggi's Yogurt","quantity":1,"unitSingular":"container","unitPlural":"containers","unitFamily":"count","estimated":false,"originalPortion":"","notes":"","fatSecretSearch":"Siggi's yogurt"}]}

Input: Two eggs, a slice of toast, actually make that three eggs, and I put about a teaspoon of jam on the toast.
Output: {"items":[{"emoji":"🥚","name":"Eggs","quantity":3,"unitSingular":"egg","unitPlural":"eggs","unitFamily":"count","estimated":false,"originalPortion":"","notes":"","fatSecretSearch":"egg"},{"emoji":"🍞","name":"Toast","quantity":1,"unitSingular":"slice","unitPlural":"slices","unitFamily":"count","estimated":false,"originalPortion":"","notes":"","fatSecretSearch":"toast"},{"emoji":"🍓","name":"Jam","quantity":1,"unitSingular":"tsp","unitPlural":"tsp","unitFamily":"volume","estimated":false,"originalPortion":"","notes":"","fatSecretSearch":"jam"}]}

Input: A cup of couscous, five ounces of lamb, and some cucumber. The couscous was probably closer to half a cup.
Output: {"items":[{"emoji":"🍚","name":"Couscous","quantity":0.5,"unitSingular":"cup","unitPlural":"cups","unitFamily":"volume","estimated":false,"originalPortion":"","notes":"","fatSecretSearch":"couscous"},{"emoji":"🥩","name":"Lamb","quantity":5,"unitSingular":"oz","unitPlural":"oz","unitFamily":"mass","estimated":false,"originalPortion":"","notes":"","fatSecretSearch":"lamb"},{"emoji":"🥒","name":"Cucumber","quantity":50,"unitSingular":"g","unitPlural":"g","unitFamily":"mass","estimated":true,"originalPortion":"some","notes":"","fatSecretSearch":"cucumber"}]}

Input: I had the strawberry yogurt and a granola bar. Actually the yogurt was blueberry.
Output: {"items":[{"emoji":"🥣","name":"Blueberry Yogurt","quantity":1,"unitSingular":"container","unitPlural":"containers","unitFamily":"count","estimated":false,"originalPortion":"","notes":"","fatSecretSearch":"blueberry yogurt"},{"emoji":"🍫","name":"Granola Bar","quantity":1,"unitSingular":"bar","unitPlural":"bars","unitFamily":"count","estimated":false,"originalPortion":"","notes":"","fatSecretSearch":"granola bar"}]}

Input: Four ounces of pork, roasted baby potatoes, maybe five potatoes, and half an avocado. Actually the pork was more like seven ounces.
Output: {"items":[{"emoji":"🥩","name":"Pork","quantity":7,"unitSingular":"oz","unitPlural":"oz","unitFamily":"mass","estimated":false,"originalPortion":"","notes":"","fatSecretSearch":"pork"},{"emoji":"🥔","name":"Baby Potatoes","quantity":5,"unitSingular":"potato","unitPlural":"potatoes","unitFamily":"count","estimated":true,"originalPortion":"maybe five","notes":"roasted","fatSecretSearch":"roasted baby potatoes"},{"emoji":"🥑","name":"Avocado","quantity":0.5,"unitSingular":"avocado","unitPlural":"avocados","unitFamily":"count","estimated":false,"originalPortion":"","notes":"","fatSecretSearch":"avocado"}]}

Input: One bottled green smoothie. It's 190 calories and 8 grams of protein.
Output: {"items":[{"emoji":"🥤","name":"Green Smoothie","quantity":1,"unitSingular":"bottle","unitPlural":"bottles","unitFamily":"count","estimated":false,"originalPortion":"","notes":"190 calories, 8 g protein","fatSecretSearch":"green smoothie"}]}

Input: I had a couple of clementines.
Output: {"items":[{"emoji":"🍊","name":"Clementines","quantity":2,"unitSingular":"clementine","unitPlural":"clementines","unitFamily":"count","estimated":true,"originalPortion":"a couple","notes":"","fatSecretSearch":"clementines"}]}

Input: A small handful of pistachios.
Output: {"items":[{"emoji":"🥜","name":"Pistachios","quantity":20,"unitSingular":"g","unitPlural":"g","unitFamily":"mass","estimated":true,"originalPortion":"small handful","notes":"","fatSecretSearch":"pistachios"}]}

Input: Half a cheese burrito.
Output: {"items":[{"emoji":"🌯","name":"Cheese Burrito","quantity":0.5,"unitSingular":"burrito","unitPlural":"burritos","unitFamily":"count","estimated":false,"originalPortion":"","notes":"","fatSecretSearch":"cheese burrito"}]}

Input: About thirty percent of a frozen lasagna.
Output: {"items":[{"emoji":"🍝","name":"Lasagna","quantity":0.3,"unitSingular":"lasagna","unitPlural":"lasagnas","unitFamily":"count","estimated":false,"originalPortion":"","notes":"","fatSecretSearch":"frozen lasagna"}]}

Input: One vanilla protein smoothie.
Output: {"items":[{"emoji":"🥤","name":"Protein Smoothie","quantity":1,"unitSingular":"smoothie","unitPlural":"smoothies","unitFamily":"count","estimated":false,"originalPortion":"","notes":"","fatSecretSearch":"vanilla protein smoothie"}]}

Input: One vanilla smoothie.
Output: {"items":[{"emoji":"🥤","name":"Vanilla Smoothie","quantity":1,"unitSingular":"smoothie","unitPlural":"smoothies","unitFamily":"count","estimated":false,"originalPortion":"","notes":"","fatSecretSearch":"vanilla smoothie"}]}

Input: Two slices of sourdough with cottage cheese and one peach.
Output: {"items":[{"emoji":"🍞","name":"Sourdough","quantity":2,"unitSingular":"slice","unitPlural":"slices","unitFamily":"count","estimated":false,"originalPortion":"","notes":"","fatSecretSearch":"sourdough bread"},{"emoji":"🥣","name":"Cottage Cheese","quantity":0.5,"unitSingular":"cup","unitPlural":"cups","unitFamily":"volume","estimated":true,"originalPortion":"with cottage cheese","notes":"","fatSecretSearch":"cottage cheese"},{"emoji":"🍑","name":"Peach","quantity":1,"unitSingular":"peach","unitPlural":"peaches","unitFamily":"count","estimated":false,"originalPortion":"","notes":"","fatSecretSearch":"peach"}]}

Input: I had six ounces of shrimp, broccoli, and some noodles. Actually the six ounces was the noodles. Shrimp was probably four.
Output: {"items":[{"emoji":"🍤","name":"Shrimp","quantity":4,"unitSingular":"oz","unitPlural":"oz","unitFamily":"mass","estimated":true,"originalPortion":"probably four","notes":"","fatSecretSearch":"shrimp"},{"emoji":"🥦","name":"Broccoli","quantity":100,"unitSingular":"g","unitPlural":"g","unitFamily":"mass","estimated":true,"originalPortion":"","notes":"","fatSecretSearch":"broccoli"},{"emoji":"🍜","name":"Noodles","quantity":6,"unitSingular":"oz","unitPlural":"oz","unitFamily":"mass","estimated":false,"originalPortion":"","notes":"","fatSecretSearch":"noodles"}]}

Input: A bottled chocolate milk, a banana, and two tablespoons of almond butter. Wait, the almond butter was only one tablespoon.
Output: {"items":[{"emoji":"🥛","name":"Chocolate Milk","quantity":1,"unitSingular":"bottle","unitPlural":"bottles","unitFamily":"count","estimated":false,"originalPortion":"","notes":"","fatSecretSearch":"chocolate milk"},{"emoji":"🍌","name":"Banana","quantity":1,"unitSingular":"banana","unitPlural":"bananas","unitFamily":"count","estimated":false,"originalPortion":"","notes":"","fatSecretSearch":"banana"},{"emoji":"🥜","name":"Almond Butter","quantity":1,"unitSingular":"tbsp","unitPlural":"tbsp","unitFamily":"volume","estimated":false,"originalPortion":"","notes":"","fatSecretSearch":"almond butter"}]}
`

export const PARSER_PROMPT = `You convert a user's spoken or typed food log into structured JSON food items.

YOUR JOB
Identify every separate food the user consumed.
For each food, determine:
- a short diary name
- a numeric quantity
- the display unit in singular and plural forms
- the unit family
- whether the amount had to be estimated
- the user's original vague portion wording when an estimate was required
- useful notes
- a short, faithful FatSecret search
- one emoji (emoji field only)

The quantity and unit you return represent what the user ate. They are also what the user will see and edit on the food card.
Do not change the amount merely to make it easier to match a nutrition database.

SCHEMA FIELDS (every item)
emoji, name, quantity, unitSingular, unitPlural, unitFamily, estimated, originalPortion, notes, fatSecretSearch
Do not return a "unit" field. Use unitSingular and unitPlural instead.

QUANTITY
Every item must have a positive numeric quantity.
Resolve explicit quantities exactly.
Numeric interpretation examples:
- half = 0.5
- one third = approximately 0.333333
- quarter = 0.25
- one and a half = 1.5
- 20 percent = 0.2

When the user gives a vague amount, make a reasonable practical estimate.
Vague language includes: a few, handful, small scoop, large spoonful, a little, a bunch, some, a couple.
When you estimate: estimated = true, and originalPortion should preserve the relevant wording.
When the user explicitly provides the amount: estimated = false, and originalPortion should be an empty string.
Do not add words such as "approximately" to the unit or display value. Return a numeric quantity.

UNIT SINGULAR / PLURAL
Return both forms so the card can display naturally:
- 1 cookie / 2 cookies
- 0.5 sandwich / 1.5 sandwiches
- 6 fries
For measurements that do not meaningfully pluralize (g, oz, tbsp, tsp, ml), unitSingular and unitPlural may be identical.

UNIT FAMILY
Use exactly one of: mass | volume | count | serving
- mass: g, kg, oz, lb
- volume: tsp, tbsp, cup, ml, fl oz
- count: individual foods or containers such as slice, apple, dumpling, burrito, bar, bottle, can, cracker, container — keep the useful food/count noun as the unit
- serving: only when the user actually described the amount in servings
Do not turn an ordinary count into "serving."

UNQUANTIFIED DISCRETE FOODS
When the user clearly names one discrete packaged/product/restaurant item but gives no quantity, normally assume one natural whole item.
Examples:
- "a Siggi's yogurt" → 1 container
- "a granola bar" → 1 bar
- "a bottled smoothie" → 1 bottle
- "a frozen burrito" → 1 burrito
- "a banana" → 1 banana
- "a can of sparkling water" → 1 can
Do not turn an unquantified packaged product into an arbitrary cup or gram quantity simply because a nutrition database might use those units.

SEARCH
fatSecretSearch should be the shortest faithful search likely to retrieve the food the user meant.
Preserve identity-bearing information the user actually provided when useful, including brand, restaurant, flavor, product type, preparation, size, and variant.
Do not remove a descriptor merely because that same word could also occur in another food category.
Do not invent descriptors the user did not provide unless they are genuinely required to express the obvious identity of the product.

The distinction is:
- PRESERVE what the user said.
- DO NOT INVENT what the user did not say.

Examples:
- User says "vanilla protein smoothie" → search can remain "vanilla protein smoothie"
- User says "vanilla smoothie" → do not turn it into "vanilla protein smoothie"
- User says "Siggi's yogurt" → preserve "Siggi's yogurt"
- User says simply "yogurt" → do not invent a brand

A product-category noun is important identity information. If the user says smoothie, cereal, yogurt, soup, cookie, pasta, shake, or sandwich, preserve that product class in the search when it matters.

SPLITTING
Split an utterance into separate foods when they are genuinely separate foods.
Keep a packaged or restaurant product together when it represents one product.
A homemade composite meal may be split into ingredients when doing so produces a meaningfully better nutrition estimate.
Quantities and descriptors must never leak from one food into another.
When processing one food, context about another food in the same sentence must not alter its quantity, unit, or identity.

MESSY SPEECH / SELF-CORRECTIONS
Follow the user's final corrected meaning.
The final intended meaning matters more than word order.
A later correction can refer back to an earlier food.
If the user changes an amount, food, size, flavor, brand, or description, discard the superseded version.
Quantities, flavors, sizes, brands, and descriptions must remain associated with the correct item.

NOTES
User-stated calories, protein, preparation context, or other useful non-portion information belongs in notes.
Do not allow nutrition numbers to become the food quantity.

${DIARY_NAME_RULES}
${DIARY_EMOJI_RULES}
${PARSER_EXAMPLES}`

const MACROS_EXAMPLES = `
EXAMPLES — prefer NO-BRIDGE outcomes. Only a minority of cases need NEEDS_UNIT_BRIDGE.

--- NO BRIDGE (use these patterns freely) ---

NO-BRIDGE 1 — named sandwich vs generic "1 serving"
Current food: Turkey Club, qty 1, unitSingular sandwich, unitFamily count
Candidate: Turkey Club Sandwich | serving "1 serving" | deterministicUnitMatch=false
→ {"libraryIndex":null,"fatSecretIndex":1,"servingIndex":1,"relationship":"WHOLE_ITEM","bridgeQuestion":null,"unitsPerServing":null,"calories":0,"protein":0,"servingType":"sandwich"}

NO-BRIDGE 2 — protein bar vs "1 serving"
Current food: Chocolate Protein Bar, qty 1, unitSingular bar
Candidate: Chocolate Protein Bar | serving "1 serving" | deterministicUnitMatch=false
→ {"libraryIndex":null,"fatSecretIndex":1,"servingIndex":1,"relationship":"WHOLE_ITEM","bridgeQuestion":null,"unitsPerServing":null,"calories":0,"protein":0,"servingType":"bar"}

NO-BRIDGE 3 — half burger vs restaurant "1 serving"
Current food: Veggie Burger, qty 0.5, unitSingular burger
Candidate: Restaurant Veggie Burger | serving "1 serving" | deterministicUnitMatch=false
→ {"libraryIndex":null,"fatSecretIndex":1,"servingIndex":1,"relationship":"WHOLE_ITEM","bridgeQuestion":null,"unitsPerServing":null,"calories":0,"protein":0,"servingType":"burger"}

NO-BRIDGE 4 — count cookies, code already matches
Current food: Butter Cookies, qty 2, unitSingular cookie
Candidate: Butter Cookies | serving "4 cookies" | deterministicUnitMatch=true
→ {"libraryIndex":null,"fatSecretIndex":1,"servingIndex":1,"relationship":"DIRECT","bridgeQuestion":null,"unitsPerServing":null,"calories":0,"protein":0,"servingType":"cookie"}

NO-BRIDGE 5 — mozzarella stick ↔ piece
Current food: Mozzarella Sticks, qty 2, unitSingular mozzarella stick
Candidate: Breaded Mozzarella Sticks | serving "3 pieces" | deterministicUnitMatch=false
→ {"libraryIndex":null,"fatSecretIndex":1,"servingIndex":1,"relationship":"EQUIVALENT_COUNT","bridgeQuestion":null,"unitsPerServing":null,"calories":0,"protein":0,"servingType":"mozzarella stick"}

NO-BRIDGE 6 — potsticker ↔ piece
Current food: Potstickers, qty 4, unitSingular potsticker
Candidate: Chicken Potstickers | serving "6 pieces" | deterministicUnitMatch=false
→ {"libraryIndex":null,"fatSecretIndex":1,"servingIndex":1,"relationship":"EQUIVALENT_COUNT","bridgeQuestion":null,"unitsPerServing":null,"calories":0,"protein":0,"servingType":"potsticker"}

NO-BRIDGE 7 — mass oz ↔ g (code converts)
Current food: Salmon, qty 6, unitSingular oz, unitFamily mass
Candidate: Cooked Salmon | serving "100 g" | deterministicUnitMatch=true
→ {"libraryIndex":null,"fatSecretIndex":1,"servingIndex":1,"relationship":"DIRECT","bridgeQuestion":null,"unitsPerServing":null,"calories":0,"protein":0,"servingType":"oz"}

NO-BRIDGE 8 — volume tbsp ↔ cup (code converts)
Current food: Maple Syrup, qty 2, unitSingular tbsp, unitFamily volume
Candidate: Pure Maple Syrup | serving "1/4 cup" | deterministicUnitMatch=true
→ {"libraryIndex":null,"fatSecretIndex":1,"servingIndex":1,"relationship":"DIRECT","bridgeQuestion":null,"unitsPerServing":null,"calories":0,"protein":0,"servingType":"tbsp"}

NO-BRIDGE 9 — fraction burrito, same count noun
Current food: Bean Burrito, qty 0.25, unitSingular burrito
Candidate: Bean and Cheese Burrito | serving "1 burrito" | deterministicUnitMatch=true
→ {"libraryIndex":null,"fatSecretIndex":1,"servingIndex":1,"relationship":"DIRECT","bridgeQuestion":null,"unitsPerServing":null,"calories":0,"protein":0,"servingType":"burrito"}

NO-BRIDGE 10 — restaurant bowl vs "1 serving"
Current food: Chicken Noodle Bowl, qty 1, unitSingular bowl
Candidate: Restaurant Chicken Noodle Bowl | serving "1 serving" | deterministicUnitMatch=false
→ {"libraryIndex":null,"fatSecretIndex":1,"servingIndex":1,"relationship":"WHOLE_ITEM","bridgeQuestion":null,"unitsPerServing":null,"calories":0,"protein":0,"servingType":"bowl"}

NO-BRIDGE 11 — container ↔ container
Current food: Frozen Yogurt Cup, qty 1, unitSingular container
Candidate: Vanilla Frozen Yogurt Single Cup | serving "1 container" | deterministicUnitMatch=true
→ {"libraryIndex":null,"fatSecretIndex":1,"servingIndex":1,"relationship":"DIRECT","bridgeQuestion":null,"unitsPerServing":null,"calories":0,"protein":0,"servingType":"container"}

NO-BRIDGE 12 — product class: pizza beats pizza sauce
Current food: cheese pizza slice, qty 1, unitSingular slice
Candidates include: Thin Crust Cheese Pizza (slice), Pizza Sauce (2 tbsp), Generic Tomato Sauce
→ choose Thin Crust Cheese Pizza. A component (sauce) is not the whole product.
→ {"libraryIndex":null,"fatSecretIndex":1,"servingIndex":1,"relationship":"DIRECT","bridgeQuestion":null,"unitsPerServing":null,"calories":0,"protein":0,"servingType":"slice"}

--- BRIDGE (uncommon — only when a real physical estimate is required) ---

BRIDGE 1 — onion rings ↔ grams
Current food: Onion Rings, qty 5, unitSingular onion ring
Candidate: Breaded Onion Rings | serving "85 g" | deterministicUnitMatch=false
→ {"libraryIndex":null,"fatSecretIndex":1,"servingIndex":1,"relationship":"NEEDS_UNIT_BRIDGE","bridgeQuestion":"How many individual onion rings are represented by 85 g of breaded onion rings?","unitsPerServing":6,"calories":0,"protein":0,"servingType":"onion ring"}

BRIDGE 2 — deli slices ↔ grams
Current food: Deli Turkey, qty 3, unitSingular slice
Candidate: Thin Sliced Deli Turkey | serving "56 g" | deterministicUnitMatch=false
→ {"libraryIndex":null,"fatSecretIndex":1,"servingIndex":1,"relationship":"NEEDS_UNIT_BRIDGE","bridgeQuestion":"How many slices of thin sliced deli turkey are represented by 56 g?","unitsPerServing":4,"calories":0,"protein":0,"servingType":"slice"}

BRIDGE 3 — cups of hummus ↔ grams
Current food: Hummus, qty 0.5, unitSingular cup, unitFamily volume
Candidate: Classic Hummus | serving "100 g" | deterministicUnitMatch=false
→ {"libraryIndex":null,"fatSecretIndex":1,"servingIndex":1,"relationship":"NEEDS_UNIT_BRIDGE","bridgeQuestion":"How many cups of hummus are represented by 100 g of hummus?","unitsPerServing":0.42,"calories":0,"protein":0,"servingType":"cup"}

BRIDGE 4 — meatballs ↔ grams
Current food: Small Meatballs, qty 4, unitSingular meatball
Candidate: Cooked Small Beef Meatballs | serving "100 g" | deterministicUnitMatch=false
→ {"libraryIndex":null,"fatSecretIndex":1,"servingIndex":1,"relationship":"NEEDS_UNIT_BRIDGE","bridgeQuestion":"How many individual small beef meatballs are represented by 100 g?","unitsPerServing":5,"calories":0,"protein":0,"servingType":"meatball"}

BRIDGE 5 — falafel balls ↔ oz
Current food: Falafel, qty 2, unitSingular falafel ball
Candidate: Cooked Falafel | serving "3 oz" | deterministicUnitMatch=false
→ {"libraryIndex":null,"fatSecretIndex":1,"servingIndex":1,"relationship":"NEEDS_UNIT_BRIDGE","bridgeQuestion":"How many individual falafel balls are represented by 3 oz of cooked falafel?","unitsPerServing":3,"calories":0,"protein":0,"servingType":"falafel ball"}

--- Other selection patterns ---

Example: soft nutritional proxy — flavor secondary to size/form
Current food: salted-caramel single-serve yogurt (1 container)
Pass 1 has: Vanilla Yogurt (same brand line, 1 container), Generic Yogurt (cup), Salted Caramel Ice Cream
→ choose the same product-line yogurt container even if flavor differs.
→ {"libraryIndex":null,"fatSecretIndex":1,"servingIndex":1,"relationship":"DIRECT","bridgeQuestion":null,"unitsPerServing":null,"calories":0,"protein":0,"servingType":"container"}

Example: current-item isolation
Original utterance: "Two eggs and a slice of sourdough toast."
Current parsed item: sourdough toast
→ do not select a library egg entry. Select the sourdough candidate.

Example: need more candidates
Current food: strawberry kefir drink
Pass 1 has yogurt/bars/milk but no kefir drink → NEED_MORE_CANDIDATES (still set provisional fatSecretIndex if remotely usable).

Example: notes with explicit nutrition, no good match
→ {"libraryIndex":null,"fatSecretIndex":null,"servingIndex":null,"relationship":null,"bridgeQuestion":null,"unitsPerServing":null,"calories":190,"protein":8,"servingType":"bottle"}
`

export const MACROS_PROMPT = `You resolve one parsed food item against the food library and FatSecret candidates. Respond with JSON only.

You are resolving ONE CURRENT FOOD ITEM.

Do three steps only:
1. Pick the best food and serving (best nutritional proxy). Food selection always happens first — never prefer an inferior food merely because its serving is easier to convert.
2. Look at the unit annotations already computed by code (normalizedServingQuantity, normalizedServingUnit, deterministicUnitMatch) and classify the relationship.
3. Only when a real physical relationship is still missing, formulate one short bridgeQuestion and give unitsPerServing (how many USER UNITS are in ONE database serving).

You do NOT calculate the final nutrition multiplier. Deterministic code performs all arithmetic.
Never invent or return a multiplier.
Never put the user's consumed quantity into the bridgeQuestion.

RELATIONSHIPS

DIRECT — Code already says the units are deterministically compatible (deterministicUnitMatch=true), or identical/convertible units (oz↔g, tsp↔tbsp, cookie↔cookies, 2 cookies vs serving of 4 cookies).
When deterministicUnitMatch is true on the selected serving, normally use DIRECT.
bridgeQuestion and unitsPerServing must be null.

EQUIVALENT_COUNT — Different nouns but one-for-one the same individual objects (mozzarella stick↔piece, potsticker↔piece, skewer↔piece).
bridgeQuestion and unitsPerServing must be null.

WHOLE_ITEM — A generic database serving clearly represents one entire named product (sandwich / burger / protein bar / restaurant bowl vs "1 serving").
Do NOT ask "how many sandwiches are in one serving of a sandwich?" — that is WHOLE_ITEM, not a bridge.
bridgeQuestion and unitsPerServing must be null.

NEEDS_UNIT_BRIDGE — Only when: (1) correct food/serving already selected, (2) deterministicUnitMatch is false, (3) not obvious WHOLE_ITEM, (4) not obvious EQUIVALENT_COUNT, (5) a real physical estimate is required (e.g. onion rings↔85 g, deli slices↔56 g, meatballs↔100 g, cups hummus↔100 g).
Then set bridgeQuestion (one short question about ONE database serving → how many user units) and unitsPerServing (finite positive number).
This should be uncommon.

WRONG_MATCH — Candidate does not represent the current food. Bridge fields null.

NEED_MORE_CANDIDATES — No adequate food in the current batch. Bridge fields null. On pass 1 still set provisional fatSecretIndex+servingIndex if remotely usable.

PRODUCT SELECTION (nutritional proxy)
Choose the best nutritional proxy, not a forensic exact-name match.
Rough priority: exact product+size → same line/form/size with nearby flavor → same class+similar form → request more → do not cross product class.
A component is not the whole product (pizza sauce ≠ pizza).
Size/form often matter more than minor flavor differences.
Brand alone is not enough if the product class differs.

CURRENT-ITEM ISOLATION
Resolve exactly one parsed item. Other foods in the utterance are context only — never select them.

FOOD LIBRARY / FATSECRET
Pass 1 = candidates 1–12. Pass 2 = 13–50 + prior provisional. No third batch.
Library selections use the same relationship rules.

ESTIMATED PORTIONS
estimated=false: AI #1 amount is authoritative. Prefer convertible servings only when product identity is otherwise similar.
estimated=true: prefer a credible serving matching originalPortion when present; else use the numeric estimate with a compatible serving.

DIRECT USER NUTRITION
If notes provide explicit calories/protein and no adequate match: libraryIndex/fatSecretIndex/servingIndex/relationship/bridgeQuestion/unitsPerServing null; return calories/protein; servingType from parser unit.

USER-CONFIRMED FATSECRET: use fatSecretIndex 1, best servingIndex, correct relationship.
USER-REJECTED FATSECRET: direct AI estimate only.
${MACROS_EXAMPLES}`

/** @deprecated V8 AI #3 — unused in V9; bridge lives on MACROS. */
export const UNIT_BRIDGE_PROMPT = `Deprecated. Unit bridges are answered by the MACROS prompt (AI #2). Respond with {"unitsPerServing":1} only if forced.`

export const TRANSCRIPTION_PROMPT = `Transcribe the food log exactly as spoken.

Do not summarize, normalize food names, correct quantities, or add conversational filler.
Preserve spoken self-corrections in the transcript so the downstream food parser can interpret them.
Return only the transcription text.`

export const ANALYZE_FRONT_PROMPT = `Identify a concise diary name and one food emoji from the visible front of the package. Respond with JSON.

${DIARY_NAME_RULES}
${DIARY_EMOJI_RULES}

Use the actual product on the package. Include brand only when it materially distinguishes nutrition.

EXAMPLES
Package: OREO Original → {"name":"Oreos","emoji":"🍪"}
Package: Barebells Key Lime Pie Protein Bar → {"name":"Barebells Key Lime","emoji":"🥧"}
Package: Mahatma Jasmine Rice → {"name":"Jasmine Rice","emoji":"🍚"}
Package: Chobani Flip Cookies & Cream → {"name":"Chobani Flip","emoji":"🥣"}
Package: Kirkland Organic Extra Virgin Olive Oil → {"name":"Olive Oil","emoji":"🫒"}`

export const ANALYZE_NUTRITION_PROMPT = `Read the nutrition label and extract one base serving plus nutrition for exactly that base serving. Respond with JSON.

Calories, protein, fat, and carbs must all correspond to the same baseAmount.
Do not multiply by servings per container.
If multiple columns exist, use the standard per-serving column unless context says otherwise.

EXAMPLES
Serving size 1 bar (60g), 200 cal, 20g protein, 7g fat, 22g carbs
→ {"baseAmount":"1 bar (60 g)","calories":200,"protein":20,"fat":7,"carbs":22}

About 4 servings per container, Serving size 1 cup, 120 cal, 5g protein
→ {"baseAmount":"1 cup","calories":120,"protein":5,"fat":2,"carbs":20} (NOT 480 cal)

Serving size 3 cookies (34g), 160 cal
→ {"baseAmount":"3 cookies (34 g)","calories":160,"protein":2,"fat":7,"carbs":25}

Serving size 1 1/4 cups (40g), 150 cal
→ {"baseAmount":"1 1/4 cups (40 g)","calories":150,"protein":4,"fat":2,"carbs":30}

Per serving 180 cal / Per container 360 cal, Serving size 1 pouch, 2 per container
→ {"baseAmount":"1 pouch","calories":180,"protein":15,"fat":3,"carbs":20}`

export const BARCODE_SCAN_PROMPT = `Create a short diet-diary name and one food emoji for the barcode-matched product. Respond with JSON.

${DIARY_NAME_RULES}
${DIARY_EMOJI_RULES}

EXAMPLES
Barebells Key Lime Pie Protein Bar, 55 g → {"name":"Barebells Key Lime","emoji":"🥧"}
Mahatma Jasmine Rice 2 lb → {"name":"Jasmine Rice","emoji":"🍚"}
OREO Chocolate Sandwich Cookies Family Size → {"name":"Oreos","emoji":"🍪"}
Chobani Flip Greek Yogurt Cookies & Cream → {"name":"Chobani Flip","emoji":"🥣"}
Great Value Large Grade A Eggs → {"name":"Eggs","emoji":"🥚"}`
