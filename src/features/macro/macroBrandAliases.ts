/**
 * Hardcoded brand / store→label rewrites for voice/text food logs.
 *
 * These brands collide with ordinary English (numbers, verbs, fillers).
 * Store names are not FatSecret brands — map them to the private-label name.
 */

/** Store front → FatSecret private-label brand. */
const STORE_LABEL_ALIASES: { pattern: RegExp; label: string }[] = [
  { pattern: /\bwal[\s-]?mart\b/gi, label: 'Great Value' },
  { pattern: /\bcostco\b/gi, label: 'Kirkland' },
  { pattern: /\btarget\b/gi, label: 'Good & Gather' },
  { pattern: /\bsams?\s*club\b/gi, label: "Member's Mark" },
  { pattern: /\baldi\b/gi, label: "Nature's Nectar" },
]

/**
 * Spoken brand phrases that parsers drop because they look like grammar.
 * Applied to the raw utterance before PARSER, and to fatSecretSearch.
 */
const CONFUSING_BRAND_PHRASES: { pattern: RegExp; replacement: string }[] = [
  // "maple one bar" → brand ONE. Do NOT rewrite leading quantity "one maple bar".
  { pattern: /\b([a-z][\w'-]*)\s+one\s+(bars?)\b/gi, replacement: '$1 ONE $2' },
  { pattern: /\btwo\s+good\b/gi, replacement: 'Two Good' },
  { pattern: /\bjust\s+egg\b/gi, replacement: 'Just Egg' },
  { pattern: /\bjust\s+mayo\b/gi, replacement: 'Just Mayo' },
  { pattern: /\bkind\s+(bars?|nuts?|clusters?|fruit)\b/gi, replacement: 'KIND $1' },
  { pattern: /\bthink\s*!\s*(bars?)?\b/gi, replacement: 'think! $1' },
  { pattern: /\bthink\s+(bars?)\b/gi, replacement: 'think! $1' },
  { pattern: /\bbuilt\s+(bars?|puffs?)\b/gi, replacement: 'Built $1' },
  { pattern: /\brise\s+(bars?)\b/gi, replacement: 'Rise $1' },
  { pattern: /\bno\s+cow\b/gi, replacement: 'No Cow' },
  { pattern: /\bthat'?s\s+it\s+(bars?|fruit)?\b/gi, replacement: "That's it $1" },
  { pattern: /\biq\s*-?\s*bars?\b/gi, replacement: 'IQBAR' },
  { pattern: /\brx\s*-?\s*bars?\b/gi, replacement: 'RXBAR' },
  { pattern: /\bprotein\s+one\b/gi, replacement: 'Protein One' },
  { pattern: /\bfiber\s+one\b/gi, replacement: 'Fiber One' },
]

function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Rewrite a raw spoken/typed food log so confusing brands survive PARSER.
 * Does not change quantity phrases like "half of one of those" (no "bar"/"Good"/etc.).
 */
export function rewriteSpokenFoodLog(text: string): string {
  let out = text
  for (const { pattern, replacement } of CONFUSING_BRAND_PHRASES) {
    pattern.lastIndex = 0
    out = out.replace(pattern, replacement)
  }
  return collapseSpaces(out)
}

/** Map store names inside a FatSecret search string to private-label brands. */
export function rewriteStoreLabelsInSearch(search: string): string {
  let out = search
  for (const { pattern, label } of STORE_LABEL_ALIASES) {
    pattern.lastIndex = 0
    out = out.replace(pattern, label)
  }
  return collapseSpaces(out)
}

/**
 * Final FatSecret query: store aliases + brand rescue from userInput when the
 * parser already collapsed "maple one bar" → "maple bar".
 */
export function rewriteFatSecretSearch(search: string, userInput?: string): string {
  let out = rewriteStoreLabelsInSearch(search)
  const spoken = userInput ? rewriteSpokenFoodLog(userInput) : ''

  // If the utterance clearly named ONE (after rewrite) but search lost it, put ONE back.
  // Require capital ONE so quantity "one maple bar" is not treated as the brand.
  if (/\bONE\b/.test(spoken) && !/\bONE\b/.test(out)) {
    const flavor = spoken.match(/\b([A-Za-z][\w'-]*)\s+ONE\s+bars?\b/)?.[1]
    if (flavor && !new RegExp(`\\b${flavor}\\b`, 'i').test(out)) {
      out = `ONE ${flavor} ${out}`.replace(/\s+/g, ' ')
    } else if (flavor) {
      out = out.replace(new RegExp(`\\b${flavor}\\b`, 'i'), `ONE ${flavor}`)
    } else {
      out = `ONE ${out}`
    }
  }

  // Generic rescue: only brands the spoken rewrite actually introduced (case-sensitive tokens).
  for (const brand of [
    'ONE',
    'Two Good',
    'Just Egg',
    'Just Mayo',
    'KIND',
    'think!',
    'Built',
    'Rise',
    'No Cow',
    "That's it",
    'IQBAR',
    'RXBAR',
    'Protein One',
    'Fiber One',
  ]) {
    const brandRe = new RegExp(brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const original = (userInput || '').replace(/\s+/g, ' ').trim()
    const introduced = brandRe.test(spoken) && !brandRe.test(original)
    if (introduced && !brandRe.test(out)) {
      out = `${brand} ${out}`
    }
  }

  return collapseSpaces(out)
}
