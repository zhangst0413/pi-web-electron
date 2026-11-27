// hooks/useIsMobile as a phone: the sidebar shows the files behind their own
// tab. Stands in for the whole module, so nothing importing it breaks under
// the alias (components/SessionSidebar.tabs.test.mjs).
export function useIsMobile() {
  return true;
}

export function useIsNarrowMobile() {
  return true;
}
