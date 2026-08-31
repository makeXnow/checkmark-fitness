import type { ConsumptionKind, ConsumptionPortion } from './macroAiSchemas'
import { parseConsumptionIntent, type ConsumptionQuantityType } from './consumptionIntent'
import { normalizeSingular, parseLeadingQuantity } from './macroMass'

export type ConsumptionContext = {
  name?: string
  userInput?: string
}

function quantityTypeToKind(qt: ConsumptionQuantityType): ConsumptionKind {
  switch (qt) {
    case 'mass':
      return 'mass'
    case 'volume':
      return 'volume'
    case 'fraction_of_item':
      return 'fraction_of_item'
    default:
      return 'count'
  }
}

function isGenericServingUnit(unit: string): boolean {
  const u = unit.trim().toLowerCase()
  return !u || normalizeSingular(u) === 'serving'
}

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'and',
  'or',
  'with',
  'from',
  'i',
  'had',
  'ate',
  'eaten',
  'have',
  'some',
  'about',
  'approximately',
  'roughly',
  'like',
  'just',
  'only',
  'my',
  'me',
  'for',
  'to',
  'in',
  'on',
  'at',
  'is',
  'was',
  'were',
  'been',
  'being',
  'large',
  'small',
  'medium',
  'big',
  'little',
  'fresh',
  'raw',
  'cooked',
  'grilled',
  'fried',
  'baked',
  'smoked',
  'organic',
  'whole',
  'serving',
  'servings',
  'order',
  'orders',
  'portion',
  'portions',
  'piece',
  'pieces',
])

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
}

function meaningfulTokens(text: string): string[] {
  return text
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !/^\d+$/.test(t) && !STOPWORDS.has(t.toLowerCase()))
}

/**
 * Prefer a countable food noun from user speech / diary name.
 * General extraction — does not hardcode specific branded foods.
 */
export function inferCountUnitFromFoodPhrase(
  name?: string,
  userInput?: string,
): string | null {
  const input = (userInput ?? '').trim()
  if (input) {
    // Prefer the food noun after a quantity: last token(s) win over brand words
    // "3 El Pollo Loco tacos" → tacos; "two dried apricots" → dried apricots; "1 Oreo" → Oreo
    const afterQty = input.match(
      /\b(?:\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(.+?)(?:\.|,|$)/i,
    )
    if (afterQty?.[1]) {
      const tokens = meaningfulTokens(afterQty[1])
      if (tokens.length === 1) return tokens[0]!
      if (tokens.length === 2) return tokens.join(' ')
      if (tokens.length > 2) return tokens[tokens.length - 1]!
    }
  }

  const nameTrim = (name ?? '').trim()
  if (nameTrim) {
    // "Egg Whites", "Dried Apricots", "Tacos Al Carbon", "Oreos", "McNuggets"
    const tokens = meaningfulTokens(nameTrim).filter((t) => !/^(al|de|la|le|el|da|di)$/i.test(t))
    if (tokens.length === 1) return tokens[0]!
    if (tokens.length === 2) return tokens.join(' ')
    if (tokens.length > 2) {
      // Restaurant / branded: prefer the first countable-looking noun ("Tacos Al Carbon")
      return tokens[0]!
    }
  }

  return null
}

/** True when amount text is only a number. */
export function isBareNumericAmount(amountText: string): boolean {
  const t = amountText.trim()
  if (!t) return false
  return /^\d+(?:\.\d+)?$/.test(t) || /^\d+\s*\/\s*\d+$/.test(t)
}

/** When amount is bare, rebuild display amount from qty + inferred unit. */
export function enrichAmountText(
  amountText: string,
  consumption: ConsumptionPortion | null | undefined,
  context?: ConsumptionContext,
): string {
  const trimmed = amountText.trim()
  if (!isBareNumericAmount(trimmed) && trimmed && !/^[\d.]+\s*servings?$/i.test(trimmed)) {
    return trimmed
  }
  const qty =
    consumption?.quantity ??
    parseLeadingQuantity(trimmed) ??
    (Number.isFinite(parseFloat(trimmed)) ? parseFloat(trimmed) : null)
  if (qty == null) return trimmed
  const unit =
    consumption && !isGenericServingUnit(consumption.unit)
      ? consumption.unit
      : inferCountUnitFromFoodPhrase(context?.name, context?.userInput)
  if (!unit || isGenericServingUnit(unit)) return trimmed
  return `${qty} ${unit}`
}

/** Deterministic consumption from amount text (+ optional food context). */
export function deriveConsumptionFromAmount(
  amountText: string,
  context?: ConsumptionContext,
): ConsumptionPortion | null {
  const trimmed = amountText.trim()
  if (!trimmed) return null

  const intent = parseConsumptionIntent(trimmed)
  if (!intent) {
    return { quantity: null, unit: trimmed, kind: 'vague' }
  }

  if (isGenericServingUnit(intent.unit) || isBareNumericAmount(trimmed)) {
    const inferred = inferCountUnitFromFoodPhrase(context?.name, context?.userInput)
    if (inferred) {
      const isFraction = intent.quantity > 0 && intent.quantity < 1
      return {
        quantity: intent.quantity,
        unit: inferred,
        kind: isFraction ? 'fraction_of_item' : 'count',
      }
    }
    if (intent.quantity >= 1 && Number.isFinite(intent.quantity)) {
      return { quantity: intent.quantity, unit: 'serving', kind: 'count' }
    }
    return { quantity: intent.quantity, unit: 'serving', kind: 'fraction_of_item' }
  }

  return {
    quantity: intent.quantity,
    unit: intent.unit,
    kind: quantityTypeToKind(intent.quantityType),
  }
}

/**
 * Merge parser consumption with amountText + food context.
 * Recover countable food nouns when the parser/app used a bare number or generic "serving".
 */
export function ensureConsumption(
  amountText: string,
  fromParser?: ConsumptionPortion | null,
  context?: ConsumptionContext,
): ConsumptionPortion | null {
  const derived = deriveConsumptionFromAmount(amountText, context)

  if (!fromParser) return derived

  if (fromParser.kind === 'vague' && fromParser.quantity == null) {
    return fromParser
  }

  const parserNeedsUnit = isGenericServingUnit(fromParser.unit)

  if (parserNeedsUnit) {
    const inferred = inferCountUnitFromFoodPhrase(context?.name, context?.userInput)
    const betterUnit =
      (derived && !isGenericServingUnit(derived.unit) ? derived.unit : null) ?? inferred
    if (betterUnit) {
      const qty = fromParser.quantity ?? derived?.quantity ?? null
      const isFraction = qty != null && qty > 0 && qty < 1
      return {
        quantity: qty,
        unit: betterUnit,
        kind: isFraction ? 'fraction_of_item' : 'count',
      }
    }
    if (fromParser.quantity != null && fromParser.quantity >= 1) {
      return {
        quantity: fromParser.quantity,
        unit: fromParser.unit || 'serving',
        kind: 'count',
      }
    }
  }

  // Whole-number counts wrongly tagged fraction_of_item + serving
  if (
    fromParser.kind === 'fraction_of_item' &&
    fromParser.quantity != null &&
    fromParser.quantity >= 1
  ) {
    const inferred = inferCountUnitFromFoodPhrase(context?.name, context?.userInput)
    const unit =
      (!isGenericServingUnit(fromParser.unit) ? fromParser.unit : null) ??
      (derived && !isGenericServingUnit(derived.unit) ? derived.unit : null) ??
      inferred ??
      fromParser.unit
    return { quantity: fromParser.quantity, unit, kind: 'count' }
  }

  if (!derived) return fromParser

  if (isGenericServingUnit(fromParser.unit) && !isGenericServingUnit(derived.unit)) {
    return {
      ...fromParser,
      quantity: fromParser.quantity ?? derived.quantity,
      unit: derived.unit,
      kind:
        derived.kind === 'fraction_of_item' && (fromParser.quantity ?? 0) >= 1
          ? 'count'
          : derived.kind,
    }
  }

  if (!fromParser.unit?.trim() && derived.unit) {
    return { ...fromParser, unit: derived.unit, kind: derived.kind }
  }

  return fromParser
}

export function consumptionToMatchResolved(
  consumption: ConsumptionPortion,
): { qty: number; unit: string } | null {
  if (consumption.kind === 'vague' || consumption.quantity == null) return null
  if (!Number.isFinite(consumption.quantity) || consumption.quantity <= 0) return null
  return { qty: consumption.quantity, unit: normalizeSingular(consumption.unit) }
}

export function consumptionDisplayResolved(
  amountText: string,
  resolved: { qty: number; unit: string },
  context?: ConsumptionContext,
): { qty: number; unit: string } {
  const enriched = enrichAmountText(
    amountText,
    { quantity: resolved.qty, unit: resolved.unit, kind: 'count' },
    context,
  )
  const intent = parseConsumptionIntent(enriched)
  if (intent?.unit && !isGenericServingUnit(intent.unit)) {
    return { qty: resolved.qty, unit: intent.unit }
  }
  if (!isGenericServingUnit(resolved.unit)) return resolved
  const inferred = inferCountUnitFromFoodPhrase(context?.name, context?.userInput)
  if (inferred) return { qty: resolved.qty, unit: inferred }
  return resolved
}

/** Parse leading qty from speech like "two Oreos" when amountText is bare. */
export function quantityFromUserSpeech(userInput?: string): number | null {
  if (!userInput?.trim()) return null
  const m = userInput.trim().match(/\b(\d+(?:\.\d+)?)\b/)
  if (m) {
    const n = parseFloat(m[1]!)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  for (const [word, qty] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(userInput)) return qty
  }
  return null
}
