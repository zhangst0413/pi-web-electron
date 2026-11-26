import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { DebugPanelView } = await jiti.import("./DebugPanel.tsx");
const { EMPTY_DEBUG_SERVER_READING } = await jiti.import("./debug-panel-state.ts");
const { focusIfLost } = await jiti.import("@/lib/stacked-dialog.ts");
const { zhCNLocale } = await jiti.import("@/lib/i18n/messages/zh-CN.ts");
const { interpolateMessage } = await jiti.import("@/lib/i18n/format.ts");
const panelSource = await readFile(new URL("./DebugPanel.tsx", import.meta.url), "utf8");
const shellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const sidebarSource = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

const h = React.createElement;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const t = (key, params) => {
  assert.equal(typeof zhCNLocale.messages[key], "string", `missing translation ${key}`);
  return interpolateMessage(zhCNLocale.messages[key], params);
};

function decode(html) {
  return html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** Every aria-label, in order. */
function ariaLabels(html) {
  return [...html.matchAll(/aria-label="([^"]*)"/g)].map((match) => match[1]);
}

/** Every title attribute, in order. */
function titles(html) {
  return [...html.matchAll(/ title="([^"]*)"/g)].map((match) => match[1]);
}

/** What a sighted reader sees: the text between tags, the stylesheet left out. */
function visibleText(html) {
  return html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Where a section's title starts: its class, since a title such as "SSE" is also a badge's word. */
function sectionTitleAt(html, key, from = 0) {
  const match = new RegExp(`class="debug-section-title[^"]*">${t(`debug.section.${key}`)}<`).exec(html.slice(from));
  return match ? from + match.index : -1;
}

/** The part of the markup from one section's title to the next one's. */
function section(html, key, nextKey) {
  const from = sectionTitleAt(html, key);
  assert.notEqual(from, -1, key);
  const to = nextKey ? sectionTitleAt(html, nextKey, from) : html.length;
  return html.slice(from, to);
}

/** The server column's head: its totals. */
function serverHead(html) {
  const column = section(html, "server");
  return column.slice(0, column.indexOf("</div>") + "</div>".length);
}

/** The connected pages, between the server's head and its sessions. */
function pageList(html) {
  const from = html.indexOf('<div class="debug-pages">');
  assert.notEqual(from, -1);
  return html.slice(from, html.indexOf('<div class="debug-list">', from));
}

/** The server's sessions, below its head, without the stylesheet. */
function sessionList(html) {
  const from = html.indexOf('<div class="debug-list">');
  assert.notEqual(from, -1);
  return html.slice(from, html.indexOf("<style>", from));
}

/** The chat's details under its row, up to the next row. */
function detailOf(html) {
  const from = html.indexOf('<div class="debug-detail">');
  assert.notEqual(from, -1);
  const to = html.indexOf('<div class="debug-row', from);
  return html.slice(from, to === -1 ? html.length : to);
}

/** One measure of the page's table, from its name to the next one's. */
function measure(html, key) {
  const from = html.indexOf(`<span class="debug-label">${t(`debug.section.${key}`)}</span>`);
  assert.notEqual(from, -1, key);
  const next = html.indexOf('<span class="debug-measure-name"', from);
  return html.slice(from, next === -1 ? html.indexOf("debug-col-server", from) : next);
}

/** The session list as lines: "# group", then rows "[sub ]name[ · this chat]" ("this chat": the row with the sidebar's bar). */
function sessionLines(html) {
  const list = sessionList(html);
  const lines = [];
  for (const match of list.matchAll(/class="debug-group-name">([^<]*)<|class="(debug-row(?: [a-z-]+)*)"|class="debug-row-name">([^<]*)</g)) {
    if (match[1] !== undefined) lines.push(`# ${match[1]}`);
    else if (match[2] !== undefined) {
      if (!match[2].includes("debug-list-head")) lines.push({ classes: match[2] });
    }
    else lines[lines.length - 1].name = match[3];
  }
  return lines.map((line) => (typeof line === "string"
    ? line
    : `${line.classes.includes("is-sub") ? "sub " : ""}${line.name}${line.classes.includes("is-current") ? " · 当前聊天" : ""}`));
}

// The browser's clock is far from the server's: only the time since the answer counts.
const LOCAL = 50_000;
const SERVER = 9_000_000;

function client(extra = {}) {
  return {
    pageId: "page-mine-123",
    sessionId: "s1",
    selectedSessionId: "s1",
    mounted: true,
    wantsStream: true,
    connection: {
      sessionId: "s1",
      state: "connected",
      readyState: 1,
      openedAt: LOCAL - 5 * MINUTE,
      connectedAt: LOCAL - 5 * MINUTE + 200,
      lastSeenAt: LOCAL - 3 * SECOND,
      lastHeartbeatAt: LOCAL - 3 * SECOND,
      events: 12,
      opens: 1,
      retries: 0,
      retryDueAt: null,
      watchdogArmed: true,
      staleAfterMs: 45 * SECOND,
      lastError: null,
      lastClose: null,
    },
    released: { active: false, count: 0, lastAt: null },
    reattached: { count: 0, lastAt: null, lastReason: null },
    hiddenReleaseDueAt: null,
    hiddenGraceMs: 60 * SECOND,
    graceDueAt: null,
    run: { agentRunning: false, bashRunning: false, compacting: false, dialogs: 0 },
    lease: {
      renewIntervalMs: 15 * SECOND,
      renewStartedAt: LOCAL - 20 * SECOND,
      inFlightSince: null,
      requests: 2,
      unanswered: 0,
      errors: 0,
      last: { at: LOCAL - 5 * SECOND, durationMs: 18, outcome: "reply", httpStatus: 200, reply: { running: false, awaitingInput: false, subagentsActive: false } },
    },
    ...extra,
  };
}

function page(extra = {}) {
  return {
    at: LOCAL,
    client: client(),
    clientFailed: false,
    sources: [
      { id: 1, kind: "agent", label: "s1", state: "open", createdAt: LOCAL - 5 * MINUTE, opens: 1, errors: 0, lastOpenAt: LOCAL - 5 * MINUTE, lastErrorAt: null },
      { id: 2, kind: "file-watch", label: "/work/app/a.ts", state: "open", createdAt: LOCAL - MINUTE, opens: 1, errors: 0, lastOpenAt: LOCAL - MINUTE, lastErrorAt: null },
    ],
    visibility: { state: "visible", trackingSince: LOCAL - 10 * MINUTE, lastHiddenAt: LOCAL - 2 * MINUTE, lastVisibleAt: LOCAL - MINUTE, hiddenCount: 1 },
    protocol: "http/1.1",
    runningPoll: { count: 40, failures: 1, last: { at: LOCAL - SECOND, durationMs: 12, outcome: "ok", httpStatus: 200 } },
    pollInFlightSince: null,
    ...extra,
  };
}

function summary(sessionId, extra = {}) {
  return {
    sessionId, state: "alive", running: false, awaitingInput: false,
    eventStreams: 0, providers: 0, nextIdleCheckAt: null, forcedByStop: false, starts: 1, ...extra,
  };
}

function wrapper(extra = {}) {
  return {
    sessionId: "s1", state: "alive", stale: false, chatOnly: false,
    createdAt: SERVER - 6 * MINUTE, startedAt: SERVER - 6 * MINUTE, closingAt: null, extensions: "bound",
    run: { running: false, streaming: false, promptRunning: false, pendingPrompts: 0, bashRunning: false, compacting: false, retrying: false, queuedMessages: 0, runningTools: 0, mutatingCommands: 0, replacement: null },
    idle: { timeoutMs: 10 * MINUTE, nextCheckAt: SERVER + 8 * MINUTE + 30 * SECOND, lastResetAt: SERVER - 90 * SECOND, forcedByStop: false },
    awaitingInput: false, pendingUiRequests: 0, customUis: 0, eventListeners: 2,
    lastEvent: { type: "agent_end", at: SERVER - 90 * SECOND }, lastCommand: { type: "prompt", at: SERVER - 2 * MINUTE },
    ...extra,
  };
}

function reply() {
  return {
    now: SERVER,
    server: {
      startedAt: SERVER - 2 * 60 * MINUTE,
      idleTimeoutMs: 10 * MINUTE,
      heartbeatMs: 15 * SECOND,
      wrappers: { alive: 3, closing: 1, starting: 0 },
      eventStreams: { total: 3 },
      sseTotal: 5,
      pages: [
        { holder: "page-other-456", address: "192.168.1.20", client: "Safari · iOS", agent: 2, terminal: 1, fileWatch: 0 },
        { holder: "page-mine-123", address: "127.0.0.1", client: "Chrome · macOS", agent: 1, terminal: 0, fileWatch: 1 },
      ],
      fileWatches: 1,
      terminals: { count: 1, listeners: 1, detached: 0, exited: 0, nextCleanupAt: null },
    },
    sessions: [
      summary("other-session", { state: "closing" }),
      summary("notes-1", { awaitingInput: true, eventStreams: 1, nextIdleCheckAt: SERVER + 3 * MINUTE }),
      summary("s1", { eventStreams: 2, providers: 1, nextIdleCheckAt: SERVER + 8 * MINUTE + 30 * SECOND, starts: 2 }),
      summary("sub-xyz-789", { running: true, eventStreams: 1 }),
    ],
    session: {
      sessionId: "s1",
      wrapper: wrapper(),
      lifecycle: { starts: 2, firstStartedAt: SERVER - 30 * MINUTE, lastStartedAt: SERVER - 6 * MINUTE, lastClosedAt: SERVER - 7 * MINUTE },
      starting: false,
      providers: [{ name: "keepalive-ext", active: true, byFile: true }],
      eventStreams: [
        { holder: "page-other-456", address: "192.168.1.20", client: "Safari · iOS", openedAt: SERVER - 6 * MINUTE, connectedAt: SERVER - 6 * MINUTE, lastWriteAt: SERVER - 3 * SECOND, droppedEvents: 0, queuedBytes: 0 },
        { holder: "page-mine-123", address: "127.0.0.1", client: "Chrome · macOS", openedAt: SERVER - 5 * MINUTE, connectedAt: SERVER - 5 * MINUTE, lastWriteAt: SERVER - 3 * SECOND, droppedEvents: 0, queuedBytes: 0 },
      ],
    },
  };
}

function server(extra = {}) {
  // Received 10 s (on the browser's clock) before the page was read.
  return { ...EMPTY_DEBUG_SERVER_READING, sessionId: "s1", reply: reply(), receivedAt: LOCAL - 10 * SECOND, roundTripMs: 42, requests: 5, ...extra };
}

function withDetail(extra) {
  const answer = reply();
  answer.session = { ...answer.session, ...extra };
  return server({ reply: answer });
}

const catalog = [
  { id: "s1", name: "当前 chat", path: "", cwd: "/work/app", projectRoot: "/work/app", created: "", modified: "2026-10-01T00:00:00Z", messageCount: 2, firstMessage: "" },
  { id: "sub-xyz-789", name: "", path: "", cwd: "/work/app", projectRoot: "/work/app", created: "", modified: "2026-10-02T00:00:00Z", messageCount: 1, firstMessage: "explore the repo", relation: { kind: "side", parentSessionId: "s1" } },
  { id: "notes-1", name: "Weekly plan", path: "", cwd: "/work/notes", projectRoot: "/work/notes", created: "", modified: "2026-10-09T00:00:00Z", messageCount: 3, firstMessage: "" },
];

function render(props = {}) {
  return decode(renderToStaticMarkup(h(I18nProvider, null, h(DebugPanelView, {
    page: page(),
    server: server(),
    selectedSessionId: "s1",
    sessions: catalog,
    copied: false,
    onCopy() {},
    t,
    ...props,
  }))));
}

test("a quiet page reads OK: no issue list, the meter's scale in its label, every section", () => {
  const html = render();
  assert.match(html, /<span class="debug-panel-status is-muted"><span class="debug-dot is-ok" aria-hidden="true"><\/span><span class="debug-panel-status-text">正常<\/span><\/span>/);
  assert.doesNotMatch(html, /<ul/, "no issues, no list");
  // The meter's name says what its slots count: the slots' own titles are not read inside an image.
  assert.ok(ariaLabels(html).includes("http/1.1 · 每个源六个连接，所有标签页共用 · 2/6 · Agent 1 · 文件监视 1"), ariaLabels(html).join("\n"));
  for (const key of ["page", "stream", "lease", "server"]) {
    assert.ok(html.includes(`>${t(`debug.section.${key}`)}<`), key);
  }
  // Constants are scales and tooltips, never rows: the sentence is not on screen.
  const text = visibleText(html);
  assert.doesNotMatch(text, /每个源六个连接|每 15秒|超时 10分/);
  assert.doesNotMatch(html, /<dl|<dt|debug-panel-footer/);
  assert.match(html, /<span class="debug-panel-heading" title="只读：[^"]+">调试<\/span>/);
  assert.match(html, /<button type="button" class="debug-panel-copy"[^>]*>复制 JSON<\/button>/);
  // No live region: a screen reader would read every change out.
  assert.doesNotMatch(html, /role="status"|aria-live/);
});

test("the meter names what it holds on h2 and with no protocol known, not a bare code and number", () => {
  const terminal = { id: 3, kind: "terminal", label: "/work/app", state: "open", createdAt: LOCAL - 30 * SECOND, opens: 1, errors: 0, lastOpenAt: null, lastErrorAt: null };
  const h2 = render({ page: page({ protocol: "h2", sources: [...page().sources, terminal] }) });
  assert.ok(ariaLabels(h2).includes("本页面 · Agent 1 · 文件监视 1 · 终端 1 · h2"), ariaLabels(h2).join("\n"));
  assert.match(h2, /<span class="debug-chip is-dim">h2<\/span>/);
  const unknown = render({ page: page({ protocol: null }) });
  assert.ok(ariaLabels(unknown).includes("本页面 · Agent 1 · 文件监视 1 · 未知"));
  assert.doesNotMatch(unknown, /<span class="debug-chip is-dim">/);
});

test("a timeout: the verdict counts it and its sentence is written once", () => {
  const html = render({ server: server({ failure: { kind: "timeout", status: null, at: LOCAL - SECOND } }) });
  assert.match(html, /<span class="debug-panel-status is-warning"><svg[^>]*>.*?<\/svg><span class="debug-panel-status-text">问题：1<\/span>/);
  // The tone's mark and the sentence: no mark for what it is about, the sentence names it.
  assert.match(html, /<ul class="debug-issues"><li class="debug-issue is-warning"><svg[^>]*>(?:<path [^>]*><\/path>)+<\/svg><span class="debug-issue-text">/);
  const sentence = `${t("debug.poll.timeout")} · 1秒前`;
  assert.ok(html.includes(`<span class="debug-issue-text">${sentence}</span>`));
  assert.equal(html.split(t("debug.poll.timeout")).length - 1, 1, "once, in the issues");
});

test("server countdowns run on the server's clock plus the time since its answer", () => {
  const html = render();
  const text = visibleText(html);
  // 8m 30s left when the server answered, 10 s ago: 8m 20s, whatever the browser's clock says. The
  // chat's row shows minutes like every row; its tooltip has the seconds and what moves them.
  const all = titles(html);
  assert.ok(all.includes(`回收倒计时 8分20秒 · 超时 10分00秒 · 1分40秒前重置 · ${t("debug.server.idleHint")}`), all.join("\n"));
  assert.ok(all.includes("启动 2 次 · 上次 6分10秒前 · 7分10秒前关闭"), "the chat's ↻ says when");
  assert.ok(text.includes("运行时长 2小时00分"));
  assert.ok(text.includes("↻2"));
  // The browser's own times run on its own clock: next renewal 10 s after the 30 s mark.
  assert.ok(all.includes("下次续期 10秒后 · 每 15秒 · 已发送 2 · 无应答 0 · 失败 0 · 本页面 page-min"));
  assert.ok(text.includes("10秒后续期 上次续期 已应答 · 18 ms · 5秒前"), text);
  // Both bars fill as time passes: the stream's toward its watchdog, the lease's toward its renewal
  // (5 s of 15 gone).
  assert.match(measure(html, "lease"), /<span class="debug-bar-fill" style="width:33\.33[0-9]*%">/);
  assert.match(measure(html, "stream"), /<span class="debug-bar-fill" style="width:6\.66[0-9]*%">/);
  // Their times in whole seconds, never ms: an age rounds down, a countdown up. A round trip keeps its ms.
  const fresh = render({
    page: page({ client: client({
      connection: { ...client().connection, lastSeenAt: LOCAL - 400, lastHeartbeatAt: LOCAL - 400 },
      lease: { ...client().lease, renewStartedAt: LOCAL - 29_700, last: { ...client().lease.last, at: LOCAL - 300 } },
    }) }),
  });
  assert.match(measure(fresh, "stream"), /<span class="debug-value is-[a-z]+" title="[^"]*">0秒前有数据<\/span>/);
  assert.match(measure(fresh, "lease"), /<span class="debug-value is-muted" title="[^"]*">1秒后续期<\/span>/);
  assert.ok(visibleText(measure(fresh, "lease")).includes("上次续期 已应答 · 18 ms · 0秒前"));
});

test("one boxed word per stream and provider: 本页面's first and filled, other pages' outlined", () => {
  const html = render();
  // The chat's badges sit in its row of the list, where every other session's are.
  const list = sessionList(html);
  const card = list.slice(list.indexOf("debug-row is-current"), list.indexOf("debug-detail"));
  assert.doesNotMatch(detailOf(html), /debug-badge/, "none in the details under it");
  const labels = ariaLabels(card);
  assert.ok(labels.includes("SSE: 2 (本页面 1, 其他页面 1)"), labels.join("\n"));
  assert.ok(!labels.some((label) => label.startsWith("Lease")), "the server keeps no leases to show");
  assert.ok(labels.includes("存活提供者: 1"));
  // The badges say what they are: no "SSE" label before them, no icon in them; their titles say
  // which page, its browser and system, and its address.
  assert.doesNotMatch(card, /debug-client/);
  assert.match(card, /<span class="debug-row-badges"><span class="debug-run" title="SSE: 2 [^"]*" role="img" aria-label="SSE: 2 [^"]*"><span class="debug-badge is-accent is-filled" title="本页面 page-min · Chrome · macOS · 127.0.0.1 · 5分10秒前连接 · 上次写入 13秒前">SSE<\/span><span class="debug-badge is-muted" title="其他页面 page-oth · Safari · iOS · 192.168.1.20 · 6分10秒前连接 · 上次写入 13秒前">SSE<\/span><\/span><span class="debug-run"/);
  assert.doesNotMatch(card, /debug-mini-label/);
  assert.doesNotMatch(card, />Lease</);
  // A provider's badge is its name.
  assert.match(card, /<span class="debug-badge is-name is-muted" title="keepalive-ext · 活动 · 按文件">keepalive-ext<\/span>/);

  // The pages holding the server's streams, one row each, this page first on the current tint:
  // marks, browser and system, address, page, count; the server's total in the head.
  const pages = pageList(html);
  const icons = /<span class="debug-client" aria-hidden="true">(<svg [^>]*>.*?<\/svg>)+<\/span>/g;
  const rows = [...pages.replace(icons, "<icons>").matchAll(/<div class="(debug-page-row[^"]*)"[^>]*>(.*?)<\/div>/g)]
    .map((match) => `${match[1]}: ${visibleText(match[2])}`);
  assert.deepEqual(rows, [
    "debug-page-row debug-list-head: 连接的页面 2 SSE 共 5 个",
    "debug-page-row is-current: Chrome · macOS 127.0.0.1 本页面 2",
    "debug-page-row: Safari · iOS 192.168.1.20 page-oth 3",
  ]);
  // Every SSE kind counts, each a connection of the browser's pool; the title says which.
  assert.equal(pages.match(icons)?.length, 2, "two marks each, hidden from screen readers");
  assert.ok(titles(pages).includes("其他页面 page-oth · Safari · iOS · 192.168.1.20 · SSE 3 · Agent 2 · 终端 1"), titles(pages).join("\n"));
  assert.ok(titles(pages).includes("本页面 page-min · Chrome · macOS · 127.0.0.1 · SSE 2 · Agent 1 · 文件监视 1"));
  // A page opened without a page id or a known browser still gets its row.
  const bare = reply();
  bare.server.sseTotal = 1;
  bare.server.pages = [{ holder: null, address: null, client: null, agent: 1, terminal: 0, fileWatch: 0 }];
  const bareRow = pageList(render({ server: server({ reply: bare }) }));
  assert.match(bareRow, /<span class="debug-page-icons"><\/span><span class="debug-page-client is-dim">未知浏览器<\/span><span class="debug-page-address">—<\/span><span class="debug-page-holder">无页面 ID<\/span>/);
  const strip = serverHead(html);
  assert.doesNotMatch(strip, />SSE</, "the head no longer lists streams");
  assert.doesNotMatch(html, /debug-divider/);
  assert.doesNotMatch(visibleText(section(html, "page", "server")), /\d\/6/);
  assert.match(strip, /aria-label="文件监视: 1"><span class="debug-badge is-muted" title="文件监视: 1">文件<\/span><\/span>/);
  assert.match(strip, /aria-label="终端: 1 [^"]*"><span class="debug-badge is-muted" title="终端: 1 [^"]*">终端<\/span><\/span>/);
  assert.ok(titles(strip).some((title) => title.startsWith("计时器: 空闲 10分00秒 · 心跳 15秒\n存活 3 · 关闭中 1 · 启动中 0")));
});

test("a starting stream is dashed amber, one dropping events amber; past the cap the rest is a count", () => {
  const stream = (holder, at, extra = {}) => ({ holder, openedAt: at, connectedAt: at, lastWriteAt: null, droppedEvents: 0, queuedBytes: 0, ...extra });
  const eventStreams = [
    stream("page-mine-123", SERVER - 5 * MINUTE, { connectedAt: null }),
    stream("page-other-456", SERVER - 6 * MINUTE, { droppedEvents: 2 }),
    ...[5, 4, 3, 2, 1, 0].map((index) => stream(`page-x-${index}`, SERVER - index * SECOND)),
  ];
  const list = sessionList(render({ server: withDetail({ eventStreams }) }));
  const from = list.indexOf("<span class=\"debug-run\" title=\"SSE: 8 (本页面 1, 其他页面 7)\"");
  assert.notEqual(from, -1);
  const run = list.slice(from, list.indexOf('<span class="debug-run"', from + 1));
  assert.equal(run.match(/>SSE<\/span>/g).length, 3, "three badges, a row's cap");
  assert.match(run, /<span class="debug-run-more">\+5<\/span><\/span>$/);
  // This page's own still starting: filled, amber and dashed; another page's that dropped events: amber, solid.
  assert.match(run, /^[^>]*><span class="debug-badge is-warning is-filled is-dashed" title="本页面 page-min · 正在启动会话">SSE<\/span>/);
  assert.match(run, /<span class="debug-badge is-warning" title="其他页面 page-oth · 6分10秒前连接 · 丢弃 2">SSE<\/span>/);
  assert.equal(run.match(/is-filled/g).length, 1, "only 本页面's is filled");
});

test("a session row: up to three SSE and one 提供者 badge, then counts; 本页面's streams filled", () => {
  const answer = reply();
  answer.sessions = answer.sessions.map((entry) => (entry.sessionId === "notes-1" ? { ...entry, eventStreams: 5, providers: 2 } : entry));
  const grace = { id: 3, kind: "agent", label: "notes-1", state: "open", createdAt: LOCAL - MINUTE, opens: 1, errors: 0, lastOpenAt: null, lastErrorAt: null };
  const list = sessionList(render({ page: page({ sources: [...page().sources, grace] }), server: server({ reply: answer }) }));
  const from = list.indexOf('<div class="debug-row" title="notes-1');
  const row = list.slice(from, list.indexOf("</div>", from));
  const badges = row.slice(row.indexOf('<span class="debug-row-badges">'), row.indexOf('<span class="debug-row-idle'));
  assert.equal(badges, [
    '<span class="debug-row-badges">',
    '<span class="debug-run" title="5 个 SSE" role="img" aria-label="5 个 SSE">',
    '<span class="debug-badge is-accent is-filled" title="5 个 SSE">SSE</span>',
    '<span class="debug-badge is-muted" title="5 个 SSE">SSE</span>',
    '<span class="debug-badge is-muted" title="5 个 SSE">SSE</span>',
    '<span class="debug-run-more">+2</span></span>',
    '<span class="debug-run" title="2 个存活提供者" role="img" aria-label="2 个存活提供者">',
    "<span class=\"debug-badge is-muted\" title=\"2 个存活提供者\">提供者</span>",
    '<span class="debug-run-more">+1</span></span>',
    "</span>",
  ].join(""));
  // A wide panel's two columns leave the list narrow: the title keeps room, the badges wrap.
  const wide = panelSource.slice(0, panelSource.indexOf("@container debug-panel (max-width: 520px)"));
  assert.match(wide, /\.debug-row \{[^}]*grid-template-columns: 14px minmax\(96px, 1fr\) auto 104px;/);
  assert.match(wide, /\.debug-row-badges \{[^}]*flex-wrap: wrap;\s*justify-content: flex-end;/);
  // A narrow panel puts them on a line of their own under the title, which keeps its width.
  const narrow = panelSource.slice(panelSource.indexOf("@container debug-panel (max-width: 520px)"));
  assert.match(narrow, /\.debug-row \{\s*grid-template-columns: 14px minmax\(0, 1fr\) 64px;/);
  assert.match(narrow, /\.debug-row-badges \{\s*grid-column: 2 \/ -1;\s*grid-row: 2;\s*flex-wrap: wrap;/);
});

test("the meter's slots say what holds them: SSE, 文件, 终端; a connecting one dashed amber, empty ones dotted", () => {
  const extra = (id, kind, label, createdAt, state = "open") => ({ id, kind, label, state, createdAt, opens: 1, errors: 0, lastOpenAt: null, lastErrorAt: null });
  const [chat, watch] = page().sources;
  const sources = [chat, extra(3, "agent", "notes-1", LOCAL - 4 * MINUTE), watch, extra(4, "terminal", "/work/app", LOCAL - 30 * SECOND, "connecting")];
  const html = render({ page: page({ sources }) });
  const tile = section(html, "page", "server");
  const meterFrom = tile.indexOf('<span class="debug-meter"');
  const meter = tile.slice(meterFrom, tile.indexOf("</div>", meterFrom));
  const slots = [...meter.matchAll(/<span class="(debug-(?:badge|slot)[^"]*)"[^>]*>([^<]*)<\/span>/g)].map((match) => `${match[1]}: ${match[2]}`);
  assert.deepEqual(slots, [
    "debug-badge debug-slot is-accent is-filled: SSE",
    "debug-badge debug-slot is-muted: SSE",
    "debug-badge debug-slot is-muted: 文件",
    "debug-badge debug-slot is-warning is-dashed: 终端",
    "debug-slot is-empty: ",
    "debug-slot is-empty: ",
  ]);
  assert.match(meter, /title="终端 · app · 连接中 · 打开 1 次 · 0 次错误 · 30秒前">终端</);
  assert.match(panelSource, /\.debug-slot\.is-empty \{\s*border: 1px dotted var\(--border\);/);
  // The words follow the language; "SSE" stays as it is.
  const zh = (key, params) => interpolateMessage(zhCNLocale.messages[key], params);
  const zhHtml = render({ page: page({ sources }), t: zh });
  const zhFrom = zhHtml.indexOf('<span class="debug-meter"');
  const zhMeter = zhHtml.slice(zhFrom, zhHtml.indexOf("</div>", zhFrom));
  assert.deepEqual([...zhMeter.matchAll(/class="debug-badge[^"]*"[^>]*>([^<]*)</g)].map((match) => match[1]), ["SSE", "SSE", "文件", "终端"]);
});

test("sessions on the server: grouped by project, the chat's first and not repeated, members under their root", () => {
  assert.deepEqual(sessionLines(render()), [
    "# app",
    "当前 chat · 当前聊天",
    "sub explore the repo",
    "# notes",
    "Weekly plan",
    "# 不在会话列表中",
    "other-se",
  ]);
  const list = sessionList(render());
  assert.match(list, /class="debug-row is-current has-detail" title="当前聊天 · s1 · 存活 · 2 个 SSE · 1 个存活提供者 · 回收倒计时 8分 · 启动 2 次">/);
  // The chat's row: the sidebar's short bar beside its status, its badges with their holders, its
  // details below it on the same tint.
  const current = list.slice(list.indexOf("debug-row is-current"), list.indexOf("debug-row is-sub"));
  assert.match(current, /<span class="debug-row-status"><span class="debug-status" role="img" aria-label="存活"/);
  assert.match(current, /aria-label="SSE: 2 \(本页面 1, 其他页面 1\)"/);
  assert.match(current, /<\/div><div class="debug-detail"><div class="debug-detail-line"><span class="debug-detail-id">s1<\/span>/);
  assert.match(panelSource, /\.debug-row\.has-detail \{\s*border-radius: 4px 4px 0 0;/);
  assert.match(panelSource, /\.debug-row\.is-current::before \{\s*content: "";\s*position: absolute;\s*top: 5px;\s*left: 0;\s*width: 3px;\s*height: 14px;/);
  assert.match(list, /<span class="session-tree-awaiting" role="img" aria-label="等待输入" title="等待输入"><\/span>/, "the sidebar's awaiting dot");
  assert.match(list, /<span class="debug-status is-accent" title="运行中"><svg[^>]*class="sidebar-spin"/, "the sidebar's spinner");
  assert.match(list, /<span class="debug-status-ring is-closing"><\/span>/);
  assert.match(list, /title="1 个 SSE" role="img" aria-label="1 个 SSE"><span class="debug-badge is-muted" title="1 个 SSE">SSE<\/span><\/span>/);
  // 3 min left when the server answered, 10 s ago.
  assert.match(list, /<span class="debug-row-idle-text">2分50秒<\/span>/, "to the second");
  // A head says what the columns are, above the first group.
  assert.match(list, /^<div class="debug-list"><div class="debug-row debug-list-head" aria-hidden="true"><span><\/span><span>会话<\/span><span class="debug-list-head-holders">持有者<\/span><span class="debug-list-head-idle">回收倒计时<\/span><\/div><div class="debug-group">/);
});

test("a chat that moved on waits for its own answer; a hidden page pauses", () => {
  // The chat moved to s2: the answer about s1 still on screen is not s2's.
  const moved = render({ page: page({ client: client({ sessionId: "s2" }) }), selectedSessionId: "s2" });
  const list = sessionList(moved);
  assert.ok(list.startsWith(`<div class="debug-list"><div class="debug-empty">${t("debug.poll.waiting")}</div>`));
  assert.doesNotMatch(list, /debug-detail/);

  const hidden = render({ page: page({ visibility: { ...page().visibility, state: "hidden" } }) });
  assert.match(hidden, /<span class="debug-panel-status is-dim"><span class="debug-dot is-dim is-ring" aria-hidden="true"><\/span><span class="debug-panel-status-text">页面隐藏时暂停<\/span>/);

  // Nor does a hidden page read or render each second; it reads again as it comes back.
  const tick = panelSource.slice(panelSource.indexOf("const tick = window.setInterval("), panelSource.indexOf("}, DEBUG_TICK_MS);"));
  assert.match(tick, /^const tick = window\.setInterval\(\(\) => \{\s*\/\/[^\n]*\n\s*if \(document\.visibilityState !== "visible"\) return;\s*read\(\);/);
  const back = panelSource.slice(panelSource.indexOf("const onVisibilityChange = () => {"), panelSource.indexOf("document.addEventListener(\"visibilitychange\", onVisibilityChange)"));
  assert.match(back, /if \(document\.visibilityState !== "visible"\) return;\s*read\(\);\s*poller\.poll\(\);/);
});

test("server states, run statuses and close reasons read as words, not codes", () => {
  const html = render({
    page: page({ client: client({ connection: { ...client().connection, lastClose: { reason: "set_tools", at: LOCAL - 4 * SECOND } } }) }),
  });
  const stateTitle = titles(html).find((title) => title.startsWith("readyState 1"));
  assert.ok(stateTitle?.split("\n").includes("上次关闭 工具已更改 · 4秒前"), stateTitle);
  assert.ok(stateTitle.split("\n").includes("页面需要 是"));
  assert.ok(stateTitle.split("\n").includes("隐藏过 1 次 · 上次隐藏于2分00秒前"));

  const noReason = render({ page: page({ client: client({ connection: { ...client().connection, lastClose: { reason: null, at: LOCAL - SECOND } } }) }) });
  assert.ok(titles(noReason).some((title) => title.split("\n").includes("上次关闭 — · 1秒前")));
});

test("the run's chips show only what is true: no chip row while idle, amber for what waits", () => {
  const withRun = (run) => {
    const answer = reply();
    answer.session.wrapper = { ...answer.session.wrapper, run: { ...answer.session.wrapper.run, ...run } };
    answer.sessions = answer.sessions.map((entry) => (entry.sessionId === "s1" ? { ...entry, running: run.running ?? entry.running } : entry));
    return sessionList(render({ server: server({ reply: answer }) }));
  };
  assert.doesNotMatch(detailOf(render()), /debug-chip/);
  const busy = withRun({ running: true, streaming: true, promptRunning: true, pendingPrompts: 1, retrying: true });
  assert.match(detailOf(busy), /<span class="debug-chip is-dim">流式输出<\/span><span class="debug-chip is-dim">提示词运行中<\/span><span class="debug-chip is-warning">另有 1 个提示词进行中<\/span><span class="debug-chip is-warning">重试中<\/span><span class="debug-line">/);
  const row = busy.slice(busy.indexOf("debug-row is-current"), busy.indexOf("debug-detail"));
  assert.match(row, /<span class="debug-status is-accent" title="运行中">/, "running is the status slot, not a chip");
});

/** The chat's wrapper closing after Stop, its row's summary saying so too. */
function closingAfterStop() {
  const answer = reply();
  answer.session = {
    ...answer.session,
    wrapper: wrapper({
      state: "closing",
      closingAt: SERVER - 3 * SECOND,
      idle: { timeoutMs: 10 * MINUTE, nextCheckAt: SERVER + 40 * SECOND, lastResetAt: null, forcedByStop: true },
    }),
  };
  answer.sessions = answer.sessions.map((entry) => (entry.sessionId === "s1"
    ? { ...entry, state: "closing", forcedByStop: true, nextIdleCheckAt: SERVER + 40 * SECOND }
    : entry));
  return server({ reply: answer });
}

test("notable states show in place and leave the verdict at OK", () => {
  const html = render({
    page: page({ client: client({ released: { active: true, count: 1, lastAt: LOCAL - MINUTE }, graceDueAt: LOCAL + 24 * SECOND }) }),
    server: closingAfterStop(),
  });
  assert.match(html, /<span class="debug-panel-status-text">正常<\/span>/);
  assert.doesNotMatch(html, /<ul/);
  const list = sessionList(html);
  const row = list.slice(list.indexOf("debug-row is-current"), list.indexOf("debug-detail"));
  assert.match(row, /<span class="debug-status-ring is-closing"><\/span>/);
  assert.match(detailOf(html), /<span class="debug-chip is-warning">13秒前开始关闭<\/span>/);
  // Closing after Stop: the stop square, then the time alone, amber; the tooltip says why.
  assert.match(row, /<span class="debug-row-idle is-warning" title="回收倒计时 30秒 · 超时 10分00秒 · 已停止：[^"]*">[^]*?<span class="debug-row-forced" role="img" aria-label="30秒后关闭（已停止）"[^>]*><\/span><span class="debug-row-idle-text">30秒<\/span>/);
  const stream = measure(html, "stream");
  assert.match(stream, /<span class="debug-chip is-accent">页面隐藏时释放<\/span><span class="debug-chip is-accent">关闭前宽限 24秒后<\/span>/);
});

test("a session closing after 停止 carries a stop square, not the amber alone", () => {
  const rowOf = (forcedByStop) => {
    const answer = reply();
    answer.sessions = answer.sessions.map((entry) => (entry.sessionId === "notes-1" ? { ...entry, awaitingInput: false, running: true, forcedByStop } : entry));
    const list = sessionList(render({ server: server({ reply: answer }) }));
    const from = list.indexOf('<div class="debug-row" title="notes-1');
    return list.slice(from, list.indexOf("</div>", from));
  };
  const forced = rowOf(true);
  const normal = rowOf(false);
  assert.match(forced, /<span class="debug-row-idle is-warning">[^]*?<span class="debug-row-forced" role="img" aria-label="2分50秒后关闭（已停止）" title="2分50秒后关闭（已停止）"><\/span><span class="debug-row-idle-text">2分50秒<\/span>/);
  assert.doesNotMatch(normal, /debug-row-forced/);
  // More than a class name apart: with every class dropped, the two rows still differ.
  const shape = (html) => html.replace(/ class="[^"]*"/g, "").replace(/ title="[^"]*"/g, "");
  assert.notEqual(shape(forced), shape(normal));
  // Kept at every width: the narrow rules hide the bar, never the square.
  const narrow = panelSource.slice(panelSource.indexOf("@container debug-panel (max-width: 520px)"));
  assert.doesNotMatch(narrow, /debug-row-forced/);
  assert.match(panelSource, /\.debug-status-ring\.is-none \{\s*border-style: dotted;\s*border-color: var\(--text-dim\);/, "the no-wrapper ring is visible");
});

test("the sparklines draw the poll samples against the 5 s timeout", () => {
  const html = render({
    samples: {
      poll: [
        { ms: 41, tone: "dim", failed: false },
        { ms: 1000, tone: "dim", failed: false },
        { ms: 20, tone: "dim", failed: false },
        { ms: 5000, tone: "warning", failed: true },
      ],
      running: [],
    },
  });
  const labels = ariaLabels(html);
  assert.ok(labels.includes("3 次应答 · 中位数 41 ms · 最长 1秒"), labels.join("\n"));
  // The values line up on the right, in ms in every language.
  assert.match(panelSource, /\.debug-measures > \.debug-value \{\s*justify-self: end;\s*text-align: right;/);
  assert.equal(zhCNLocale.messages["debug.duration.ms"], "{count} ms");
  assert.ok(labels.includes("40 次 · 1 次失败 · 尚无"));
  // A faint baseline under the bars, the chart's full width: a few short answers are no dashed line.
  assert.match(html, /<svg width="120" height="15" viewBox="0 0 120 15" aria-hidden="true"><rect x="0" y="14" width="120" height="1" style="fill:var\(--border\)"><\/rect><rect class="is-dim"/);
  const empty = section(html, "page", "server").split('aria-label="40 次')[1];
  assert.match(empty, /^[^>]*><svg[^>]*><rect x="0" y="14" width="120" height="1" style="fill:var\(--border\)"><\/rect><\/svg>/, "drawn before the first sample");
  // Newest on the right, standing on the baseline; 41 ms and 20 ms are 1px stubs, 1 s is 6px, a failure is a full bar.
  assert.match(html, /<rect class="is-dim" x="105" y="13" width="3" height="1" fill="currentColor"><\/rect>/);
  assert.match(html, /<rect class="is-dim" x="109" y="8" width="3" height="6" fill="currentColor"><\/rect>/);
  assert.match(html, /<rect class="is-dim" x="113" y="13" width="3" height="1" fill="currentColor"><\/rect>/);
  assert.match(html, /<rect class="is-warning" x="117" y="0" width="3" height="14" fill="currentColor"><\/rect>/);
  assert.match(html, /<span class="debug-value is-warning">—<\/span>/, "no round trip for a failure");
});

test("without a chat or with a reader that throws, the panel says so and still shows the server", () => {
  const failed = render({ page: page({ client: null, clientFailed: true }) });
  assert.ok(failed.includes(`<span class="debug-issue-text">${t("debug.stream.readerFailed")}</span>`));
  assert.match(failed, /问题：1/);
  assert.ok(visibleText(failed).includes("运行时长 2小时00分"));
  const none = render({ page: page({ client: null }), selectedSessionId: null });
  assert.ok(visibleText(none).includes(t("debug.stream.noChat")));
  assert.ok(visibleText(none).includes(t("debug.server.noSession")));
  const before = render({ page: null });
  assert.match(before, /<span class="debug-panel-status-text">正在读取…<\/span>/);
  assert.doesNotMatch(before, /<div class="debug-panel-scroll">/);
});

test("the panel keeps to the theme and to Safari 16.2: tokens, the three state colors, no :has or nesting", () => {
  const colors = new Set((panelSource.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((color) => color.toLowerCase()));
  assert.deepEqual([...colors].sort(), ["#16a34a", "#d97706", "#ef4444"]);
  assert.doesNotMatch(panelSource, /AbortSignal\.(any|timeout)|\(\?<[=!]/, "Safari 16.2");
  const css = panelSource.slice(panelSource.indexOf("const DEBUG_PANEL_CSS"));
  assert.doesNotMatch(css, /:has\(|&|transition/);
  // Rules are flat: only the container queries hold rules inside braces.
  const outside = css.replace(/@container debug-panel \(max-width: \d+px\) \{[^]*?\n {2}\}\n/g, "");
  // Three columns on a wide panel, each but the page's capped; the sessions under the server's
  // pages on a narrower one (its height going to their row); one above the other on a phone.
  assert.match(css, /\.debug-cols \{\s*display: grid;\s*grid-template-areas: "page server sessions";\s*grid-template-columns: minmax\(320px, max-content\) minmax\(340px, 480px\) minmax\(360px, 560px\);/);
  assert.match(css, /@container debug-panel \(max-width: 1239px\) \{\s*\.debug-cols \{\s*grid-template-areas: "page server" "page sessions";\s*grid-template-columns: minmax\(320px, max-content\) minmax\(0, 560px\);\s*grid-template-rows: auto 1fr;/);
  assert.match(css, /@container debug-panel \(max-width: 760px\) \{\s*\.debug-cols \{\s*grid-template-areas: "page" "server" "sessions";\s*grid-template-columns: minmax\(0, 1fr\);/);
  // A measure's details wrap in the table instead of widening it.
  assert.match(css, /\.debug-measure-sub,\s*\.debug-measure-empty \{\s*grid-column: 2 \/ -1;\s*width: 0;\s*min-width: 100%;/);
  assert.doesNotMatch(outside, /\{[^}]*\{/, "no nested rule");
  assert.match(css, /container-type: inline-size;\s*container-name: debug-panel;/);
  assert.match(css, /@container debug-panel \(max-width: 520px\)/);
  // Escape on document (before the window's Stop shortcut), and nothing that keeps a session alive.
  assert.match(panelSource, /document\.addEventListener\("keydown", handleKeyDown\)/);
  assert.doesNotMatch(panelSource, /\/lease|\/events|EventSource|sendAgentCommand|method: "POST"/);
  // The sidebar shows nothing: the panel writes no labels anywhere.
  assert.doesNotMatch(panelSource, /debug-overlay-store|setDebugOverlay/);
});

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, start);
  assert.notEqual(to, -1, end);
  return source.slice(from, to);
}

test("a tooltip holds the view still: the mouse on a titled element freezes what the panel shows", () => {
  const hold = between(panelSource, "const [held, setHeld] = useState<HeldView | null>(null);", "useEffect(() => {\n    disposedRef.current = false;");
  assert.match(hold, /if \(event\.pointerType !== "mouse"\) return;/, "touch shows no tooltips");
  assert.match(hold, /event\.target\.closest\("\[title\]"\)/);
  assert.match(hold, /setHeld\(target \? liveRef\.current : null\);/);
  assert.match(hold, /section\.addEventListener\("pointerleave", onPointerLeave\);/);
  assert.match(panelSource, /const shown = held \?\? \{ page, server, samples \};/);
});

test("the 调试 button only toggles its panel, left of the session stats", () => {
  const button = between(shellSource, "const renderDebugButton = (mobile: boolean) => {", "const renderMainFileToggle");
  assert.match(button, /onClick=\{\(\) => toggleTopPanel\("debug", mobile\)\}/);
  assert.doesNotMatch(button, /handleSystemInfoToggle|sendAgentCommand|fetch\(|setSessionKey|loadSession|systemInfoLoaderRef/);
  assert.match(button, /aria-label=\{translate\("debug\.title"\)\}/);
  assert.match(button, /aria-pressed=\{open\}/);
  assert.match(button, /data-mobile-toolbar-action=\{mobile \? "debug" : undefined\}/);
  assert.match(button, /if \(!showChat\) return null;/);
  assert.notEqual(zhCNLocale.messages["debug.title"], zhCNLocale.messages["session.title"], "e2e finds the stats button by its own name");

  // Desktop: after the chat's actions, right before the stats, taking the free space.
  assert.match(shellSource, /\{renderChatToolbarActions\(false\)\}\s*\{renderDebugButton\(false\)\}\s*\{renderSessionStatsButton\(false\)\}/);
  assert.match(button, /marginLeft: mobile \? 0 : "auto"/);
  const stats = between(shellSource, "const renderSessionStatsButton = (mobile: boolean) => {", "const renderDebugButton");
  assert.match(stats, /\n\s*marginLeft: 0,/);
  assert.match(shellSource, /marginLeft: !mobile && !showChat \? "auto" : 0,/);
  // Phones: before the stats on a wide one, in the "more" overlay on a narrow one.
  assert.match(shellSource, /\{!isNarrowMobile && renderChatToolbarActions\(true\)\}\s*\{!isNarrowMobile && renderDebugButton\(true\)\}\s*\{renderSessionStatsButton\(true\)\}/);
  assert.match(shellSource, /\{renderChatToolbarActions\(true\)\}\s*\{renderDebugButton\(true\)\}\s*<\/div>/);
});

test("Escape with focus in the panel gives it back to the 调试 button, after the panel left the page", () => {
  assert.match(panelSource, /<section ref=\{sectionRef\} className="debug-panel"/);
  assert.match(panelSource, /createDebugPanelEscapeListener\(\s*document,\s*\(\) => sectionRef\.current,\s*\(restoreFocus\) => onCloseRef\.current\(restoreFocus\),\s*\)/);
  const button = between(shellSource, "const renderDebugButton = (mobile: boolean) => {", "const renderMainFileToggle");
  assert.match(button, /<button\s+ref=\{debugButtonRef\}/);
  const close = between(shellSource, "const closeDebugPanel = useCallback(", "}, []);");
  assert.match(close, /\(restoreFocus: boolean\) => \{\s*setActiveTopPanel\(\(panel\) => panel === "debug" \? null : panel\);\s*if \(restoreFocus\) requestAnimationFrame\(\(\) => focusIfLost\(document, debugButtonRef\.current\)\);/);
  assert.match(shellSource, /import \{ focusIfLost \} from "@\/lib\/stacked-dialog";/);
  assert.match(shellSource, /onClose=\{closeDebugPanel\}/);

  // What that frame does: focus that fell to the page goes to the button; focus put elsewhere stays.
  const focused = [];
  const debugButton = { focus: () => focused.push("debug") };
  const body = { name: "body" };
  assert.equal(focusIfLost({ activeElement: body, body }, debugButton), true);
  assert.equal(focusIfLost({ activeElement: { name: "composer" }, body }, debugButton), false);
  assert.equal(focusIfLost({ activeElement: body, body }, null), false, "no 调试 button on screen (narrow phone, more closed)");
  assert.deepEqual(focused, ["debug"]);
});

test("the sidebar's running poll records its request alone, not the session-list reload after it", () => {
  const poll = between(sidebarSource, "const poll = async () => {", "const onVisibilityChange = () => {");
  const json = poll.indexOf("await res.json()");
  const answered = poll.indexOf("answeredAt = Date.now();");
  assert.ok(json !== -1 && answered > json, "after the answer is read");
  assert.ok(answered < poll.indexOf("if (stopped || controller !== current) return;"), "before a poll that lost the race returns");
  assert.ok(answered < poll.indexOf("await loadSessions();"), "before the reload");
  assert.match(poll, /\} finally \{[^]*?noteRunningPoll\(startedAt, outcome, httpStatus, answeredAt\);\s*\}/);
});

test("the narrow phone's more overlay scrolls the buttons it cannot fit instead of clipping the last", () => {
  const overlay = between(shellSource, 'data-mobile-toolbar-actions="true"', "{renderChatToolbarActions(true)}");
  assert.match(overlay, /overflowX: "auto",\s*overflowY: "hidden",\s*scrollbarWidth: "none",/);
});

test("AppShell keeps the chat's reader in a ref and the panel open across session switches", () => {
  const register = between(shellSource, "const handleDebugSnapshotReaderChange = useCallback(", "}, []);");
  assert.match(register, /debugSnapshotReaderRef\.current = reader;/);
  assert.doesNotMatch(register, /\bset[A-Z]\w*\(/, "registering renders nothing");
  assert.match(shellSource, /onDebugSnapshotReaderChange=\{handleDebugSnapshotReaderChange\}/);
  assert.match(shellSource, /<DebugPanelBoundary fallback=\{translate\("debug\.failed"\)\}>\s*<DebugPanel\s/);
  assert.match(shellSource, /useEffect\(\(\) => \{\s*startPageVisibilityTracking\(\);\s*\}, \[\]\);/);
  for (const [name, next] of [["handleCwdChange", "handleSelectSession"], ["handleSelectSession", "handleNewSession"], ["handleNewSession", "hydrateSelectedSession"], ["handleSessionDeleted", "handleOpenFile"]]) {
    const body = between(shellSource, `const ${name} = useCallback`, `const ${next} = useCallback`);
    assert.match(body, /setActiveTopPanel\(\(panel\) => panel === "debug" \? panel : null\);/, name);
    assert.doesNotMatch(body, /setActiveTopPanel\(null\)/, name);
  }
});
