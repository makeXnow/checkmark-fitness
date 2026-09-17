import type { BootstrapResponse } from '../types/domain'

function bundleUpdatedAt(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export type PreferNewerBootstrapResult = {
  data: BootstrapResponse
  /** True when a local bundle was kept because it was newer than the incoming payload. */
  keptLocal: { macro: boolean; habits: boolean; lift: boolean }
}

/**
 * When applying bootstrap (cache, HTTP-cached fetch, or resync), never clobber in-memory
 * edits that already have a newer updatedAt than the payload.
 */
export function preferNewerBootstrapBundles(
  incoming: BootstrapResponse,
  local: BootstrapResponse | null | undefined,
): PreferNewerBootstrapResult {
  if (!local) {
    return {
      data: incoming,
      keptLocal: { macro: false, habits: false, lift: false },
    }
  }

  const keptLocal = {
    macro: bundleUpdatedAt(local.macro.updatedAt) > bundleUpdatedAt(incoming.macro.updatedAt),
    habits: bundleUpdatedAt(local.habits.updatedAt) > bundleUpdatedAt(incoming.habits.updatedAt),
    lift: bundleUpdatedAt(local.lift.updatedAt) > bundleUpdatedAt(incoming.lift.updatedAt),
  }

  if (!keptLocal.macro && !keptLocal.habits && !keptLocal.lift) {
    return { data: incoming, keptLocal }
  }

  return {
    data: {
      ...incoming,
      macro: keptLocal.macro ? local.macro : incoming.macro,
      habits: keptLocal.habits ? local.habits : incoming.habits,
      lift: keptLocal.lift ? local.lift : incoming.lift,
    },
    keptLocal,
  }
}
