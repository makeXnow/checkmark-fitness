type PlateContext = {
  availablePlates: number[]
  plateIdx: Record<number, number>
  smallestPlate: number
}

type SeqEntry = {
  seq: number[]
  seqStr: string
  len: number
  weightDoubled: number
  inversions: number
}

type DpState = {
  cost: number
  parent: DpState | null
  plates: number[]
  len: number
  weightDoubled: number
  inversions: number
  idx: number
}

type TrieNode = {
  children: (TrieNode | null)[]
  bestP: DpState | null
  bestPScore: number
}

const M_SCORE = 100_000_000
const W_SCORE = 10_000
const I_SCORE = 1

const globalSeqCache = new Map<string, SeqEntry[]>()

function buildPlateContext(availablePlates: number[]): PlateContext | null {
  const sorted = [...(availablePlates || [])].filter((p) => p > 0).sort((a, b) => b - a)
  if (sorted.length === 0) return null
  const plateIdx: Record<number, number> = {}
  sorted.forEach((p, i) => {
    plateIdx[p] = i
  })
  return { availablePlates: sorted, plateIdx, smallestPlate: sorted[sorted.length - 1] }
}

function sideWeightForTarget(targetWeight: number, barWeight: number, smallestPlate: number): number {
  const bw = barWeight || 0
  const tw = typeof targetWeight === 'number' && !Number.isNaN(targetWeight) ? targetWeight : bw
  if (tw <= bw) return 0
  const rawPerSide = (tw - bw) / 2
  return Math.round(rawPerSide / smallestPlate) * smallestPlate
}

/** Max count per plate size on one side (matches prototype: pairs for most, many 45s). */
function plateLimit(plate: number, ctx: PlateContext): number {
  const largest = ctx.availablePlates[0]
  if (plate === largest) return 20
  return 2
}

function getValidCombinations(targetWeight: number, ctx: PlateContext): number[][] {
  if (targetWeight <= 0) return [[]]
  const results: number[][] = []
  let minLen = Infinity
  let iterations = 0
  const { availablePlates } = ctx

  const search = (remaining: number, plateIdx: number, currentCounts: number[], currentLen: number) => {
    if (iterations++ > 50_000) return
    if (currentLen > minLen + 3) return
    if (Math.abs(remaining) < 0.01) {
      if (currentLen < minLen) minLen = currentLen
      const combo: number[] = []
      for (let i = 0; i < availablePlates.length; i++) {
        for (let j = 0; j < currentCounts[i]; j++) combo.push(availablePlates[i])
      }
      results.push(combo)
      return
    }
    if (remaining < 0 || plateIdx >= availablePlates.length) return

    const p = availablePlates[plateIdx]
    const maxCount = Math.min(plateLimit(p, ctx), Math.floor((remaining + 0.01) / p))

    for (let count = maxCount; count >= 0; count--) {
      currentCounts[plateIdx] = count
      search(remaining - count * p, plateIdx + 1, currentCounts, currentLen + count)
      currentCounts[plateIdx] = 0
    }
  }

  search(targetWeight, 0, new Array(availablePlates.length).fill(0), 0)
  return results.filter((c) => c.length <= minLen + 3)
}

function getUniquePermutations(arr: number[]): number[][] {
  const results: number[][] = []
  const counts = new Map<number, number>()
  for (const num of arr) counts.set(num, (counts.get(num) || 0) + 1)
  const uniquePlates = Array.from(counts.keys())

  const permute = (current: number[]) => {
    if (current.length === arr.length) {
      results.push([...current])
      return
    }
    for (const num of uniquePlates) {
      const c = counts.get(num)!
      if (c > 0) {
        counts.set(num, c - 1)
        current.push(num)
        permute(current)
        current.pop()
        counts.set(num, c)
      }
    }
  }

  permute([])
  return results
}

function seqCacheKey(sideWeight: number, ctx: PlateContext): string {
  return `${sideWeight}|${ctx.availablePlates.join(',')}`
}

function getSequences(sideWeight: number, ctx: PlateContext): SeqEntry[] {
  const key = seqCacheKey(sideWeight, ctx)
  const cached = globalSeqCache.get(key)
  if (cached) return cached

  const combos = getValidCombinations(sideWeight, ctx)
  const rawSeqs: number[][] = []
  for (const combo of combos) {
    const perms = getUniquePermutations(combo)
    for (let i = 0; i < perms.length; i++) rawSeqs.push(perms[i])
  }

  const validSeqs = rawSeqs.map((seq) => {
    let weight = 0
    let inversions = 0
    const len = seq.length
    for (let i = 0; i < len; i++) {
      weight += seq[i]
      for (let j = i + 1; j < len; j++) {
        if (seq[i] < seq[j]) inversions++
      }
    }
    return { seq, seqStr: seq.join(','), len, weightDoubled: weight * 2, inversions }
  })

  globalSeqCache.set(key, validSeqs)
  return validSeqs
}

function rebuildPath(state: DpState | null): number[][] {
  const path: number[][] = []
  let curr = state
  while (curr && curr.plates.length >= 0 && curr.parent !== null) {
    path.push(curr.plates)
    curr = curr.parent
  }
  return path.reverse()
}

function createTrieNode(plateCount: number): TrieNode {
  return { children: new Array(plateCount).fill(null), bestP: null, bestPScore: Infinity }
}

function updateTrieBest(node: TrieNode, p: DpState, pScore: number) {
  if (pScore < node.bestPScore || (pScore === node.bestPScore && node.bestP && p.idx < node.bestP.idx)) {
    node.bestPScore = pScore
    node.bestP = p
  }
}

/**
 * Prefix-trie DP: given per-set target weights (and bar weights), returns ordered plate stacks
 * (inner collar → outer) per set. Call with all sets for a day to optimize across exercises.
 */
export function calculateOptimizedPlateOrder(
  targetWeights: number[],
  barWeights: number | number[],
  availablePlates: number[],
): number[][] {
  const ctx = buildPlateContext(availablePlates)
  if (!ctx || targetWeights.length === 0) {
    return targetWeights.map(() => [])
  }

  const barWeightsPerSet =
    typeof barWeights === 'number' ? targetWeights.map(() => barWeights) : barWeights
  const sideWeights = targetWeights.map((tw, i) =>
    sideWeightForTarget(tw, barWeightsPerSet[i] ?? 0, ctx.smallestPlate),
  )

  const initial: DpState = {
    cost: 0,
    parent: null,
    plates: [],
    len: 0,
    weightDoubled: 0,
    inversions: 0,
    idx: 0,
  }

  const dp: Map<string, DpState>[] = [new Map([['', initial]])]

  for (let layer = 0; layer < sideWeights.length; layer++) {
    const sideWeight = sideWeights[layer]
    const validSeqs = getSequences(sideWeight, ctx)
    const plateCount = ctx.availablePlates.length

    const root = createTrieNode(plateCount)
    for (const P of dp[layer].values()) {
      const pScore = P.cost + P.len * M_SCORE + P.weightDoubled * W_SCORE
      let curr = root
      updateTrieBest(curr, P, pScore)

      for (let i = 0; i < P.len; i++) {
        const pIdx = ctx.plateIdx[P.plates[i]]
        if (!curr.children[pIdx]) curr.children[pIdx] = createTrieNode(plateCount)
        curr = curr.children[pIdx]!
        updateTrieBest(curr, P, pScore)
      }
    }

    const nextLayer = new Map<string, DpState>()
    let nextIdx = 0

    for (const C of validSeqs) {
      const cScoreWithoutInversions = C.len * M_SCORE + C.weightDoubled * W_SCORE
      const cScore = cScoreWithoutInversions + C.inversions * I_SCORE

      let minComparisonCost = Infinity
      let minActualCost = Infinity
      let bestPrev: DpState | null = null
      let bestLegacyIdx = Infinity
      let curr = root
      let prefLen = 0
      let prefWeightDoubled = 0

      while (true) {
        if (curr.bestP) {
          const prefScore = 2 * prefLen * M_SCORE + 2 * prefWeightDoubled * W_SCORE
          const tCost = curr.bestPScore + cScore - prefScore

          if (tCost < minComparisonCost || (tCost === minComparisonCost && curr.bestP.idx < bestLegacyIdx)) {
            minComparisonCost = tCost
            bestPrev = curr.bestP
            bestLegacyIdx = curr.bestP.idx
            minActualCost = curr.bestPScore + cScoreWithoutInversions - prefScore
          }
        }

        if (prefLen < C.len) {
          const plate = C.seq[prefLen]
          const pIdx = ctx.plateIdx[plate]
          if (curr.children[pIdx]) {
            curr = curr.children[pIdx]!
            prefLen++
            prefWeightDoubled += plate * 2
          } else {
            break
          }
        } else {
          break
        }
      }

      nextLayer.set(C.seqStr, {
        cost: minActualCost,
        parent: bestPrev,
        plates: C.seq,
        len: C.len,
        weightDoubled: C.weightDoubled,
        inversions: C.inversions,
        idx: nextIdx++,
      })
    }

    dp.push(nextLayer)
  }

  const finalLayer = dp[dp.length - 1]
  let bestFinalState: DpState | null = null
  let minFinalCost = Infinity

  for (const state of finalLayer.values()) {
    const comparisonCost = state.cost + state.inversions * I_SCORE
    if (
      comparisonCost < minFinalCost ||
      (comparisonCost === minFinalCost && bestFinalState && state.idx < bestFinalState.idx)
    ) {
      minFinalCost = comparisonCost
      bestFinalState = state
    }
  }

  if (!bestFinalState) {
    return sideWeights.map(() => [])
  }

  return rebuildPath(bestFinalState)
}
