import type { BootstrapResponse } from '../types/domain'

function bundleUpdatedAt(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export type PreferNewerBootstrapResult = {
  data: BootstrapResponse
  /** Recover cached diary days omitted by a whole-bundle server write. */
  recoveredMacroDays: boolean
  /** True when a local bundle was kept because it was newer than the incoming payload. */
  keptLocal: { macro: boolean; habits: boolean; lift: boolean }
}

/**
 * When applying bootstrap (cache, HTTP-cached fetch, or resync), never clobber in-memory
 * edits that already have a newer updatedAt than the payload. Recover diary days
 * omitted from a newer macro bundle; an explicit day list still controls deletions.
 */
export function preferNewerBootstrapBundles(
  incoming: BootstrapResponse,
  local: BootstrapResponse | null | undefined,
): PreferNewerBootstrapResult {
  if (!local) {
    return {
      data: incoming,
      recoveredMacroDays: false,
      keptLocal: { macro: false, habits: false, lift: false },
    }
  }

  const keptLocal = {
    macro: bundleUpdatedAt(local.macro.updatedAt) > bundleUpdatedAt(incoming.macro.updatedAt),
    habits: bundleUpdatedAt(local.habits.updatedAt) > bundleUpdatedAt(incoming.habits.updatedAt),
    lift: bundleUpdatedAt(local.lift.updatedAt) > bundleUpdatedAt(incoming.lift.updatedAt),
  }

  // A bundle timestamp covers settings and normalization writes too. A newer
  // timestamp does not mean an omitted diary day was intentionally deleted.
  // Deleting the last food leaves an explicit [] day, which remains authoritative.
  const missingDays = !keptLocal.macro
    ? Object.entries(local.macro.logs).filter(
        ([day, items]) => items.length > 0 && !Object.prototype.hasOwnProperty.call(incoming.macro.logs, day),
      )
    : []
  const recoveredMacroDays = missingDays.length > 0
  const macro = recoveredMacroDays
    ? { ...incoming.macro, logs: { ...incoming.macro.logs, ...Object.fromEntries(missingDays) } }
    : incoming.macro

  if (!keptLocal.macro && !keptLocal.habits && !keptLocal.lift && !recoveredMacroDays) {
    return { data: incoming, keptLocal, recoveredMacroDays }
  }

  return {
    data: {
      ...incoming,
      macro: keptLocal.macro ? local.macro : macro,
      habits: keptLocal.habits ? local.habits : incoming.habits,
      lift: keptLocal.lift ? local.lift : incoming.lift,
    },
    keptLocal,
    recoveredMacroDays,
  }
}
