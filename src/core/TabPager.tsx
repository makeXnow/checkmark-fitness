import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { scrollAppMainToTop } from '../lib/scrollAppMain'
import type { BottomTab } from '../types/domain'

export const TAB_ORDER: readonly BottomTab[] = ['habits', 'macro', 'lift'] as const

const NO_SWIPE_SELECTOR =
  'input, textarea, select, button, a, [role="slider"], [data-no-swipe], summary, [contenteditable="true"]'

function tabIndex(tab: BottomTab): number {
  return TAB_ORDER.indexOf(tab)
}

export type TabPagerProps = {
  activeTab: BottomTab
  onTabChange: (tab: BottomTab) => void
  pages: Record<BottomTab, ReactNode>
  className?: string
}

export function TabPager({ activeTab, onTabChange, pages, className }: TabPagerProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const gapMeasureRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<Partial<Record<BottomTab, HTMLDivElement | null>>>({})
  const prevTabRef = useRef(activeTab)
  const [pageWidth, setPageWidth] = useState(0)
  const [pageGap, setPageGap] = useState(0)
  const [dragOffset, setDragOffset] = useState(0)
  const dragOffsetRef = useRef(0)
  const [isDragging, setIsDragging] = useState(false)

  const dragState = useRef<{
    startX: number
    startY: number
    locked: 'h' | 'v' | null
    pointerId: number
    lastX: number
    lastT: number
  } | null>(null)

  const activeIndex = tabIndex(activeTab)
  const pageStride = pageWidth + pageGap

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport) return

    const measure = () => {
      setPageWidth(viewport.clientWidth)
      setPageGap(gapMeasureRef.current?.offsetWidth ?? 0)
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(viewport)
    if (track) ro.observe(track)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    dragOffsetRef.current = dragOffset
  }, [dragOffset])

  useEffect(() => {
    if (!isDragging) setDragOffset(0)
  }, [activeTab, isDragging])

  /** Leaving a tab resets its scroll so swiping back always starts at the top. */
  useEffect(() => {
    const left = prevTabRef.current
    if (left !== activeTab) {
      pageRefs.current[left]?.scrollTo({ top: 0, left: 0, behavior: 'auto' })
      scrollAppMainToTop()
      prevTabRef.current = activeTab
    }
  }, [activeTab])

  const rubberBand = useCallback(
    (offset: number, index: number) => {
      if (index <= 0 && offset > 0) return offset * 0.32
      if (index >= TAB_ORDER.length - 1 && offset < 0) return offset * 0.32
      return offset
    },
    [],
  )

  const commitSwipe = useCallback(
    (offset: number, velocityX: number) => {
      if (pageStride <= 0) {
        setDragOffset(0)
        setIsDragging(false)
        return
      }

      const distanceThreshold = pageStride * 0.18
      const velocityThreshold = 0.45

      let nextIndex = activeIndex
      if (offset < -distanceThreshold || velocityX < -velocityThreshold) {
        nextIndex = Math.min(activeIndex + 1, TAB_ORDER.length - 1)
      } else if (offset > distanceThreshold || velocityX > velocityThreshold) {
        nextIndex = Math.max(activeIndex - 1, 0)
      }

      if (nextIndex !== activeIndex) {
        onTabChange(TAB_ORDER[nextIndex]!)
      }

      setDragOffset(0)
      setIsDragging(false)
      dragState.current = null
    },
    [activeIndex, onTabChange, pageStride],
  )

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      const target = e.target as HTMLElement
      if (target.closest(NO_SWIPE_SELECTOR)) return

      dragState.current = {
        startX: e.clientX,
        startY: e.clientY,
        locked: null,
        pointerId: e.pointerId,
        lastX: e.clientX,
        lastT: performance.now(),
      }
      // Do not capture on touch start — capture blocks native scroll on the tab page (mobile).
    },
    [],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const state = dragState.current
      if (!state || state.pointerId !== e.pointerId) return

      const dx = e.clientX - state.startX
      const dy = e.clientY - state.startY

      if (!state.locked) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
        if (Math.abs(dy) > Math.abs(dx)) {
          dragState.current = null
          return
        }
        state.locked = 'h'
        setIsDragging(true)
        viewportRef.current?.setPointerCapture(e.pointerId)
      }

      if (state.locked !== 'h') return

      e.preventDefault()
      state.lastX = e.clientX
      state.lastT = performance.now()
      setDragOffset(rubberBand(dx, activeIndex))
    },
    [activeIndex, rubberBand],
  )

  const finishPointer = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const state = dragState.current
      if (!state || state.pointerId !== e.pointerId) return

      if (state.locked === 'h') {
        viewportRef.current?.releasePointerCapture(e.pointerId)
      }

      if (state.locked === 'h') {
        const dt = Math.max(performance.now() - state.lastT, 1)
        const velocityX = (e.clientX - state.lastX) / dt
        commitSwipe(dragOffsetRef.current, velocityX)
      } else {
        setIsDragging(false)
        setDragOffset(0)
        dragState.current = null
      }
    },
    [commitSwipe],
  )

  const translateX = pageStride > 0 ? -activeIndex * pageStride + dragOffset : 0

  return (
    <div
      ref={viewportRef}
      className={`tab-pager-viewport flex min-h-0 w-full flex-1 flex-col overflow-hidden ${className ?? ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
    >
      <div ref={gapMeasureRef} className="tab-pager-gap-measure" aria-hidden />
      <div
        ref={trackRef}
        className={`tab-pager-track flex h-full min-h-0 ${isDragging ? '' : 'tab-pager-track--animating'}`}
        style={{
          transform: pageStride > 0 ? `translate3d(${translateX}px, 0, 0)` : undefined,
          visibility: pageStride > 0 ? 'visible' : 'hidden',
        }}
      >
        {TAB_ORDER.map((tab, index) => (
          <Fragment key={tab}>
            <div
              ref={(el) => {
                pageRefs.current[tab] = el
              }}
              style={pageWidth > 0 ? { width: pageWidth, flex: `0 0 ${pageWidth}px` } : undefined}
              className={`tab-pager-page flex min-h-0 max-w-full min-w-0 flex-shrink-0 flex-col overscroll-y-contain ${
                tab !== activeTab && !isDragging
                  ? 'pointer-events-none invisible h-0 overflow-hidden'
                  : 'h-full overflow-y-auto'
              }`}
              aria-hidden={tab !== activeTab && !isDragging}
            >
              {pages[tab]}
            </div>
            {index < TAB_ORDER.length - 1 ? (
              <div className="tab-pager-gap" aria-hidden />
            ) : null}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
