/** Shared AI schema types for the diet logging pipeline (V9). */

/** @deprecated V5 — kept for stored diary entries and audit replay */
export const CONSUMPTION_KINDS = [
  'count',
  'mass',
  'volume',
  'fraction_of_item',
  'fraction_of_container',
  'whole_item',
  'vague',
] as const

/** @deprecated V5 */
export type ConsumptionKind = (typeof CONSUMPTION_KINDS)[number]

/** @deprecated V5 — use parser quantity + unit instead */
export type ConsumptionPortion = {
  quantity: number | null
  unit: string
  kind: ConsumptionKind
}

/** @deprecated V5/V6 */
export const SERVING_RELATIONSHIPS = [
  'same_unit',
  'unit_conversion',
  'count_equivalent',
  'fraction_of_whole',
  'estimate_required',
  'unresolved',
] as const

/** @deprecated V5 */
export type ServingRelationship = (typeof SERVING_RELATIONSHIPS)[number]

/** @deprecated V5 */
export type NormalizedEstimate = {
  quantity: number
  unit: string
  estimated: boolean
}

export const UNIT_FAMILIES = ['mass', 'volume', 'count', 'serving'] as const
export type UnitFamily = (typeof UNIT_FAMILIES)[number]

/**
 * V9 AI #2 relationship classification.
 * Code computes the nutrition multiplier — AI must not return a multiplier.
 * NEEDS_UNIT_BRIDGE → AI #2 may supply bridgeQuestion + unitsPerServing; code divides.
 */
export const V8_SERVING_RELATIONSHIPS = [
  'DIRECT',
  'EQUIVALENT_COUNT',
  'WHOLE_ITEM',
  'NEEDS_UNIT_BRIDGE',
  'WRONG_MATCH',
  'NEED_MORE_CANDIDATES',
] as const
export type V8ServingRelationship = (typeof V8_SERVING_RELATIONSHIPS)[number]
/** @deprecated alias — same as V8ServingRelationship */
export type V9ServingRelationship = V8ServingRelationship

/** @deprecated V7 alias — prefer V8ServingRelationship */
export const V7_SERVING_RELATIONSHIPS = V8_SERVING_RELATIONSHIPS
/** @deprecated V7 alias */
export type V7ServingRelationship = V8ServingRelationship

/** V8/V9 parser item — quantity + singular/plural unit + family. */
export type ParserItemResponse = {
  emoji?: string
  name: string
  quantity: number
  unitSingular: string
  unitPlural: string
  unitFamily: UnitFamily
  estimated: boolean
  originalPortion: string
  notes: string
  fatSecretSearch: string
  /** @deprecated V7 — derived as display unit from singular/plural when present */
  unit?: string
}

export type ParserResponse = {
  items: ParserItemResponse[]
}

/**
 * V9 macros response — AI #2 chooses match, classifies relationship,
 * and optionally answers one unit-bridge estimate (no separate AI #3).
 */
export type MacrosAiResponse = {
  libraryIndex: number | null
  fatSecretIndex: number | null
  servingIndex: number | null
  relationship: V8ServingRelationship | null
  bridgeQuestion: string | null
  unitsPerServing: number | null
  calories: number
  protein: number
  servingType: string
}

/** @deprecated V8 AI #3 — bridge fields now live on MacrosAiResponse */
export type UnitBridgeAiResponse = {
  unitsPerServing: number
}

/** @deprecated V6 */
export type MacrosAiResponseV6 = {
  libraryIndex: number | null
  fatSecretIndex: number | null
  servingIndex: number | null
  multiplier: number
  calories: number
  protein: number
  servingType: string
}

export const PARSER_JSON_SCHEMA = {
  name: 'parser_response',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            emoji: { type: 'string' },
            name: { type: 'string' },
            quantity: { type: 'number' },
            unitSingular: { type: 'string' },
            unitPlural: { type: 'string' },
            unitFamily: { type: 'string', enum: [...UNIT_FAMILIES] },
            estimated: { type: 'boolean' },
            originalPortion: { type: 'string' },
            notes: { type: 'string' },
            fatSecretSearch: { type: 'string' },
          },
          required: [
            'emoji',
            'name',
            'quantity',
            'unitSingular',
            'unitPlural',
            'unitFamily',
            'estimated',
            'originalPortion',
            'notes',
            'fatSecretSearch',
          ],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
} as const

export const MACROS_JSON_SCHEMA = {
  name: 'macros_response',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      libraryIndex: { type: ['number', 'null'] },
      fatSecretIndex: { type: ['number', 'null'] },
      servingIndex: { type: ['number', 'null'] },
      relationship: {
        anyOf: [
          { type: 'string', enum: [...V8_SERVING_RELATIONSHIPS] },
          { type: 'null' },
        ],
      },
      bridgeQuestion: { type: ['string', 'null'] },
      unitsPerServing: { type: ['number', 'null'] },
      calories: { type: 'number' },
      protein: { type: 'number' },
      servingType: { type: 'string' },
    },
    required: [
      'libraryIndex',
      'fatSecretIndex',
      'servingIndex',
      'relationship',
      'bridgeQuestion',
      'unitsPerServing',
      'calories',
      'protein',
      'servingType',
    ],
    additionalProperties: false,
  },
} as const

/** @deprecated V8 — unused in V9 (bridge fields are on MACROS_JSON_SCHEMA) */
export const UNIT_BRIDGE_JSON_SCHEMA = {
  name: 'unit_bridge_response',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      unitsPerServing: { type: 'number' },
    },
    required: ['unitsPerServing'],
    additionalProperties: false,
  },
} as const

export const ANALYZE_FRONT_JSON_SCHEMA = {
  name: 'analyze_front_response',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      emoji: { type: 'string' },
    },
    required: ['name', 'emoji'],
    additionalProperties: false,
  },
} as const

export const ANALYZE_NUTRITION_JSON_SCHEMA = {
  name: 'analyze_nutrition_response',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      baseAmount: { type: 'string' },
      calories: { type: 'number' },
      protein: { type: 'number' },
      fat: { type: 'number' },
      carbs: { type: 'number' },
    },
    required: ['baseAmount', 'calories', 'protein', 'fat', 'carbs'],
    additionalProperties: false,
  },
} as const

export const BARCODE_SCAN_JSON_SCHEMA = {
  name: 'barcode_scan_response',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      emoji: { type: 'string' },
    },
    required: ['name', 'emoji'],
    additionalProperties: false,
  },
} as const

export type JsonSchemaFormat = {
  name: string
  strict?: boolean
  schema: Record<string, unknown>
}

export function schemaForPromptKey(key: string): JsonSchemaFormat | null {
  switch (key) {
    case 'PARSER':
      return PARSER_JSON_SCHEMA
    case 'MACROS':
      return MACROS_JSON_SCHEMA
    case 'UNIT_BRIDGE':
      return UNIT_BRIDGE_JSON_SCHEMA
    case 'ANALYZE_FRONT':
      return ANALYZE_FRONT_JSON_SCHEMA
    case 'ANALYZE_NUTRITION':
      return ANALYZE_NUTRITION_JSON_SCHEMA
    case 'BARCODE_SCAN':
      return BARCODE_SCAN_JSON_SCHEMA
    default:
      return null
  }
}
