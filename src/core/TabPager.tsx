import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { scrollAppMainToTop } from '../lib/scrollAppMain'
import type { BottomTab } from '../types/domain'

export const TAB_ORDER: readonly BottomTab[] = ['habits', 'macro', 'lift'] as const

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
  const marginMeasureRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<Partial<Record<BottomTab, HTMLDivElement | null>>>({})
  const prevTabRef = useRef(activeTab)
  const activeTabRef = useRef(activeTab)
  const [pageWidth, setPageWidth] = useState(0)
  const [pageMargin, setPageMargin] = useState(0)

  const activeIndex = tabIndex(activeTab)
  /**
   * Each page slot in the scroll track is (viewport − 1 margin) wide.
   * This makes the gap between neighboring page contents exactly one margin:
   *   slot N left padding = 1 margin  →  [margin][content]
   *   slot N right edge meets slot N+1 left padding → shared single margin gap
   */
  const stride = pageWidth > 0 && pageMargin > 0 ? pageWidth - pageMargin : 0

  useEffect(() => {
    activeTabRef.current = activeTab
  }, [activeTab])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const measure = () => {
      setPageWidth(viewport.clientWidth)
      setPageMargin(marginMeasureRef.current?.offsetWidth ?? 0)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(viewport)
    return () => ro.disconnect()
  }, [])

  /** On initial measure or resize: jump instantly to active tab. */
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || stride <= 0) return
    viewport.scrollLeft = activeIndex * stride
  }, [stride]) // intentionally only stride, not activeIndex

  /** Tab changes from bottom nav: animate scroll to new tab. */
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || stride <= 0) return
    const targetLeft = activeIndex * stride
    if (Math.abs(viewport.scrollLeft - targetLeft) < 2) return
    viewport.scrollTo({ left: targetLeft, behavior: 'smooth' })
  }, [activeIndex, stride])

  /** Detect user-initiated swipe settling → commit new active tab. */
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const commit = () => {
      if (stride <= 0) return
      const newIndex = Math.round(viewport.scrollLeft / stride)
      const clamped = Math.max(0, Math.min(TAB_ORDER.length - 1, newIndex))
      if (clamped !== tabIndex(activeTabRef.current)) {
        onTabChange(TAB_ORDER[clamped]!)
      }
    }

    viewport.addEventListener('scrollend', commit)
    return () => viewport.removeEventListener('scrollend', commit)
  }, [onTabChange, stride])

  /** Scroll previous page to top when leaving it. */
  useEffect(() => {
    const left = prevTabRef.current
    if (left !== activeTab) {
      pageRefs.current[left]?.scrollTo({ top: 0, behavior: 'auto' })
      scrollAppMainToTop()
      prevTabRef.current = activeTab
    }
  }, [activeTab])

  const slotStyle = stride > 0 ? { width: `${stride}px` } : undefined
  const frameStyle = pageMargin > 0 ? { paddingLeft: `${pageMargin}px` } : undefined
  const trailStyle = pageMargin > 0 ? { width: `${pageMargin}px` } : undefined

  return (
    <div
      ref={viewportRef}
      className={`tab-pager-viewport flex-1 min-h-0 w-full ${className ?? ''}`}
    >
      <div ref={marginMeasureRef} className="tab-pager-margin-measure" aria-hidden />
      <div className="tab-pager-track">
        {TAB_ORDER.map((tab) => (
          <div
            key={tab}
            ref={(el) => { pageRefs.current[tab] = el }}
            style={slotStyle}
            className="tab-pager-page"
            aria-hidden={tab !== activeTab}
          >
            <div
              className="tab-pager-frame pb-[var(--app-main-pad-bottom)] has-[[data-macro-diet-page]]:pb-0"
              style={frameStyle}
            >
              {pages[tab]}
            </div>
          </div>
        ))}
        {/* trailing gutter gives the last page a visible right margin */}
        <div className="tab-pager-trailing" style={trailStyle} aria-hidden />
      </div>
    </div>
  )
}
