import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";
import ts from "typescript";
import vm from "node:vm";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { SessionSidebar, sameIdsOr } = await jiti.import("./SessionSidebar.tsx");
const { buildSessionTree, getRowOffsets, getVisibleRowIndices } = await jiti.import("@/lib/session-tree.ts");

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const sidebarStyles = await readFile(new URL("../app/sidebar.css", import.meta.url), "utf8");

const h = React.createElement;
const noop = () => {};
const BASE = Date.parse("2026-10-01T00:00:00.000Z");

function between(startAnchor, endAnchor) {
  const start = source.indexOf(startAnchor);
  const end = source.indexOf(endAnchor, start + startAnchor.length);
  assert.notEqual(start, -1, `${startAnchor} not found`);
  assert.notEqual(end, -1, `${endAnchor} not found after ${startAnchor}`);
  return source.slice(start, end);
}

/** A sidebar callback's body: from its declaration to the next `const` of the component. */
function callbackBody(name) {
  return between(`const ${name} = `, "\n  const ");
}

function session(id, { project = "/work/alpha", modified = BASE, ...rest } = {}) {
  const time = new Date(modified).toISOString();
  return {
    path: `${project}/${id}.jsonl`,
    id,
    cwd: project,
    projectRoot: project,
    projectKey: project,
    created: time,
    modified: time,
    messageCount: 1,
    firstMessage: id,
    ...rest,
  };
}

function treeInput(overrides = {}) {
  return {
    sessions: [],
    uiState: { version: 1, revision: 0, sessions: {}, projects: {} },
    runningIds: new Set(),
    unreadIds: new Set(),
    selectedSessionId: null,
    currentProject: null,
    groupExpansion: {},
    moreShown: {},
    pinnedCollapsed: false,
    ...overrides,
  };
}

function render(props = {}) {
  return renderToStaticMarkup(h(I18nProvider, null, h(SessionSidebar, {
    selectedSessionId: null,
    onSelectSession: noop,
    ...props,
  })));
}

test("scrolling keeps the focused session and the viewport mounted without expanding the whole tree", () => {
  const sessions = Array.from({ length: 2000 }, (_, index) => session(`s${index}`, { modified: BASE - index * 60_000 }));
  const { rows } = buildSessionTree(treeInput({ sessions, currentProject: { key: "/work/alpha", root: "/work/alpha" }, moreShown: { "/work/alpha": 5000 } }));
  const offsets = getRowOffsets(rows, "desktop");
  const lastSessionIndex = rows.findLastIndex((row) => row.kind === "session");
  for (const [scrollTop, focusedIndex] of [[0, lastSessionIndex], [30000, 1]]) {
    const indices = getVisibleRowIndices(offsets, scrollTop, 335, 240, [focusedIndex]);
    for (let index = 0; index < rows.length; index++) {
      const intersects = offsets[index + 1] > scrollTop && offsets[index] < scrollTop + 335;
      if (intersects) assert.ok(indices.includes(index), `row ${index} in the viewport is mounted`);
    }
    assert.ok(indices.includes(focusedIndex), "an inline rename survives scrolling");
    assert.ok(indices.length < 60, "only a window of the tree is mounted");
    assert.equal(new Set(indices).size, indices.length);
    assert.deepEqual(indices, [...indices].sort((a, b) => a - b));
  }
});

test("side chats fold into their main session row, which carries their running, unread and selected state", () => {
  const child = session("child", { relation: { kind: "side", parentSessionId: "main" } });
  const { rows } = buildSessionTree(treeInput({
    sessions: [session("main"), child],
    runningIds: new Set(["child"]),
    unreadIds: new Set(["child"]),
    selectedSessionId: "child",
    currentProject: { key: "/work/alpha", root: "/work/alpha" },
  }));
  const sessionRows = rows.filter((row) => row.kind === "session");
  assert.deepEqual(sessionRows.map((row) => row.family.root.id), ["main"]);
  assert.deepEqual(sessionRows[0].status, { running: true, awaiting: false, unread: true, selected: true, transient: false });
});

test("a deleted family's stored drafts go with it, only once the server deleted it", async () => {
  const code = ts.transpileModule(`(${callbackBody("performDelete").replace(/^const performDelete = /, "").replace(/;\s*$/, "")})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const ok of [true, false]) {
    const cleared = [];
    const deleted = [];
    const performDelete = vm.runInNewContext(code, {
      useCallback: (callback) => callback,
      encodeURIComponent,
      fetch: async () => ({ ok }),
      clearDraft: (id) => cleared.push(id),
      onSessionDeleted: (id) => deleted.push(id),
      setConfirmDeleteRootId() {},
      loadSessions: async () => {},
    });
    await performDelete({ root: session("main"), members: [session("side"), session("worker")] });
    assert.deepEqual(cleared, ok ? ["main", "side", "worker"] : []);
    assert.deepEqual(deleted, ["main"]);
  }
  // A project's Delete all sessions clears what the server says it deleted.
  assert.match(callbackBody("deleteFamilyIds"), /for \(const id of outcome\.deleted\) \{\s*clearDraft\(id\);/);
});

test("only Shift skips the session deletion confirmation", () => {
  assert.match(
    callbackBody("requestDelete"),
    /if \(shiftKey\) \{\s*void performDelete\(family\);\s*\} else \{[\s\S]*?setConfirmDeleteRootId\(family\.root\.id\);/,
  );
});

test("one layout: the brand, the project picker, the sessions — no files section", () => {
  // The server renders a desktop (useIsMobile's server snapshot).
  const html = render({ selectedCwd: "/work/alpha" });
  assert.match(html, /^<div class="session-sidebar"><div class="sidebar-header"><button type="button" class="sidebar-brand"/);
  // The brand (its name says the versions a click shows), then New and the sessions' search.
  assert.match(html, /<span class="sidebar-header-spacer"><\/span><button type="button" class="sidebar-new-button"/);
  assert.doesNotMatch(html, /role="tablist"|role="tab"|role="tabpanel"|sidebar-title/);
  assert.match(html, /<span class="sidebar-new-label">新建<\/span><\/button><button type="button" title="搜索对话" aria-label="搜索对话" aria-expanded="false" aria-controls="session-search-input" class="sidebar-search-toggle">/);
  // One panel: the picker's row over the tree.
  assert.match(html, /<div id="session-sidebar-panel-sessions" class="sidebar-panel sidebar-sessions-panel"><div class="sidebar-picker-row">/);
  assert.doesNotMatch(html, /session-sidebar-panel-files|sidebar-files-section|sidebar-files-keys|sidebar-files-scroll|role="separator"|文件操作|搜索文件/);
  // Pins and archive not loaded yet: the tree waits instead of flashing archived rows.
  assert.match(html, /<div class="session-tree-message">加载中\.\.\.<\/div>/);
});

test("the fold's and the archive view's motions in the CSS last as long as the hook's phase", async () => {
  const { SIDEBAR_MOTION_MS } = await jiti.import("@/hooks/useSidebarMotion.ts");
  // A phase ends on its element's own end event, else a little after
  // SIDEBAR_MOTION_MS (hooks/useSidebarMotion.ts): every motion it waits for
  // lasts that long.
  for (const [selector, property] of [
    [".sidebar-archive-view.is-entering", "animation"],
    [".sidebar-archive-view.is-leaving", "animation"],
  ]) {
    assert.match(sidebarRule(selector), new RegExp(`(?:^|[\\s])${property}: [\\w-]+ ${SIDEBAR_MOTION_MS}ms `), selector);
  }
});

test("still, the sidebar renders as it did before it moved: nothing inert, no archive view", () => {
  const html = render({ selectedCwd: "/work/alpha" });
  assert.doesNotMatch(html, / inert[ =>]|sidebar-archive-view|is-entering|is-leaving/);
  assert.match(html, /<div class="sidebar-sessions-views"><div class="sidebar-sessions-view">/);
});

/** A rule's declarations in app/sidebar.css (its first rule for the selector). */
function sidebarRule(selector) {
  const start = sidebarStyles.indexOf(`\n${selector} {`);
  if (start === -1) assert.notEqual(sidebarStyles.indexOf(`\r\n${selector} {`), -1, `${selector} not found`);
  const at = start === -1 ? sidebarStyles.indexOf(`\r\n${selector} {`) : start;
  return sidebarStyles.slice(sidebarStyles.indexOf("{", at) + 1, sidebarStyles.indexOf("}", at));
}

test("the chosen groups and pinned section never change the first render, which matches the server's", () => {
  const serverHtml = render();
  const saved = {
    "pi-web:sidebar-groups-v2": JSON.stringify({ "/work/alpha": false }),
    "pi-web:sidebar-pins-collapsed": "true",
  };
  const previous = globalThis.window;
  globalThis.window = {
    localStorage: { getItem: (key) => saved[key] ?? null, setItem() {}, removeItem() {} },
  };
  let clientHtml;
  try {
    clientHtml = render();
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
  // The hydrating render must match the server's HTML, whatever the browser saved.
  assert.equal(clientHtml, serverHtml);
  assert.doesNotMatch(clientHtml, /role="tablist"/);
});

test("the sidebar shows the composer bar's picker above the sessions, asking for a project until it has one", () => {
  const html = render({ selectedCwd: "/work/alpha" });
  const panel = html.slice(html.indexOf('class="sidebar-panel sidebar-sessions-panel"'));
  // Before the sidebar has a cwd: the project box asks for one.
  assert.match(panel, /<div class="sidebar-picker-row"><div class="project-picker is-row" role="group" aria-label="项目和 worktree"><button type="button" class="project-picker-button is-project is-empty" title="" aria-haspopup="menu" aria-expanded="false">/);
  assert.match(panel, /<span class="project-picker-label">选择项目…<\/span>/);
});

test("the running poll keeps the same Set while the running ids stay the same", () => {
  const previous = new Set(["a", "b"]);
  assert.equal(sameIdsOr(previous, ["b", "a"]), previous);
  assert.equal(sameIdsOr(previous, ["a", "b", "b"]), previous);
  assert.deepEqual([...sameIdsOr(previous, ["a"])], ["a"]);
  assert.deepEqual([...sameIdsOr(previous, ["a", "c"])], ["a", "c"]);
  const empty = new Set();
  assert.equal(sameIdsOr(empty, []), empty);
});

test("a read or a mark in another tab reaches this one: the storage handler adopts that tab's write", async () => {
  const { parseUnreadMarks, sameMarksOr } = await jiti.import("@/lib/unread-markers.ts");
  const handler = between("const onStorage = (event: StorageEvent) => {", '\n    window.addEventListener("storage", onStorage);');
  const code = ts.transpileModule(handler, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const updaters = [];
  const onStorage = vm.runInNewContext(`${code}\nonStorage`, {
    UNREAD_SESSIONS_STORAGE_KEY: "pi-web:unread-session-ids",
    parseUnreadMarks,
    sameMarksOr,
    setUnreadMarks: (updater) => updaters.push(updater),
  });
  const marks = (entries) => new Map(entries);

  // Another key's write never touches the unread markers.
  onStorage({ key: "pi-web:terminal-theme", newValue: '{"a":1}' });
  assert.equal(updaters.length, 0);

  // The other tab read the session: the key (or all of storage) went away.
  onStorage({ key: "pi-web:unread-session-ids", newValue: null });
  assert.deepEqual([...updaters.pop()(marks([["a", 1], ["b", 2]]))], []);

  // The other tab wrote a newer set; it replaces this tab's, stale markers and all.
  onStorage({ key: "pi-web:unread-session-ids", newValue: '{"a":1,"b":2,"c":3}' });
  assert.deepEqual([...updaters.pop()(marks([["a", 1], ["d", 4]]))], [["a", 1], ["b", 2], ["c", 3]]);

  // The same markers keep the same Map: no re-render, so no echo of the write back.
  onStorage({ key: "pi-web:unread-session-ids", newValue: '{"a":1}' });
  const unchanged = marks([["a", 1]]);
  assert.equal(updaters.pop()(unchanged), unchanged);
  // A marker's time is part of it: a later mark of the same session is adopted.
  onStorage({ key: "pi-web:unread-session-ids", newValue: '{"a":5}' });
  assert.deepEqual([...updaters.pop()(unchanged)], [["a", 5]]);

  // A malformed write means no markers, not a crash.
  onStorage({ key: "pi-web:unread-session-ids", newValue: "{not json" });
  assert.deepEqual([...updaters.pop()(marks([["a", 1]]))], []);

  // The listener is registered for the storage event and taken off again.
  assert.match(source, /window\.addEventListener\("storage", onStorage\);/);
  assert.match(source, /window\.removeEventListener\("storage", onStorage\);/);
});

test("the favicon counts sessions that finished while the tab was hidden (#1484)", () => {
  // The rows exclude the selected session ("already looking"), which is false
  // while hidden: the badge takes those ids as a separate prop instead.
  assert.match(source, /hiddenFinishedSessionIds\?: Set<string>;/);
  assert.match(source, /countFaviconUnread\(unreadSessionIds, hiddenFinishedSessionIds\)/);
  assert.match(
    source,
    /\}, \[awaitingInputSessionIds, unreadSessionIds, hiddenFinishedSessionIds\]\);/,
  );
});

test("every way of opening a session reveals its row through one effect keyed on the selected id (#1595)", () => {
  const effect = between("const mainTreeShown = ", "\n  // Fork (the row menu's F)");
  // The tree is on the page: no archive view and no search results over it.
  assert.match(effect, /const mainTreeShown = !archiveView\s+&& !\(sessionSearchOpen && sessionSearchQuery\.trim\(\) !== ""\);/);
  // A new selection is noted once, and revealed once when the tree can show it.
  assert.match(effect, /if \(selectedSessionId !== openRevealSessionIdRef\.current\) \{/);
  assert.match(effect, /if \(!sessionId \|\| loading \|\| !uiStateLoaded \|\| !sidebarPrefsRestored \|\| !mainTreeShown\) return;\n    openRevealRef\.current = null;/);
  assert.match(effect, /locateSessionRow\(\{/);
  // The folds are back first: the restore sets this flag in the same batch.
  assert.match(source, /setSidebarPrefsRestored\(true\);/);
  // It scrolls only as far as needed and moves focus only where a fork allows it.
  assert.match(effect, /block: "nearest",/);
  assert.match(effect, /focus\?\.sessionId === sessionId \? \{ takeFocusFrom: focus\.takeFocusFrom \} : \{\}/);
  // A fold over the row is opened as the user's own choice would be.
  assert.match(effect, /savePinnedCollapsed\(false\);/);
  assert.match(effect, /saveGroupChoices\(next, \[location\.projectKey\]\);/);

  // The fork has no reveal of its own any more: it hands its focus rule to the effect.
  const fork = callbackBody("openForked");
  assert.doesNotMatch(fork, /setTreeReveal/);
  assert.doesNotMatch(fork, /saveGroupChoices/);
  assert.match(fork, /openRevealFocusRef\.current = \{\s+sessionId: forked\.id,/);
  // Only the open session's effect and a moved group ask the main tree for a row.
  assert.equal(source.match(/\bsetTreeReveal\(\{/g)?.length, 2);
});
