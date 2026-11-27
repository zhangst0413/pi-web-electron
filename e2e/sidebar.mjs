/*
 * The sidebar: one panel, the project and worktree picker over the session
 * tree, with no tabs and no files section.
 */

/** The session rows, open on a phone's drawer too. */
export async function showSidebarSessions(page) {
  const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
  if (await showSidebar.isVisible()) await showSidebar.click();
  await page.locator(".sidebar-brand").waitFor();
  await page.locator(".sidebar-sessions-panel").waitFor({ state: "visible" });
}

/** One panel: the brand, the picker over the tree, no tab strip, no files section. */
export async function checkSidebarLayout(page) {
  await showSidebarSessions(page);
  assert.equal(await page.getByRole("tablist").count(), 0, "No tabs");
  assert.equal(await page.locator("#session-sidebar-panel-files").count(), 0, "No files panel");
  await page.locator(".sidebar-sessions-panel .project-picker").waitFor();
}
