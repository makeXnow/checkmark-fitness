/** Scroll the active tab page to the top. */
export function scrollAppMainToTop(): void {
  document.getElementById('app-main')?.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  document
    .querySelector<HTMLElement>('.tab-pager-page[aria-hidden="false"]')
    ?.scrollTo({ top: 0, left: 0, behavior: 'auto' })
}
