import { useEffect, type RefObject } from 'react'

/** Matches InteractionDock gradient (`h-6`) — treated as obscuring the scroll viewport bottom. */
export const MACRO_DIET_BOTTOM_GRADIENT_INSET_PX = 24

export function scrollIntoViewWithin(
  target: HTMLElement,
  container: HTMLElement,
  options?: {
    bottomInset?: number
    topInset?: number
    behavior?: ScrollBehavior
  },
): void {
  const topInset = options?.topInset ?? 0
  const bottomInset = options?.bottomInset ?? 0
  const behavior = options?.behavior ?? 'smooth'

  const containerRect = container.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()

  const visibleTop = containerRect.top + topInset
  const visibleBottom = containerRect.bottom - bottomInset

  let delta = 0
  if (targetRect.top < visibleTop) {
    delta = targetRect.top - visibleTop
  } else if (targetRect.bottom > visibleBottom) {
    delta = targetRect.bottom - visibleBottom
  }

  if (Math.abs(delta) >= 1) {
    container.scrollBy({ top: delta, behavior })
  }
}

function scheduleScrollIntoView(
  target: HTMLElement,
  container: HTMLElement,
  bottomInset: number,
): () => void {
  let cancelled = false
  const outer = requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (cancelled) return
      scrollIntoViewWithin(target, container, { bottomInset })
    })
  })
  return () => {
    cancelled = true
    cancelAnimationFrame(outer)
  }
}

/** Scroll `targetRef` into `containerRef` when `active`, re-running when `deps` change. */
export function useScrollIntoViewWithin(
  active: boolean,
  targetRef: RefObject<HTMLElement | null>,
  containerRef: RefObject<HTMLElement | null>,
  deps: unknown[] = [],
  bottomInset = MACRO_DIET_BOTTOM_GRADIENT_INSET_PX,
): void {
  useEffect(() => {
    if (!active) return
    const target = targetRef.current
    const container = containerRef.current
    if (!target || !container) return
    return scheduleScrollIntoView(target, container, bottomInset)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller controls extra deps
  }, [active, bottomInset, containerRef, targetRef, ...deps])
}
