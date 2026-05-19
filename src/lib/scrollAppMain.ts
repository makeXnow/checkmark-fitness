/** Scroll the active tab page (and legacy #app-main if it ever scrolls). */
export function scrollAppMainToTop(): void {
  document.getElementById('app-main')?.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  document
    .querySelector<HTMLElement>('.tab-pager-page[aria-hidden="false"]')
    ?.scrollTo({ top: 0, left: 0, behavior: 'auto' })
}
