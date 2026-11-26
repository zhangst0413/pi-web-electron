"use client";

/**
 * Pi Web has one palette, the dark one: `lib/theme.ts` sets `data-theme="dark"` and `html.dark`
 * before first paint. Components that render with their own colors (Mermaid, Prism) read
 * `isDark` so those colors keep matching the page.
 */
export function useTheme() {
  return { isDark: true };
}
