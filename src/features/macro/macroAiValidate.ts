import {
  UNIT_FAMILIES,
  V8_SERVING_RELATIONSHIPS,
  type MacrosAiResponse,
  type ParserItemResponse,
  type ParserResponse,
  type UnitBridgeAiResponse,
  type UnitFamily,
  type V8ServingRelationship,
} from './macroAiSchemas'

const GENERIC_UNITS = new Set(['serving', 'servings', 'portion', 'portions'])

export function isValidPositiveNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

export function isValidUnitFamily(v: unknown): v is UnitFamily {
  return typeof v === 'string' && (UNIT_FAMILIES as readonly string[]).includes(v)
}

export function isValidV8Relationship(v: unknown): v is V8ServingRelationship {
  return typeof v === 'string' && (V8_SERVING_RELATIONSHIPS as readonly string[]).includes(v)
}

/** @deprecated V7 name */
export const isValidV7Relationship = isValidV8Relationship

/**
 * Unit validation. Generic "serving"/"portion" are rejected unless unitFamily is "serving".
 */
export function isValidParserUnit(unit: unknown, unitFamily?: UnitFamily): unit is string {
  if (typeof unit !== 'string') return false
  const trimmed = unit.trim()
  if (!trimmed) return false
  if (GENERIC_UNITS.has(trimmed.toLowerCase())) {
    return unitFamily === 'serving'
  }
  return true
}

export function validateParserItem(item: unknown): item is ParserItemResponse {
  if (!item || typeof item !== 'object') return false
  const o = item as Record<string, unknown>
  if (typeof o.name !== 'string' || !o.name.trim()) return false
  if (!isValidPositiveNumber(o.quantity)) return false
  if (!isValidUnitFamily(o.unitFamily)) return false
  const family = o.unitFamily as UnitFamily
  // V8: unitSingular + unitPlural; V7 fallback: unit
  const singular =
    typeof o.unitSingular === 'string' && o.unitSingular.trim()
      ? o.unitSingular
      : typeof o.unit === 'string'
        ? o.unit
        : ''
  const plural =
    typeof o.unitPlural === 'string' && o.unitPlural.trim()
      ? o.unitPlural
      : singular
  if (!isValidParserUnit(singular, family)) return false
  if (!isValidParserUnit(plural, family)) return false
  if (typeof o.estimated !== 'boolean') return false
  if (typeof o.originalPortion !== 'string') return false
  if (o.estimated && !o.originalPortion.trim()) return false
  if (typeof o.fatSecretSearch !== 'string' || !o.fatSecretSearch.trim()) return false
  if (typeof o.notes !== 'string') return false
  return true
}

export function validateParserResponse(raw: unknown): raw is ParserResponse {
  if (!raw || typeof raw !== 'object') return false
  const items = (raw as ParserResponse).items
  if (!Array.isArray(items) || items.length === 0) return false
  return items.every(validateParserItem)
}

export function parserValidationErrors(raw: unknown): string[] {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object') return ['response is not an object']
  const items = (raw as ParserResponse).items
  if (!Array.isArray(items)) return ['items is not an array']
  if (items.length === 0) return ['items is empty']
  items.forEach((item, i) => {
    if (!item || typeof item !== 'object') {
      errors.push(`items[${i}]: not an object`)
      return
    }
    const o = item as Record<string, unknown>
    if (typeof o.name !== 'string' || !o.name.trim()) errors.push(`items[${i}].name: missing`)
    if (!isValidPositiveNumber(o.quantity)) errors.push(`items[${i}].quantity: invalid`)
    if (!isValidUnitFamily(o.unitFamily)) errors.push(`items[${i}].unitFamily: invalid`)
    const family = isValidUnitFamily(o.unitFamily) ? o.unitFamily : undefined
    const singular =
      typeof o.unitSingular === 'string' && o.unitSingular.trim()
        ? o.unitSingular
        : typeof o.unit === 'string'
          ? o.unit
          : ''
    if (!isValidParserUnit(singular, family)) {
      errors.push(`items[${i}].unitSingular: missing or generic`)
    }
    if (typeof o.estimated !== 'boolean') errors.push(`items[${i}].estimated: missing`)
    if (typeof o.originalPortion !== 'string') {
      errors.push(`items[${i}].originalPortion: missing`)
    } else if (o.estimated === true && !o.originalPortion.trim()) {
      errors.push(`items[${i}].originalPortion: required when estimated`)
    }
    if (typeof o.fatSecretSearch !== 'string' || !o.fatSecretSearch.trim()) {
      errors.push(`items[${i}].fatSecretSearch: missing`)
    }
    if (typeof o.notes !== 'string') errors.push(`items[${i}].notes: missing`)
  })
  return errors
}

/** @deprecated V6 */
export function isValidMacrosMultiplier(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

export function validateMacrosResponse(raw: unknown): raw is MacrosAiResponse {
  if (!raw || typeof raw !== 'object') return false
  const o = raw as MacrosAiResponse

  const libIdx = o.libraryIndex
  const fsIdx = o.fatSecretIndex
  const servIdx = o.servingIndex
  const rel = o.relationship

  const hasLibrary = libIdx != null && libIdx >= 1
  const hasFatSecret = fsIdx != null && fsIdx >= 1
  const hasDirect =
    (libIdx == null || libIdx < 1) &&
    (fsIdx == null || fsIdx < 1) &&
    typeof o.calories === 'number' &&
    o.calories > 0

  if (rel === 'NEED_MORE_CANDIDATES' || rel === 'WRONG_MATCH') {
    return true
  }

  const okRel =
    rel === 'DIRECT' ||
    rel === 'EQUIVALENT_COUNT' ||
    rel === 'WHOLE_ITEM' ||
    rel === 'NEEDS_UNIT_BRIDGE'

  if (hasLibrary || hasFatSecret) {
    if (hasFatSecret && (servIdx == null || servIdx < 1)) return false
    if (!okRel) return false
    // Bridge fields are application-validated / retried — do not hard-fail schema here.
    return true
  }

  if (hasDirect) {
    return typeof o.protein === 'number' && typeof o.servingType === 'string'
  }

  return false
}

export function macrosValidationErrors(raw: unknown): string[] {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object') return ['response is not an object']
  const o = raw as MacrosAiResponse

  if (o.relationship === 'NEED_MORE_CANDIDATES' || o.relationship === 'WRONG_MATCH') {
    return errors
  }

  const hasLibrary = o.libraryIndex != null && o.libraryIndex >= 1
  const hasFatSecret = o.fatSecretIndex != null && o.fatSecretIndex >= 1
  const hasDirect =
    !hasLibrary && !hasFatSecret && typeof o.calories === 'number' && o.calories > 0

  if (hasLibrary) {
    if (!isValidV8Relationship(o.relationship)) {
      errors.push('relationship: invalid for library match')
    }
    return errors
  }

  if (hasFatSecret) {
    if (o.servingIndex == null || o.servingIndex < 1) errors.push('servingIndex: missing')
    if (!isValidV8Relationship(o.relationship)) errors.push('relationship: missing')
    return errors
  }

  if (hasDirect) {
    if (typeof o.protein !== 'number') errors.push('protein: missing for direct estimate')
    if (typeof o.servingType !== 'string') errors.push('servingType: missing for direct estimate')
    return errors
  }

  errors.push('no valid match path (library, FatSecret, direct estimate, or NEED_MORE_CANDIDATES)')
  return errors
}

/** True when NEEDS_UNIT_BRIDGE has a usable unitsPerServing. */
export function hasValidUnitsPerServing(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  return isValidPositiveNumber((raw as MacrosAiResponse).unitsPerServing)
}

export function validateUnitBridgeResponse(raw: unknown): raw is UnitBridgeAiResponse {
  if (!raw || typeof raw !== 'object') return false
  const o = raw as UnitBridgeAiResponse
  return isValidPositiveNumber(o.unitsPerServing)
}

export function unitBridgeValidationErrors(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return ['response is not an object']
  const o = raw as UnitBridgeAiResponse
  if (!isValidPositiveNumber(o.unitsPerServing)) return ['unitsPerServing: must be a positive finite number']
  return []
}
