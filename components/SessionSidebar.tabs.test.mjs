import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

// The tabs layout's markup (a phone's), rendered. useIsMobile answers false
// on the server, so the hook is aliased to a fixture that answers true. The
// alias takes the module's absolute path without its extension ("@/…"
// resolves first and is never matched), in the form jiti compares it with:
// forward slashes and an upper-case drive letter on Windows (#1211). It
// needs a process of its own: SessionSidebar.test.mjs has already loaded the
// sidebar with the real hook, and jiti shares Node's module cache.
const isMobileHook = fileURLToPath(new URL("../hooks/useIsMobile", import.meta.url))
  .replaceAll("\\", "/")
  .replace(/^[a-z]:/, (drive) => drive.toUpperCase());
const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
  alias: {
    [isMobileHook]: fileURLToPath(new URL("./__fixtures__/mobile-viewport.mjs", import.meta.url)),
  },
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { SessionSidebar } = await jiti.import("./SessionSidebar.tsx");

const h = React.createElement;
const noop = () => {};

function render(props = {}) {
  return renderToStaticMarkup(h(I18nProvider, null, h(SessionSidebar, {
    selectedSessionId: null,
    onSelectSession: noop,
    ...props,
  })));
}

test("a phone renders the same layout: the brand, the project picker above the tree, no tabs", () => {
  const html = render({ selectedCwd: "/work/alpha" });
  assert.match(html, /^<div class="session-sidebar"><div class="sidebar-header"><button type="button" class="sidebar-brand"/);
  assert.doesNotMatch(html, /role="tablist"|role="tab"|sidebar-tabs-list|sidebar-files-section|sidebar-files-keys/);
  // One panel, with the project and worktree picker on top of the tree.
  assert.match(html, /<div id="session-sidebar-panel-sessions" class="sidebar-panel sidebar-sessions-panel"><div class="sidebar-picker-row"><div class="project-picker is-row" role="group"/);
  assert.doesNotMatch(html, /aria-controls="file-search-input"/);
  // The toolbar's search is the sessions'.
  assert.match(html, /aria-controls="session-search-input"/);
});
