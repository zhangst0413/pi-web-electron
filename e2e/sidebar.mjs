import assert from "node:assert/strict";

/*
 * The sidebar's sessions and files in either layout: on a desktop the files
 * sit below the sessions by default (both in view; the files section may be
 * folded to its header row), phones and Settings › General › File browser
 * "Separate tab" show one tab at a time. Both panels keep their ids in both.
 */

/** Shows the explorer: the Files tab, or the files section opened. */
export async function showSidebarFiles(page) {
  const files = page.locator("#session-sidebar-panel-files");
  const tab = page.getByRole("tab", { name: "Files", exact: true });
  const toggle = files.locator(".sidebar-files-section-toggle");
  await tab.or(toggle).first().waitFor();
  if (await tab.count()) {
    if (await tab.getAttribute("aria-selected") !== "true") await tab.click();
  } else if (await toggle.getAttribute("aria-expanded") !== "true") {
    await toggle.click();
  }
  await files.locator(".sidebar-files-body").waitFor({ state: "visible" });
}

/** Shows the session rows: the Sessions tab, or nothing to do below the files. */
export async function showSidebarSessions(page) {
  const tab = page.getByRole("tab", { name: "Sessions", exact: true });
  await tab.or(page.locator(".sidebar-brand")).first().waitFor();
  if (await tab.count() && await tab.getAttribute("aria-selected") !== "true") await tab.click();
  await page.locator("#session-sidebar-panel-sessions").waitFor({ state: "visible" });
}

/**
 * A desktop shows both regions at once: the sessions, then the files below
 * them, with no tab strip. A phone shows the files behind their own tab
 * (SessionSidebar picks that layout from the phone breakpoint).
 */
export async function checkFilesBelowSessions(page) {
  const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
  if (await showSidebar.isVisible()) await showSidebar.click();
  const sessions = page.getByRole("region", { name: "Sessions", exact: true });
  const files = page.getByRole("region", { name: "Files", exact: true });
  const tablist = page.getByRole("tablist", { name: "Sidebar view", exact: true });
  await sessions.waitFor();
  await files.waitFor();
  assert.equal(await tablist.count(), 0, "No tabs: the files sit below the sessions");
  await showSidebarFiles(page);
  await page.getByRole("separator", { name: "Resize file browser", exact: true }).waitFor();
  const fileSearch = files.getByRole("button", { name: "Search files", exact: true });
  const fileQuery = page.locator("#file-search-input");
  if (await fileSearch.getAttribute("aria-expanded") !== "true") await fileSearch.click();
  await fileQuery.fill("e2e-placement");
  assert.equal(await fileQuery.inputValue(), "e2e-placement");
  await fileQuery.fill("");
  await fileSearch.click();
  await fileQuery.waitFor({ state: "detached" });
}
