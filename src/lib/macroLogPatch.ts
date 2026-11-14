/** The server merges days. Keep explicit empty days so deleting the last food sticks. */
export function macroLogPatch<T>(previous: Record<string, T>, next: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(next).filter(([day, items]) =>
    JSON.stringify(previous[day]) !== JSON.stringify(items),
  ))
}
