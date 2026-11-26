import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { mock } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { zhCNLocale } = await jiti.import("@/lib/i18n/messages/zh-CN.ts");
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { McpConfig, McpConfigView } = await jiti.import("./McpConfig.tsx");
const { ConfigSidebarGroupSwitch } = await jiti.import("./SettingsUi.tsx");
const source = await readFile(new URL("./McpConfig.tsx", import.meta.url), "utf8");
const helperSource = await readFile(new URL("./mcp-config-helpers.ts", import.meta.url), "utf8");
const displaySource = await readFile(new URL("../lib/mcp-server-display.ts", import.meta.url), "utf8");
const apiTypesSource = await readFile(new URL("../lib/api-types.ts", import.meta.url), "utf8");

const h = React.createElement;
const messages = zhCNLocale.messages;

function render(element) {
  return renderToStaticMarkup(h(I18nProvider, null, element));
}

function decode(html) {
  return html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** The text of the markup, tags dropped, entities decoded. */
function text(html) {
  return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function server(overrides = {}) {
  return {
    name: "github",
    scope: "global",
    sourcePath: "/Users/me/.pi/agent/mcp.json",
    configKey: "key",
    enabled: true,
    validated: true,
    envNames: [],
    headerNames: [],
    usesOAuth: false,
    commandFields: [],
    variableReferences: [],
    masked: false,
    ...overrides,
  };
}

const globalFile = { scope: "global", path: "/Users/me/.pi/agent/mcp.json", exists: true, problems: [] };
const projectFile = { scope: "project", path: "/Users/me/repo/.pi/mcp.json", exists: true, problems: [] };
const trusted = { requiresTrust: true, trusted: true, decision: true, decisionPath: "/Users/me/repo", inherited: false };
const untrusted = { requiresTrust: true, trusted: false, decision: null, inherited: false };

function overview(overrides = {}) {
  return {
    mcp: { available: true },
    codemode: { sandbox: { state: "available" }, builtinDisabled: false, preference: "automatic" },
    files: [globalFile],
    servers: [],
    ...overrides,
  };
}

const stdioServer = server({
  name: "lint",
  transport: "stdio",
  exposure: "direct",
  command: "npx",
  args: ["-y", "@acme/lint-mcp", "--api-key=••••"],
  cwd: "tools",
  envNames: ["NODE_ENV", "LINT_TOKEN"],
  commandFields: [{ kind: "env", name: "LINT_TOKEN" }],
  masked: true,
});

const httpServer = server({
  name: "github",
  transport: "http",
  exposure: "codemode",
  url: "https://api.example.com/mcp",
  headerNames: ["Authorization"],
  variableReferences: [{ kind: "header", name: "Authorization", variables: ["GITHUB_TOKEN"] }],
});

function view(props = {}) {
  return render(h(McpConfigView, {
    cwd: null,
    load: { state: "loaded", data: overview({ servers: [httpServer, stdioServer] }) },
    selected: null,
    refreshing: false,
    embedded: true,
    onSelect() {},
    onRefresh() {},
    onClose() {},
    ...props,
  }));
}

/** The opening tag of the sidebar row whose accessible name starts with `name`. */
function row(html, name) {
  return decode(html).match(new RegExp(`<button[^>]*aria-label="${name}[^"]*"[^>]*>`))?.[0];
}

test("without a project only the global file is listed, under the 代码模式 row", () => {
  const html = view();
  const shown = text(html);
  assert.ok(!shown.includes(messages["skills.scope.project"]), "no 项目 group without a project");
  assert.match(decode(html), /class="config-sidebar-group-label-text">全局</);
  // Code mode comes first, so the 190px phone sidebar always shows it.
  const sidebar = decode(html).slice(decode(html).indexOf('class="config-sidebar-list"'));
  assert.ok(sidebar.indexOf("代码模式：自动") < sidebar.indexOf("github：已开启"));
  assert.match(row(html, "代码模式"), /aria-label="代码模式：自动"/);
  assert.match(row(html, "github"), /aria-label="github：已开启"/);
  assert.match(shown, /已开启 2\/2 个服务器/);
});

test("with a project, its group comes first and every row names its state", () => {
  const data = overview({
    files: [globalFile, projectFile],
    servers: [
      server({ name: "shared", transport: "http", url: "https://a.example/mcp", shadowedByProject: true }),
      server({ name: "off", transport: "http", url: "https://b.example/mcp", enabled: false }),
      server({ name: "shared", scope: "project", sourcePath: projectFile.path, transport: "stdio", command: "node", replacesGlobal: true }),
      server({ name: "legacy", scope: "project", sourcePath: projectFile.path, invalidError: "sse is not supported", url: "https://old/sse" }),
    ],
    project: { cwd: "/Users/me/repo", trust: untrusted },
  });
  const html = view({ cwd: "/Users/me/repo", load: { state: "loaded", data } });
  const markup = decode(html);
  assert.ok(markup.indexOf(">项目<") < markup.indexOf(">全局<"));
  // Each heading holds its n/m count and the group switch, on only while every server is.
  assert.match(markup, /<span class="config-sidebar-group-count">1\/2<\/span><button type="button" role="switch" aria-checked="false" aria-label="开启 全局 中的所有服务器"/);
  // The untrusted project's switch waits for trust, pointing at the notice that says so.
  const projectSwitch = markup.match(/<span class="config-sidebar-group-count">2\/2<\/span>(<button[^>]*>)/)?.[1];
  assert.match(projectSwitch, /aria-checked="true" aria-label="关闭 项目 中的所有服务器" aria-describedby="([^"]+)"[^>]*disabled=""/);
  const noticeId = projectSwitch.match(/aria-describedby="([^"]+)"/)[1];
  assert.match(markup, new RegExp(`<div id="${noticeId}" role="status" class="config-notice">此项目未受信任`));
  // The project is not trusted, so its entry does not connect and the global one is not replaced.
  assert.match(row(html, "shared：项目"), /aria-label="shared：项目未受信任"/);
  assert.match(row(html, "shared：已开启"), /aria-label="shared：已开启"/);
  assert.match(row(html, "off"), /aria-label="off：已在文件中关闭"/);
  assert.match(row(html, "legacy"), /aria-label="legacy：被 Pi 拒绝"/);
  // The state is visible text on the row too, never only the dot's color.
  for (const badge of ["未受信任", "已关闭", "已拒绝"]) {
    assert.match(markup, new RegExp(`class="mcp-sidebar-badge is-[a-z]+">${badge}<`), badge);
  }
  // The untrusted project gets the trust notice, which also says its servers cannot be changed
  // here; without a Trust handler it has no button.
  assert.match(markup, /<div id="[^"]+" role="status" class="config-notice">此项目未受信任，其 \.pi\/mcp\.json 中的服务器不会连接。 在此项目受信任之前，Pi Web 不会更改它们。<\/div>/);

  const trustedHtml = view({
    cwd: "/Users/me/repo",
    load: { state: "loaded", data: { ...data, project: { cwd: "/Users/me/repo", trust: trusted } } },
  });
  assert.match(row(trustedHtml, "shared：已被项目的同名服务器替换"), /aria-label="shared：已被项目的同名服务器替换"/);
  assert.ok(!decode(trustedHtml).includes("此项目未受信任"));
});

test("inherited trust names the folder it comes from", () => {
  const data = overview({
    files: [globalFile, projectFile],
    servers: [server({ name: "p", scope: "project", sourcePath: projectFile.path, transport: "stdio", command: "node" })],
    project: { cwd: "/Users/me/repo/app", trust: { ...trusted, decisionPath: "/Users/me/repo", inherited: true } },
  });
  const shown = text(view({ cwd: "/Users/me/repo/app", load: { state: "loaded", data } }));
  assert.match(shown, /通过 ~\/repo 受信任：此项目 \.pi\/mcp\.json 中的服务器会连接，它下面的每个文件夹都是如此。/);
  const denied = text(view({
    cwd: "/Users/me/repo/app",
    load: { state: "loaded", data: { ...data, project: { cwd: "/Users/me/repo/app", trust: { ...untrusted, decision: false, decisionPath: "/Users/me/repo", inherited: true } } } },
  }));
  assert.match(denied, /此项目未受信任（~\/repo 被标记为不受信任）/);
});

test("a stdio server's detail shows its masked command line, folder, env names and !command fields", () => {
  const html = view({ selected: "global\0lint" });
  const shown = text(html);
  const markup = decode(html);
  assert.match(markup, /<div class="config-detail-title">lint<\/div>/);
  // The Command label says it runs over stdio: no Transport row repeats it.
  assert.doesNotMatch(shown, /传输方式/);
  assert.match(markup, /<div class="config-detail-grid-label">命令<\/div><div class="config-detail-grid-value is-mono mcp-config-code">npx -y @acme\/lint-mcp --api-key=••••<\/div>/);
  assert.match(shown, /工作目录 tools/);
  assert.match(markup, /<code class="mcp-config-chip">NODE_ENV<\/code><code class="mcp-config-chip">LINT_TOKEN<\/code>/);
  // Names only: the values stay in the file.
  assert.doesNotMatch(shown, /Values are not shown here/);
  assert.match(shown, /Shell 命令 每次连接都会执行 shell 命令： 环境变量 LINT_TOKEN/);
  assert.match(markup, /<option value="direct" selected="">直接声明<\/option>/);
  assert.match(shown, /每次请求都带全部工具的完整声明，最占 token。/);
  assert.match(shown, /文件 ~\/\.pi\/agent\/mcp\.json/);
  assert.match(shown, /疑似密钥的部分已隐藏。/);
  // Headers and sign-in belong to HTTP servers.
  assert.doesNotMatch(shown, /请求头|登录/);

  // What the entry does not set is left out: no working directory, no env names.
  const plain = text(view({ selected: "global\0lint", load: { state: "loaded", data: overview({ servers: [{ ...stdioServer, cwd: undefined, envNames: [] }] }) } }));
  assert.doesNotMatch(plain, /工作目录/);
});

test("an HTTP server's detail shows its URL, header names, the variables it sends and how it signs in", () => {
  const shown = text(view({ selected: "global\0github" }));
  assert.match(shown, /URL https:\/\/api\.example\.com\/mcp/);
  assert.match(shown, /请求头 Authorization 主机环境变量/);
  assert.match(shown, /主机环境变量 每次连接都会把运行 Pi Web 的计算机上的环境变量发送给此服务器： 请求头 Authorization 中的 GITHUB_TOKEN/);
  // Its Authorization header is how it signs in, which the Headers row already says; the URL label says HTTP.
  assert.doesNotMatch(shown, /登录|传输方式/);
  assert.match(shown, /只列出服务器名称和简介，代码模式脚本按需搜索它的工具。/);
  assert.doesNotMatch(shown, /工作目录/);

  const oauth = (signedIn) => text(view({
    selected: "global\0notion",
    load: { state: "loaded", data: overview({ servers: [server({ name: "notion", transport: "http", url: "https://n/mcp", usesOAuth: true, signedIn })] }) },
  }));
  assert.match(oauth(true), /登录 已登录。/);
  assert.match(oauth(false), /登录 未登录。/);
  assert.match(oauth(undefined), /登录 未知：无法读取 mcp-auth\.json。/);

  // Code mode cannot run here, so its tools go through tool search.
  const sandboxDown = text(view({
    selected: "global\0github",
    load: { state: "loaded", data: overview({ servers: [httpServer], codemode: { sandbox: { state: "unavailable", error: "no wasm" }, builtinDisabled: false, preference: "automatic" } }) },
  }));
  assert.match(sandboxDown, /改为通过工具搜索调用/);

  // -builtin:codemode registers no codemode tool, so only tool search can reach them.
  const builtinOff = text(view({
    selected: "global\0github",
    load: { state: "loaded", data: overview({ servers: [httpServer], codemode: { sandbox: { state: "available" }, builtinDisabled: true, preference: "always" } }) },
  }));
  assert.match(builtinOff, /-builtin:codemode 关闭了代码模式，因此只有在工具搜索开启时才能调用这些工具。/);

  // Automatic with autoEnableCodemode false never turns Code mode on for them.
  const autoOff = (preference) => text(view({
    selected: "global\0github",
    load: { state: "loaded", data: overview({
      files: [{ ...globalFile, autoEnableCodemode: false }],
      servers: [httpServer],
      codemode: { sandbox: { state: "available" }, builtinDisabled: false, preference },
    }) },
  }));
  assert.match(autoOff("automatic"), /~\/\.pi\/agent\/mcp\.json 中的 autoEnableCodemode 为 false，因此会话不会为这些工具开启代码模式：只有代码模式设为“始终开启”或工具搜索开启时才能调用它们。/);
  assert.doesNotMatch(autoOff("always"), /autoEnableCodemode/);
  // Tools the model is offered directly need no Code mode.
  const direct = text(view({
    selected: "global\0lint",
    load: { state: "loaded", data: overview({ files: [{ ...globalFile, autoEnableCodemode: false }], servers: [stdioServer] }) },
  }));
  assert.doesNotMatch(direct, /autoEnableCodemode/);
});

test("a refused entry shows why, and nothing it would run or send", () => {
  const refused = server({
    name: "bad",
    invalidError: "\"sse\" transport is not supported",
    url: "https://old/sse",
    commandFields: [{ kind: "header", name: "X" }],
    variableReferences: [{ kind: "header", name: "X", variables: ["SECRET"] }],
  });
  const shown = text(view({ selected: "global\0bad", load: { state: "loaded", data: overview({ servers: [refused] }) } }));
  assert.match(shown, /状态 被 Pi 拒绝 Pi 拒绝加载此条目，它不会连接： "sse" transport is not supported/);
  assert.doesNotMatch(shown, /Shell 命令|主机环境变量|登录/);

  const password = text(view({
    selected: "global\0pw",
    load: { state: "loaded", data: overview({ servers: [server({ name: "pw", transport: "http", url: "https://x/mcp", webPasswordField: { kind: "header", name: "Authorization" } })] }) },
  }));
  assert.match(password, /状态 已拒绝：引用了 PI_WEB_PASSWORD 引用了 PI_WEB_PASSWORD。Pi Web 会拒绝连接它/);
});

test("repository text is shown with its hidden characters escaped", () => {
  const sneaky = server({ name: "safe\u202Ejs.revres", scope: "project", sourcePath: projectFile.path, transport: "stdio", command: "node", args: ["a\nb"], envNames: ["A\u200BB"] });
  const html = view({
    cwd: "/Users/me/repo",
    selected: "project\0safe\u202Ejs.revres",
    load: { state: "loaded", data: overview({ files: [globalFile, projectFile], servers: [sneaky], project: { cwd: "/Users/me/repo", trust: trusted } }) },
  });
  assert.ok(!/[\n\u202E\u200B]/.test(html), "no raw newline, override or zero-width space reaches the markup");
  assert.match(decode(html), /"a\\u\{000A\}b"/);
  assert.match(decode(html), /safe\\u\{202E\}js\.revres/);
  assert.match(text(html), /包含不可见字符或控制字符/);
});

test("MCP being off, a refused project folder, and file problems are said above and below the list", () => {
  const off = text(view({ load: { state: "loaded", data: overview({ mcp: { available: false, reason: "operator-disabled", error: "x" } }) } }));
  assert.match(off, /MCP 已关闭：运行 Pi Web 的环境设置了 PI_WEB_DISABLE_MCP。/);
  const internals = text(view({ load: { state: "loaded", data: overview({ mcp: { available: false, reason: "internals-unavailable", error: "x", detail: "cannot find module" } }) } }));
  assert.match(internals, /无法加载 SDK 的 MCP 模块。.*cannot find module/);
  const builtin = text(view({ load: { state: "loaded", data: overview({ mcp: { available: false, reason: "builtin-disabled", error: "x", settingsPath: "/Users/me/.pi/agent/settings.json" } }) } }));
  assert.match(builtin, /~\/\.pi\/agent\/settings\.json 中的 extensions 设置关闭了 builtin:mcp/);

  const projectError = view({
    cwd: "/Users/me/gone",
    load: { state: "loaded", data: overview(), projectError: { error: "cwd must be a directory", reason: "cwd-not-directory" } },
  });
  assert.match(text(projectError), /未列出此项目的服务器：项目文件夹已不存在或不是文件夹。/);
  assert.match(decode(projectError), /class="mcp-sidebar-group-empty">未列出</);

  const broken = view({
    load: {
      state: "loaded",
      data: overview({ files: [{ ...globalFile, problems: [{ reason: "unparsable", error: "Unexpected token } in JSON at position 9 (line 1 column 10)" }] }] }),
    },
  });
  const shown = text(broken);
  assert.match(decode(broken), /class="config-footer-status-summary is-error">1 个文件问题</);
  assert.match(shown, /~\/\.pi\/agent\/mcp\.json 该文件不是有效的 JSON，其中的服务器都不会加载。 Unexpected token \} in JSON at position 9/);
  assert.match(decode(broken), /class="mcp-sidebar-group-empty">未列出：请看下方的文件问题</);
  // The detail pane agrees: the servers are hidden by the problem, not missing.
  assert.match(shown, /无法列出任何服务器：请看下方的文件问题。/);
  assert.doesNotMatch(shown, /No MCP servers yet/);
});

test("MCP being off is said once, above the list: the server's pane points at that notice", () => {
  const html = view({
    selected: "global\0web",
    load: { state: "loaded", data: overview({
      mcp: { available: false, reason: "internals-unavailable", error: "x", detail: "cannot find module" },
      servers: [server({ name: "web", transport: "http", url: "https://x/mcp", usesOAuth: true, signedIn: false, validated: false })],
    }) },
  });
  const shown = text(html);
  assert.equal(shown.match(/MCP 已关闭：/g)?.length, 1);
  assert.match(shown, /MCP 关闭期间，无法在此更改服务器。/);
  assert.doesNotMatch(shown, /MCP 已关闭 on this Pi Web server/);
  assert.doesNotMatch(shown, /Listed unchecked/);
  const noticeId = noticeIdOf(html, "MCP 已关闭");
  assert.ok(decode(html).split(`aria-describedby="${noticeId}"`).length - 1 >= 3, "测试, 移除 and 登录 point at the notice");
});

test("a dangling project link needs no trust, so only the footer speaks of it", () => {
  const dangling = { ...projectFile, problems: [{ reason: "link-dangling", error: "a symbolic link to nothing" }] };
  const html = view({
    cwd: "/Users/me/repo",
    load: { state: "loaded", data: overview({
      files: [globalFile, dangling],
      project: { cwd: "/Users/me/repo", trust: { requiresTrust: false, trusted: true, decision: null, inherited: false } },
    }) },
  });
  const shown = text(html);
  assert.doesNotMatch(shown, /not trusted/);
  assert.match(shown, /1 个文件问题/);
});

test("an untrusted project's notice offers Trust only where the trust dialog would", () => {
  const trustButton = /<button type="button" class="config-button config-button-secondary config-button-small">信任项目…<\/button>/;
  const projectServer = server({ name: "p", scope: "project", sourcePath: projectFile.path, transport: "stdio", command: "node" });
  const withTrust = (project, files = [globalFile, projectFile], props = {}) => decode(view({
    cwd: "/Users/me/repo",
    load: { state: "loaded", data: overview({ files, servers: [projectServer], project: { cwd: "/Users/me/repo", ...project } }) },
    onTrustProject() {},
    ...props,
  }));

  // The folder requires trust and is not trusted: the notice and its button share one line.
  const offered = withTrust({ trust: untrusted });
  assert.match(offered, /<div id="[^"]+" role="status" class="config-notice has-action"><span class="config-notice-text">此项目未受信任，其 \.pi\/mcp\.json 中的服务器不会连接。 在此项目受信任之前，Pi Web 不会更改它们。<\/span><button type="button"[^>]*>信任项目…<\/button><\/div>/);
  // An ancestor marked untrusted: trusting records this folder's own decision, which wins.
  assert.match(withTrust({ trust: { ...untrusted, decision: false, decisionPath: "/Users/me", inherited: true } }), trustButton);

  // The notice stays, without a button, where trusting could not succeed:
  // an unreadable trust.json, whose failure trusting would meet too...
  const unreadable = withTrust({ trustError: "Lock file is already being held" });
  assert.match(unreadable, /Pi Web 无法读取信任记录/);
  assert.doesNotMatch(unreadable, trustButton);
  // ...and an explicit false on a folder that requires no trust (a dangling .pi/mcp.json link),
  // where POST /api/project-trust answers trust-not-required.
  const dangling = withTrust(
    { trust: { requiresTrust: false, trusted: true, decision: false, decisionPath: "/Users/me/repo", inherited: false } },
    [globalFile, { ...projectFile, problems: [{ reason: "link-dangling", error: "a symbolic link to nothing" }] }],
  );
  assert.match(dangling, /此项目未受信任/);
  assert.doesNotMatch(dangling, trustButton);

  // Nothing to trust: trusted, exactly or through a parent.
  assert.doesNotMatch(withTrust({ trust: trusted }), trustButton);
  assert.doesNotMatch(withTrust({ trust: { ...trusted, decisionPath: "/Users/me", inherited: true } }), trustButton);
  // No handler, no button: the panel never offers one that does nothing.
  assert.doesNotMatch(withTrust({ trust: untrusted }, undefined, { onTrustProject: undefined }), trustButton);
});

test("the container renders with the page's trust status and handler without fetching anything itself", () => {
  assert.match(text(render(h(McpConfig, { cwd: "/Users/me/repo", trust: untrusted, onTrustProject() {}, onClose() {}, embedded: true }))), /加载中\.\.\./);
});

test("the notices above the list sit together in their own box, right before the split view", () => {
  const html = decode(view({
    load: { state: "loaded", data: overview({ servers: [httpServer], hostInactive: { owner: "/ext/other-mcp.ts", cwd: "/Users/me/repo", updatedAt: 1 } }) },
    undo: { scope: "global", name: "lint", path: globalFile.path, token: "t", expiresInMs: 60_000, undoing: false },
  }));
  const notices = html.match(/<div class="mcp-config-notices">([\s\S]*?)<\/div><div class="config-split-view">/);
  assert.ok(notices, "the notices sit in one box right before the split view");
  assert.equal((notices[1].match(/role="status" class="config-notice/g) ?? []).length, 2);
});

test("a selected row renders with the ref attached as a plain button: the ref is not an attribute", () => {
  assert.match(view({ selected: "codemode" }), /<button type="button" aria-label="代码模式：[^"]+" aria-current="page" class="config-sidebar-item">/);
});

test("loading, a failed load and an empty listing each say so", () => {
  assert.match(text(view({ load: { state: "loading" } })), /加载中\.\.\./);
  const denied = decode(view({ load: { state: "failed", error: { error: "Access denied", reason: "cwd-denied" } } }));
  assert.match(denied, /<div role="alert" class="config-sidebar-message is-error">无法读取 MCP 设置。 Pi Web 无权读取此文件夹。<\/div>/);
  // Nothing to translate for an internal failure: its diagnostic is the reason.
  assert.match(text(view({ load: { state: "failed", error: { error: "EACCES: permission denied", reason: "internal" } } })), /无法读取 MCP 设置。 EACCES: permission denied/);
  // A load that never answered ends with a way out, never "Loading..." for good.
  assert.match(
    text(view({ load: { state: "failed", error: { error: "GET /api/mcp did not answer within 15000 ms", timedOut: true } } })),
    /无法读取 MCP 设置。 Pi Web 没有及时响应。请点“刷新”重试。/,
  );
  const empty = text(view({ load: { state: "loaded", data: overview() } }));
  assert.match(empty, /还没有 MCP 服务器。~\/\.pi\/agent\/mcp\.json 和项目 \.pi\/mcp\.json 中的服务器会显示在这里。/);
  assert.match(empty, /全局 没有服务器/);
  assert.doesNotMatch(empty, /0 of 0/);
  assert.match(text(view({ selected: "global\0gone" })), /选择一个服务器或代码模式。/);
  assert.match(decode(view({ refreshing: true })), /<button type="button" disabled="" class="config-button config-button-secondary config-button-default">刷新<\/button>/);
});

/** The Code mode switch's buttons, by label, with whether each is pressed and disabled. */
function codemodeOptions(html) {
  const group = decode(html).match(/<div role="group" aria-label="代码模式"[^>]*>([\s\S]*?)<\/div>/)?.[1];
  assert.ok(group, "the 代码模式 switch is rendered");
  return [...group.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(([, attributes, label]) => ({
    label,
    pressed: /aria-pressed="true"/.test(attributes),
    disabled: /disabled=""/.test(attributes),
    describedBy: attributes.match(/aria-describedby="([^"]+)"/)?.[1],
  }));
}

function codemodeView(info, props = {}) {
  return view({ selected: "codemode", load: { state: "loaded", data: overview({ codemode: info, ...props.data }) }, ...props.view });
}

test("the 代码模式 pane offers 自动 and 始终开启, and says once when its settings apply", () => {
  const automatic = codemodeView({ sandbox: { state: "available" }, builtinDisabled: false, preference: "automatic" });
  assert.deepEqual(codemodeOptions(automatic), [
    { label: "自动", pressed: true, disabled: false, describedBy: undefined },
    { label: "始终开启", pressed: false, disabled: false, describedBy: undefined },
  ]);
  assert.match(text(automatic),
    /添加 MCP 代码模式 让模型写一小段脚本来调用工具，MCP 工具默认用这种方式调用。改动只对之后新建的会话生效。 模式 自动 始终开启 有使用代码模式的 MCP 服务器连上时自动开启。 沙箱 可用。/);
  // Said once, in the intro, not under every row.
  assert.equal(text(codemodeView({
    sandbox: { state: "available" },
    builtinDisabled: false,
    preference: "automatic",
    mode: { settingsPath: "/Users/me/.pi/agent/settings.json", value: "on" },
    inlineBudget: { settingsPath: "/Users/me/.pi/agent/settings.json", default: 3000, max: 1_000_000 },
  })).match(/之后新建的会话/g).length, 1);
  assert.doesNotMatch(automatic, /role="alert"/);

  // A self-test nobody has run yet leaves Always on available and has its own wording.
  const always = codemodeView({ sandbox: { state: "not-checked" }, builtinDisabled: false, preference: "always" });
  assert.deepEqual(codemodeOptions(always).map(({ label, pressed, disabled }) => [label, pressed, disabled]), [
    ["自动", false, false],
    ["始终开启", true, false],
  ]);
  assert.match(text(always),
    /会话启动时即开启代码模式。 沙箱 尚未检查：Pi Web 启动后的第一个会话开始时才会运行自检。/);

  // While a save is on its way both options wait, and the pane says it is saving.
  const saving = codemodeView({ sandbox: { state: "available" }, builtinDisabled: false, preference: "automatic" }, {
    view: { codemodeSave: { saving: true, error: null } },
  });
  assert.deepEqual(codemodeOptions(saving).map(({ disabled }) => disabled), [true, true]);
  assert.match(decode(saving), /<span role="status" class="mcp-config-line is-dim">保存中…<\/span>/);
});

test("始终开启 is disabled with a visible reason while no session could offer 代码模式", () => {
  const reasonOf = (html) => {
    const [, always] = codemodeOptions(html);
    assert.equal(always.disabled, true);
    assert.ok(always.describedBy, "the disabled option points at its reason");
    const reason = decode(html).match(new RegExp(`<span id="${always.describedBy}" class="config-scope-switch-reason">([^<]*)</span>`))?.[1];
    assert.ok(reason, "the reason is visible text, not a tooltip");
    // Automatic can still be chosen.
    assert.equal(codemodeOptions(html)[0].disabled, false);
    return reason;
  };
  assert.equal(
    reasonOf(codemodeView({ sandbox: { state: "unavailable", error: "worker exited" }, builtinDisabled: false, preference: "automatic" })),
    "“始终开启”不可用：代码模式的沙箱无法在此 Pi Web 服务器上运行。",
  );
  const globalPath = "/Users/me/.pi/agent/settings.json";
  assert.equal(
    reasonOf(codemodeView({ sandbox: { state: "available" }, builtinDisabled: true, builtinSettingsPath: globalPath, globalBuiltinSettingsPath: globalPath, preference: "always" })),
    "“始终开启”不可用：~/.pi/agent/settings.json 中的 -builtin:codemode 关闭了代码模式。",
  );
  // A project that turns Code mode back on for its sessions does not make the global switch work elsewhere.
  assert.equal(
    reasonOf(codemodeView({ sandbox: { state: "available" }, builtinDisabled: false, globalBuiltinSettingsPath: globalPath, preference: "automatic" })),
    "“始终开启”不可用：~/.pi/agent/settings.json 中的 -builtin:codemode 关闭了代码模式。",
  );

  const down = text(codemodeView({ sandbox: { state: "unavailable", error: "worker exited" }, builtinDisabled: true, builtinSettingsPath: globalPath, globalBuiltinSettingsPath: globalPath, preferenceError: "Unexpected token" }));
  // An unreadable settings file offers no choice to save into it.
  assert.match(down, /无法读取全局设置文件： Unexpected token/);
  assert.doesNotMatch(down, /Turns on when an MCP server/);
  assert.match(down, /无法在此 Pi Web 服务器上运行，因此没有会话提供代码模式： worker exited/);
  assert.match(down, /已被 ~\/\.pi\/agent\/settings\.json 中的 -builtin:codemode 关闭。/);
  const html = view({ load: { state: "loaded", data: overview({ codemode: { sandbox: { state: "unavailable", error: "x" }, builtinDisabled: false, preference: "automatic" } }) } });
  assert.match(row(html, "代码模式"), /aria-label="代码模式：不可用"/);
  assert.match(decode(html), /class="mcp-sidebar-badge is-error">不可用</);
});

test("a trusted project that turns 代码模式 off for itself leaves 始终开启, a global choice, available", () => {
  const html = codemodeView({
    sandbox: { state: "available" },
    builtinDisabled: true,
    builtinSettingsPath: "/work/app/.pi/settings.json",
    preference: "automatic",
  });
  assert.deepEqual(codemodeOptions(html).map(({ label, disabled, describedBy }) => [label, disabled, describedBy]), [
    ["自动", false, undefined],
    ["始终开启", false, undefined],
  ]);
  assert.doesNotMatch(decode(html), /config-scope-switch-reason/);
  // The project's own line says what it does to its sessions, and that the switch still reaches the others.
  assert.match(text(html),
    /扩展 \/work\/app\/\.pi\/settings\.json 中的 -builtin:codemode 为此项目的会话关闭了代码模式。“始终开启”仍对其他文件夹中的会话生效。/);
});

test("a failed save is shown with its reason on every platform", () => {
  const info = { sandbox: { state: "available" }, builtinDisabled: false, preference: "automatic" };
  const failed = (error) => {
    const html = codemodeView(info, { view: { codemodeSave: { saving: false, error } } });
    return decode(html).match(/<span role="alert" class="mcp-config-line is-error">([\s\S]*?)<\/span>(?=<span|<\/div>)/)?.[1];
  };
  assert.equal(text(failed({ error: "Untrusted API request", reason: "request-denied" })),
    "无法保存此选择： 该请求并非来自此页面，Pi Web 已拒绝。");
  // An internal failure (the settings file no longer parses, its lock is held) shows its diagnostic.
  assert.equal(text(failed({ error: "Unexpected token n in JSON", reason: "internal" })), "无法保存此选择： Unexpected token n in JSON");
  assert.equal(text(failed({ error: "失败 to fetch" })), "无法保存此选择： 失败 to fetch");
  assert.equal(text(failed({ error: "PUT /api/tools/settings did not answer within 15000 ms", timedOut: true })),
    "无法保存此选择： Pi Web 没有及时响应，此选择可能未保存。");
});

test("a trusted project whose defaultTools decides 代码模式 is named in the pane", () => {
  const settingsPath = "/Users/me/repo/.pi/settings.json";
  const pane = (globalPreference, projectPreference, autoEnableCodemode = true) => text(view({
    cwd: "/Users/me/repo",
    selected: "codemode",
    load: { state: "loaded", data: overview({
      files: [{ ...globalFile, autoEnableCodemode }, projectFile],
      project: { cwd: "/Users/me/repo", trust: trusted },
      codemode: {
        sandbox: { state: "available" },
        builtinDisabled: false,
        preference: globalPreference,
        projectOverride: { settingsPath, preference: projectPreference },
      },
    }) },
  }));
  assert.match(pane("always", "automatic"),
    /此项目自行决定：~\/repo\/\.pi\/settings\.json 中的 defaultTools 让其会话启动时不开启代码模式，与“自动”相同，无论你在此处如何选择。/);
  assert.match(pane("automatic", "always"),
    /此项目自行决定：~\/repo\/\.pi\/settings\.json 中的 defaultTools 让其会话启动时即开启代码模式，无论你在此处如何选择。/);
  // The switch still shows and saves the global choice.
  assert.match(pane("automatic", "always"), /模式 自动 始终开启 有使用代码模式的 MCP 服务器连上时自动开启/);
  // With autoEnableCodemode false, Automatic is what these sessions get, so the warning follows the project.
  assert.match(pane("always", "automatic", false), /~\/\.pi\/agent\/mcp\.json 中的 autoEnableCodemode 为 false，因此“自动”永远不会开启代码模式/);
  assert.doesNotMatch(pane("automatic", "always", false), /autoEnableCodemode/);
});

test("the autoEnableCodemode warning names the file whose value sessions read", () => {
  // autoEnableCodemode false (the trusted project's value wins) keeps Automatic from ever turning it on.
  const autoOff = (preference) => text(view({
    cwd: "/Users/me/repo",
    selected: "codemode",
    load: { state: "loaded", data: overview({
      files: [{ ...globalFile, autoEnableCodemode: true }, { ...projectFile, autoEnableCodemode: false }],
      project: { cwd: "/Users/me/repo", trust: trusted },
      codemode: { sandbox: { state: "available" }, builtinDisabled: false, preference },
    }) },
  }));
  assert.match(autoOff("automatic"), /模式 自动 始终开启 有使用代码模式的 MCP 服务器连上时自动开启。 ~\/repo\/\.pi\/mcp\.json 中的 autoEnableCodemode 为 false，因此“自动”永远不会开启代码模式/);
  assert.doesNotMatch(autoOff("always"), /autoEnableCodemode/);
});

test("the container shows that it is loading before the first answer", () => {
  assert.match(text(render(h(McpConfig, { cwd: null, onClose() {}, embedded: true }))), /加载中\.\.\./);
});

test("the 代码模式 pane's budget field saves a whole number, or empty for pi's default", () => {
  const budget = { settingsPath: "/Users/me/.pi/agent/settings.json", default: 3000, max: 1_000_000 };
  const info = (inlineBudget, extra = {}) => ({ sandbox: { state: "available" }, builtinDisabled: false, preference: "automatic", inlineBudget, ...extra });
  const field = (html) => decode(html).match(/<form class="mcp-codemode-budget">([\s\S]*?)<\/form>/)?.[1];
  const input = (html) => field(html).match(/<input[^>]*>/)[0];
  const save = (html) => field(html).match(/<button type="submit"[^>]*>/)[0];

  const unset = codemodeView(info(budget));
  assert.match(input(unset), /aria-label="工具清单预算"/);
  assert.match(input(unset), /value=""/);
  assert.match(input(unset), /placeholder="3000"/);
  assert.match(input(unset), /inputMode="numeric"/);
  // Nothing typed yet: nothing to save.
  assert.match(save(unset), /disabled=""/);
  assert.match(text(unset), /有使用代码模式的 MCP 服务器连上时自动开启。 工具清单预算 token 保存 代码模式说明里列出工具最多用的 token 数，列不下的由脚本用 searchTools\(\) 查找。留空使用默认值 3000。 沙箱/);
  // The hint describes the field.
  const hintId = input(unset).match(/aria-describedby="([^"]+)"/)[1];
  assert.match(decode(unset), new RegExp(`<span id="${hintId}" class="mcp-config-line">代码模式说明里列出工具最多用的 token 数`));
  assert.match(input(codemodeView(info({ ...budget, value: 1000 }))), /value="1000"/);

  // While a budget save is on its way, the field keeps focus (read-only, not disabled), Save waits, and the
  // choice waits too; the Saving… line is the budget's, not the choice's.
  const saving = codemodeView(info({ ...budget, value: 1000 }), { view: { codemodeSave: { saving: true, error: null, target: "inlineBudget" } } });
  assert.match(input(saving), /readOnly=""/);
  assert.doesNotMatch(input(saving), /disabled/);
  assert.match(save(saving), /disabled=""/);
  assert.match(field(saving), /<span role="status" class="mcp-config-line is-dim">保存中…<\/span>/);
  assert.deepEqual(codemodeOptions(saving).map(({ disabled }) => disabled), [true, true]);
  assert.equal(decode(saving).match(/role="status"/g).length, 1);
  // A server change on its way makes the field wait as well.
  assert.match(input(codemodeView(info(budget), { view: { busy: "switch:global\0docs" } })), /readOnly=""/);

  // Each failure shows in the row its save was made from.
  const failure = { error: "Invalid settings.json: codemode must be an object", reason: "internal" };
  const budgetFailed = text(codemodeView(info(budget), { view: { codemodeSave: { saving: false, error: failure, target: "inlineBudget" } } }));
  assert.match(budgetFailed, /无法保存此预算： Invalid settings\.json: codemode must be an object 沙箱/);
  assert.doesNotMatch(budgetFailed, /Could not save the choice/);
  const choiceFailed = text(codemodeView(info(budget), { view: { codemodeSave: { saving: false, error: failure, target: "preference" } } }));
  assert.match(choiceFailed, /无法保存此选择：/);
  assert.doesNotMatch(choiceFailed, /Could not save the budget/);

  // A stored value pi ignores and a project that decides for itself are said under the field.
  const notices = text(codemodeView(info({
    ...budget,
    invalid: '"lots"',
    projectOverride: { settingsPath: "/Users/me/repo/.pi/settings.json", value: 800 },
  })));
  assert.match(notices, /~\/\.pi\/agent\/settings\.json 中的 codemode\.inlineBudget 为 "lots"，pi 会忽略它，因此会话使用 3000。保存会替换它。/);
  assert.match(notices, /此项目自行决定：~\/repo\/\.pi\/settings\.json 中的 codemode\.inlineBudget 让其会话使用 800，无论你在此处保存什么。/);

  // An unreadable settings file offers no field to save into it; an overview without a budget shows no row.
  const unreadable = text(codemodeView(info(undefined, { inlineBudgetError: "Unexpected token" })));
  assert.match(unreadable, /工具清单预算 无法读取全局设置文件： Unexpected token/);
  assert.doesNotMatch(codemodeView(info(undefined)), /工具清单预算/);
});

/** The Built-in tools switch's buttons, by label, with whether each is pressed and disabled. */
function modeOptions(html) {
  const group = decode(html).match(/<div role="group" aria-label="内置工具"[^>]*>([\s\S]*?)<\/div>/)?.[1];
  assert.ok(group, "the mode switch is rendered");
  return [...group.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(([, attributes, label]) => [
    label,
    /aria-pressed="true"/.test(attributes),
    /disabled=""/.test(attributes),
  ]);
}

test("the 代码模式 pane's 内置工具 switch keeps tools declared or leaves them to scripts", () => {
  const settingsPath = "/Users/me/.pi/agent/settings.json";
  const info = (mode, extra = {}) => ({ sandbox: { state: "available" }, builtinDisabled: false, preference: "always", mode, ...extra });

  const on = codemodeView(info({ settingsPath, value: "on" }));
  assert.deepEqual(modeOptions(on), [["直接调用", true, false], ["脚本调用", false, false]]);
  // Between the choice and the budget, with what it does.
  assert.match(text(on), /会话启动时即开启代码模式。 内置工具 直接调用 脚本调用 模型直接调用 read、bash 等工具。 沙箱/);
  // The Code mode choice keeps its own switch.
  assert.deepEqual(codemodeOptions(on).map(({ label }) => label), ["自动", "始终开启"]);

  const only = text(codemodeView(info({ settingsPath, value: "only" })));
  assert.match(only, /内置工具 直接调用 脚本调用 代码模式开启时，模型只在脚本中调用 read、bash 等工具。 沙箱/);
  assert.doesNotMatch(only, /Under 自动/);
  // Under Automatic, Code mode and so "only" wait for an MCP server.
  assert.match(text(codemodeView(info({ settingsPath, value: "only" }, { preference: "automatic" }))),
    /只在脚本中调用 read、bash 等工具。 模式为“自动”时，要等代码模式开启后才生效。 沙箱/);

  // While a mode save is on its way, both switches wait, and the Saving… line is the mode's.
  const saving = codemodeView(info({ settingsPath, value: "on" }), { view: { codemodeSave: { saving: true, error: null, target: "mode" } } });
  assert.deepEqual(modeOptions(saving).map(([, , disabled]) => disabled), [true, true]);
  assert.deepEqual(codemodeOptions(saving).map(({ disabled }) => disabled), [true, true]);
  assert.equal(decode(saving).match(/role="status"/g).length, 1);
  assert.match(text(saving), /内置工具 直接调用 脚本调用 保存中…/);
  // Another write on its way makes the switch wait as well.
  assert.deepEqual(modeOptions(codemodeView(info({ settingsPath, value: "on" }), { view: { busy: "switch:global\0docs" } })).map(([, , disabled]) => disabled), [true, true]);

  // Each failure shows in the row its save was made from.
  const failure = { error: "Invalid settings.json: codemode must be an object", reason: "internal" };
  const modeFailed = text(codemodeView(info({ settingsPath, value: "on" }), { view: { codemodeSave: { saving: false, error: failure, target: "mode" } } }));
  assert.match(modeFailed, /无法保存此设置： Invalid settings\.json: codemode must be an object 沙箱/);
  assert.doesNotMatch(modeFailed, /Could not save the choice/);
  const choiceFailed = text(codemodeView(info({ settingsPath, value: "on" }), { view: { codemodeSave: { saving: false, error: failure, target: "preference" } } }));
  assert.doesNotMatch(choiceFailed, /Could not save the setting/);

  // A stored value that is not a mode and a project that decides for itself are said under the switch.
  const notices = text(codemodeView(info({
    settingsPath,
    value: "on",
    invalid: '"never"',
    projectOverride: { settingsPath: "/Users/me/repo/.pi/settings.json", value: "only" },
  })));
  assert.match(notices, /~\/\.pi\/agent\/settings\.json 中的 codemode\.mode 为 "never"，pi 会把它当作 "on"。选择任一选项都会替换它。/);
  assert.match(notices, /此项目自行决定：~\/repo\/\.pi\/settings\.json 中的 codemode\.mode 让其会话只在脚本中调用这些工具，无论你在此处如何选择。/);

  // An unreadable settings file offers no switch to save into it; an overview without a mode shows no row.
  const unreadable = codemodeView(info(undefined, { modeError: "Unexpected token" }));
  assert.match(text(unreadable), /内置工具 无法读取全局设置文件： Unexpected token/);
  assert.doesNotMatch(unreadable, /aria-label="内置工具"/);
  assert.doesNotMatch(codemodeView(info(undefined)), /内置工具/);
});

test("every string the panel shows is translated", () => {
  const literal = (text) => [...text.matchAll(/\bt\("([^"]+)"/g)].map((match) => match[1]);
  const quoted = (text) => [...text.matchAll(/"((?:mcp|i18n|skills|settings)\.[\w.-]+)"/g)].map((match) => match[1]);
  const problemReasons = [...apiTypesSource.slice(
    apiTypesSource.indexOf("export type McpConfigFileProblemReason"),
    apiTypesSource.indexOf("export interface McpConfigFileProblem "),
  ).matchAll(/\| "([a-z-]+)"/g)].map((match) => match[1]);
  const reasonCodes = [...apiTypesSource.slice(
    apiTypesSource.indexOf("export type McpRefusalReason"),
    apiTypesSource.indexOf("export interface McpErrorResponse"),
  ).matchAll(/\| "([a-z-]+)"/g)].map((match) => match[1]).filter((code) => code !== "internal");
  const keys = [
    ...literal(source),
    ...quoted(source),
    ...quoted(helperSource),
    ...quoted(displaySource),
    ...problemReasons.map((reason) => `mcp.fileProblem.${reason}`),
    ...reasonCodes.map((code) => `mcp.reason.${code}`),
    "mcp.transport.stdio",
    "mcp.transport.http",
  ];
  assert.ok(literal(source).length >= 40);
  for (const key of keys) assert.equal(typeof messages[key], "string", `${key} is missing from en.ts`);
  // No English sentence is written into the markup itself.
  assert.doesNotMatch(source, />\s*[A-Z][a-z]+(?: [a-z]+){2,}[.:]?\s*</);
});

/** The selected server's exposure dropdown: its opening tag, and each option with whether it is selected. */
function exposureSelect(html) {
  const markup = decode(html);
  const match = markup.match(/(<select[^>]*class="mcp-add-input mcp-exposure-select"[^>]*>)([\s\S]*?)<\/select>/);
  assert.ok(match, "the 工具 row holds the exposure dropdown");
  return {
    tag: match[1],
    options: [...match[2].matchAll(/<option value="([^"]+)"( selected="")?>([^<]*)<\/option>/g)].map(([, value, selected, label]) => ({ value, selected: Boolean(selected), label })),
  };
}

test("a server's 工具 row chooses its exposure, saying in one line what each costs", () => {
  const select = exposureSelect(view({ selected: "global\0github" }));
  assert.match(select.tag, /aria-label="github 的工具如何提供给模型"/);
  assert.doesNotMatch(select.tag, /disabled/);
  assert.deepEqual(select.options, [
    { value: "codemode", selected: true, label: "代码模式（默认）" },
    { value: "deferred", selected: false, label: "工具搜索" },
    { value: "direct", selected: false, label: "直接声明" },
    { value: "hidden", selected: false, label: "已隐藏" },
  ]);
  // The description of the chosen exposure describes the dropdown.
  const describedBy = select.tag.match(/aria-describedby="([^"]+)"/)[1];
  assert.match(decode(view({ selected: "global\0github" })), new RegExp(`<span id="${describedBy}" class="mcp-config-line">只列出服务器名称和简介`));
  const shown = text(view({ selected: "global\0github" }));
  assert.match(shown, /工具 代码模式（默认） .*? 只列出服务器名称和简介，代码模式脚本按需搜索它的工具。 文件/);
  assert.doesNotMatch(shown, /toolExposure/);

  // toolExposure rules are named and kept.
  const off = text(view({
    selected: "global\0github",
    load: { state: "loaded", data: overview({ servers: [{ ...httpServer, enabled: false, exposure: "deferred", toolExposureCount: 2 }] }) },
  }));
  assert.match(off, /工具搜索加载后才声明，不需要代码模式。 toolExposure 中的 2 条规则不受影响。/);

  // Behind tool search, while -builtin:tool-search turns it off, only Code mode scripts reach the tools.
  const noSearch = (toolSearchDisabled) => text(view({
    selected: "global\0github",
    load: { state: "loaded", data: overview({ servers: [{ ...httpServer, exposure: "deferred" }], toolSearchDisabled }) },
  }));
  assert.match(noSearch({ settingsPath: "/Users/me/.pi/agent/settings.json" }),
    /~\/\.pi\/agent\/settings\.json 中的 -builtin:tool-search 关闭了工具搜索，因此这些工具只能在代码模式开启时由代码模式脚本调用。/);
  assert.match(noSearch({}), /-builtin:tool-search 关闭了工具搜索/);
  assert.doesNotMatch(noSearch(undefined), /tool-search/);

  // A refused entry has no exposure to choose.
  const refused = view({ selected: "global\0bad", load: { state: "loaded", data: overview({ servers: [server({ name: "bad", invalidError: "x" })] }) } });
  assert.doesNotMatch(refused, /mcp-exposure-select/);
});

test("the exposure dropdown waits like a switch, and points at why it cannot be changed", () => {
  // The group fixture's servers, validated, so each has an exposure.
  const validated = (props = {}) => writeView({
    ...props,
    data: { servers: groupOverview().servers.map((item) => ({ ...item, exposure: "codemode" })), ...props.data },
  });
  // While any change is on its way it waits; the one for this server says it is saving.
  const saving = validated({ view: { busy: "exposure:global\0docs" } });
  assert.match(exposureSelect(saving).tag, /disabled=""/);
  assert.match(decode(saving), /<span class="mcp-exposure-choice"><select[^>]*>[\s\S]*?<\/select><span role="status" class="mcp-config-line is-dim">保存中…<\/span><\/span>/);
  assert.match(exposureSelect(validated({ view: { busy: "switch:global\0pw" } })).tag, /disabled=""/);
  assert.doesNotMatch(exposureSelect(validated()).tag, /disabled/);
  // Where no change may be written, it points at the notice that says why.
  const html = validated({ data: { mcp: { available: false, reason: "operator-disabled", error: "x" } } });
  const select = exposureSelect(html);
  assert.match(select.tag, /disabled=""/);
  assert.equal(detailControls(html).note, undefined, "the notice above the list says it");
  assert.match(select.tag, new RegExp(`aria-describedby="[^"]* ${noticeIdOf(html, "MCP 已关闭")}"`));
});

/** The id of the notice above the list that starts with `start`. */
function noticeIdOf(html, start) {
  const id = decode(html).match(new RegExp(`<div id="([^"]+)" role="status" class="config-notice[^"]*">(?:<[^>]+>)*${start}`))?.[1];
  assert.ok(id, `a notice starts with ${start}`);
  return id;
}

/** The opening tags of the selected server's Remove button and switch, and the note under them. */
function detailControls(html) {
  const markup = decode(html);
  // The note is there only when the controls cannot be used, or under -builtin:mcp.
  const actions = markup.match(/<div class="config-detail-actions">([\s\S]*?)<\/div><\/div>(?:<div id="([^"]+)" class="config-detail-heading-note">([^<]*)<\/div>)?/);
  assert.ok(actions, "the detail header holds 移除 and the switch");
  const [, buttons, noteId, note] = actions;
  return {
    remove: buttons.match(/<button[^>]*class="config-button config-button-danger[^"]*"[^>]*>([^<]*)<\/button>/),
    toggle: buttons.match(/<button type="button" role="switch"[^>]*>/)?.[0],
    noteId,
    note,
  };
}

const groupOverview = (overrides = {}) => overview({
  files: [globalFile, projectFile],
  servers: [
    server({ name: "docs", transport: "http", url: "https://docs/mcp" }),
    server({ name: "pw", transport: "http", url: "https://pw/mcp", enabled: false, webPasswordField: { kind: "header", name: "Authorization" } }),
    server({ name: "repo", scope: "project", sourcePath: projectFile.path, transport: "stdio", command: "node" }),
  ],
  project: { cwd: "/Users/me/repo", trust: trusted },
  ...overrides,
});

function writeView(props = {}) {
  return view({ cwd: "/Users/me/repo", load: { state: "loaded", data: groupOverview(props.data) }, selected: "global\0docs", ...props.view });
}

test("a server's detail switches it and removes it, with no note while both work", () => {
  const { remove, toggle, note } = detailControls(writeView());
  assert.equal(remove[1], "移除");
  assert.doesNotMatch(remove[0], /disabled/);
  assert.match(toggle, /aria-checked="true" aria-label="关闭 docs"/);
  assert.doesNotMatch(toggle, /disabled|aria-describedby/);
  assert.equal(note, undefined, "nothing to say while the controls simply work");
  // A server that is off offers to turn it on.
  const off = detailControls(writeView({ data: { servers: [server({ name: "docs", enabled: false, transport: "http", url: "https://docs/mcp" })] } }));
  assert.match(off.toggle, /aria-checked="false" aria-label="开启 docs"/);
});

test("why a server cannot be changed is visible text its controls point at, said once", () => {
  // An untrusted project: neither control works; the trust notice above the list says why, and no note repeats it.
  const untrustedHtml = writeView({
    data: { project: { cwd: "/Users/me/repo", trust: untrusted } },
    view: { selected: "project\0repo" },
  });
  const untrustedProject = detailControls(untrustedHtml);
  assert.equal(untrustedProject.note, undefined);
  assert.match(text(untrustedHtml), /在此项目受信任之前，Pi Web 不会更改它们。/);
  const trustId = noticeIdOf(untrustedHtml, "此项目未受信任");
  assert.match(untrustedProject.toggle, /disabled=""/);
  assert.match(untrustedProject.toggle, new RegExp(`aria-describedby="${trustId}"`));
  assert.match(untrustedProject.remove[0], new RegExp(`disabled="" aria-describedby="${trustId}"`));
  // ...while the global servers beside it can still be changed.
  assert.doesNotMatch(detailControls(writeView({ data: { project: { cwd: "/Users/me/repo", trust: untrusted } } })).toggle, /disabled/);
  // An unreadable trust store blocks the project the same way, its own reason said above the list.
  const unreadable = writeView({ data: { project: { cwd: "/Users/me/repo", trustError: "locked" } }, view: { selected: "project\0repo" } });
  assert.equal(detailControls(unreadable).note, undefined);
  assert.match(text(unreadable), /在能够读取信任记录之前，Pi Web 不会更改它们。/);

  // MCP off on the server: everything is read-only, and the banner says so too.
  const offHtml = writeView({ data: { mcp: { available: false, reason: "operator-disabled", error: "x" } } });
  const mcpOff = detailControls(offHtml);
  assert.equal(mcpOff.note, undefined);
  assert.match(mcpOff.toggle, /disabled=""/);
  assert.match(mcpOff.toggle, new RegExp(`aria-describedby="${noticeIdOf(offHtml, "MCP 已关闭")}"`));
  assert.match(text(offHtml), /MCP 已关闭：运行 Pi Web 的环境设置了 PI_WEB_DISABLE_MCP。服务器会列出，但没有会话会连接它们。 MCP 关闭期间，无法在此更改服务器。/);
  const offSwitch = decode(offHtml).match(/<span class="config-sidebar-group-count">1\/2<\/span>(<button[^>]*>)/)[1];
  const bannerId = offSwitch.match(/aria-describedby="([^"]+)"/)?.[1];
  assert.ok(bannerId, "the disabled group switch points at the banner");
  assert.match(decode(offHtml), new RegExp(`<div id="${bannerId}" role="status" class="config-notice">MCP 已关闭`));
  // -builtin:mcp leaves the files writable: a project can turn MCP back on.
  const builtin = writeView({ data: { mcp: { available: false, reason: "builtin-disabled", error: "x", settingsPath: "/s.json" } } });
  assert.doesNotMatch(detailControls(builtin).toggle, /disabled/);
  assert.doesNotMatch(text(builtin), /cannot be changed here/);

  // An entry that references PI_WEB_PASSWORD is never turned on, but can be removed.
  const password = detailControls(writeView({ view: { selected: "global\0pw" } }));
  assert.equal(password.note, "它引用了 PI_WEB_PASSWORD，因此 Pi Web 不会开启它。");
  assert.match(password.toggle, /aria-checked="false"[^>]*disabled=""/);
  assert.doesNotMatch(password.remove[0], /disabled/);
});

test("while a change is on its way every control waits, and the one in use says so", () => {
  const removing = writeView({ view: { busy: "remove:global\0docs" } });
  const controls = detailControls(removing);
  assert.equal(controls.remove[1], "移除中…");
  assert.match(controls.remove[0], /disabled=""/);
  assert.match(controls.toggle, /disabled=""/);
  assert.match(decode(removing), /<button type="button" disabled="" class="config-button config-button-secondary config-button-default">刷新<\/button>/);
  for (const match of decode(removing).matchAll(/<button type="button" role="switch"[^>]*>/g)) assert.match(match[0], /disabled=""/);

  const switching = detailControls(writeView({ view: { busy: "switch:global\0docs" } }));
  assert.match(switching.toggle, /aria-busy="true"/);
  assert.equal(switching.remove[1], "移除");
  // A load on its way holds the controls too, so a click acts on the listing shown.
  assert.match(detailControls(writeView({ view: { refreshing: true } })).toggle, /disabled=""/);
  // The group switch shows its own wait (on: the one server off references PI_WEB_PASSWORD).
  assert.match(decode(writeView({ view: { busy: "group:global" } })), /<span class="config-sidebar-group-count">1\/2<\/span><button type="button" role="switch" aria-checked="true" aria-busy="true"/);
});

test("a failed change is said in the server's pane with its reason, and a timeout as possibly landed", () => {
  const failed = (failure, key = "global\0docs") => decode(writeView({ view: { actionError: { key, failure } } }))
    .match(/<p role="alert" class="mcp-config-line is-error">([^<]*)<\/p>/)?.[1];
  assert.equal(failed({ error: "/x: Unexpected token", reason: "unparsable", path: "/x" }), "无法更改该服务器： 该文件不是有效的 JSON，Pi Web 没有改动它。");
  assert.equal(failed({ error: "EACCES: permission denied", reason: "internal" }), "无法更改该服务器： EACCES: permission denied");
  assert.equal(failed({ error: "POST /api/mcp did not answer within 15000 ms", timedOut: true }),
    "无法更改该服务器： Pi Web 没有及时响应，更改可能未生效。");
  // Another server's failure is not shown on this one.
  assert.equal(failed({ error: "x", reason: "server-missing" }, "global\0pw"), undefined);
});

test("the group switch names what it left undone under the heading", () => {
  const html = decode(writeView({ view: { groupStatus: {
    scope: "global",
    keptOff: 1,
    failures: [{ name: "gone", failure: { error: "x", reason: "server-missing" } }, { name: "odd", failure: { error: "EIO", reason: "internal" } }],
    total: 3,
  } } }));
  const status = html.match(/<div class="config-sidebar-group-status">([\s\S]*?)<\/div><\/div>/)?.[1];
  assert.ok(status, "the status sits under the Global heading");
  assert.ok(html.indexOf("config-sidebar-group-status") > html.indexOf(">全局<"));
  assert.match(status, /<div role="status" class="config-sidebar-group-note">有 1 个引用 PI_WEB_PASSWORD 的服务器保持关闭。<\/div>/);
  assert.match(status, /<div role="alert" class="config-sidebar-group-error">3 个服务器中有 2 个未能更改：\ngone: 该文件已不再定义此服务器。\nodd: EIO/);
  const whole = decode(writeView({ view: { groupStatus: { scope: "project", keptOff: 0, failures: [], total: 1, error: { error: "x", reason: "project-untrusted" } } } }));
  assert.match(whole, /<div role="alert" class="config-sidebar-group-error">无法更改该服务器： 此项目未受信任，Pi Web 不会更改它的 \.pi\/mcp\.json。<\/div>/);
  assert.ok(whole.indexOf("config-sidebar-group-error") < whole.indexOf(">全局<"), "under the 项目 heading");
});

test("a removal offers 撤销 until the route lets it go, and says why an undo failed", () => {
  const notice = (undo) => decode(writeView({ view: { undo: { token: "t", scope: "global", name: "lint", path: "/Users/me/.pi/agent/mcp.json", expiresInMs: 60_000, undoing: false, ...undo } } }))
    .match(/<div role="status" class="config-notice[^"]*">([\s\S]*?)<\/div>/)?.[1];
  assert.match(notice({}), /^<span class="config-notice-text">已从 ~\/\.pi\/agent\/mcp\.json 移除 lint。<\/span><button type="button" class="config-button config-button-secondary config-button-small">撤销<\/button>$/);
  assert.match(notice({ undoing: true }), /<button type="button" disabled="" [^>]*>正在撤销…<\/button>/);
  // A name added again since keeps Undo for when it is gone; an undo that is no longer possible drops it.
  assert.match(notice({ error: { error: "x", reason: "undo-name-taken", name: "lint" } }),
    /已从 ~\/\.pi\/agent\/mcp\.json 移除 lint。 无法撤销： 该文件又定义了同名的服务器，因此没有撤销这次移除。<\/span><button[^>]*>撤销</);
  const gone = notice({ error: { error: "x", reason: "undo-unavailable" } });
  assert.match(gone, /无法撤销： 这次移除已无法撤销。$/);
  assert.doesNotMatch(gone, /<button/);
});

/** The opening tag of a group's switch, found by the n/m count in front of it. */
function groupSwitch(html, count) {
  return decode(html).match(new RegExp(`<span class="config-sidebar-group-count">${count.replace("/", "\\/")}</span>(<button[^>]*>)`))?.[1];
}

test("a group holding a server the switch never turns on can still be switched off from its heading", () => {
  // docs is on and pw, the only server off, references PI_WEB_PASSWORD: the switch reads on and
  // offers to turn the group off. Reading "every row on" kept it off for good, and each click
  // asked to turn on again and sent nothing.
  assert.match(groupSwitch(writeView(), "1/2"), /aria-checked="true" aria-label="关闭 全局 中的所有服务器"/);
  // The count still says what the file says.
  const pwOff = server({ name: "pw", transport: "http", url: "https://pw/mcp", enabled: false, webPasswordField: { kind: "header", name: "Authorization" } });
  assert.match(
    groupSwitch(writeView({ data: { servers: [server({ name: "docs", enabled: false, transport: "http", url: "https://docs/mcp" }), pwOff] } }), "0/2"),
    /aria-checked="false" aria-label="开启 全局 中的所有服务器"/,
  );
  // The shared switch's click asks for the opposite of what it shows.
  const asked = [];
  const heading = ConfigSidebarGroupSwitch({ enabled: 1, total: 2, checked: true, label: "x", onChange: (next) => asked.push(next) });
  const toggle = heading.props.children[1];
  assert.equal(toggle.props.checked, true);
  toggle.type(toggle.props).props.onClick();
  assert.deepEqual(asked, [false]);
  // Without `checked` it keeps the Skills and Plugins rule.
  assert.equal(ConfigSidebarGroupSwitch({ enabled: 1, total: 2, label: "x", onChange() {} }).props.children[1].props.checked, false);
});

test("an entry that is not an object can be removed but not switched, and says so", () => {
  const junk = server({ name: "junk", notAnObject: true, invalidError: 'server "junk" must be an object' });
  const html = writeView({ data: { servers: [junk, server({ name: "docs", transport: "http", url: "https://docs/mcp" })] }, view: { selected: "global\0junk" } });
  const controls = detailControls(html);
  assert.equal(controls.note, "此条目不是对象，因此无法开启或关闭。请将其移除，或在文件中修正。");
  assert.match(controls.toggle, new RegExp(`aria-describedby="${controls.noteId}"[^>]*disabled=""`));
  assert.doesNotMatch(controls.remove[0], /disabled/);
  // It reads as on in the count, but does not hold the group switch off.
  assert.match(groupSwitch(html, "2/2"), /aria-checked="true"/);
});

test("a 代码模式 save and a server change never overlap", () => {
  // While the Code mode choice saves, no server control starts a change whose answer would carry
  // the choice as read before the save.
  const saving = writeView({ view: { codemodeSave: { saving: true, error: null } } });
  const controls = detailControls(saving);
  assert.match(controls.toggle, /disabled=""/);
  assert.match(controls.remove[0], /disabled=""/);
  assert.match(groupSwitch(saving, "1/2"), /disabled=""/);
  assert.match(decode(saving), /<button type="button" disabled="" class="config-button config-button-secondary config-button-default">刷新<\/button>/);
  // While a server change runs, neither Code mode option can be chosen.
  const info = { sandbox: { state: "available" }, builtinDisabled: false, preference: "automatic" };
  assert.deepEqual(codemodeOptions(codemodeView(info, { view: { busy: "switch:global\0docs" } })).map(({ disabled }) => disabled), [true, true]);
  assert.deepEqual(codemodeOptions(codemodeView(info)).map(({ disabled }) => disabled), [false, false]);
});

test("under -builtin:mcp a change is saved, and the note says no session connects it", () => {
  const builtin = detailControls(writeView({ data: { mcp: { available: false, reason: "builtin-disabled", error: "x", settingsPath: "/s.json" } } }));
  assert.equal(builtin.note, "更改会保存到文件中，但在 builtin:mcp 关闭期间，没有会话会连接这些服务器。");
  assert.doesNotMatch(builtin.toggle, /disabled/);
  // MCP on: no note.
  assert.equal(detailControls(writeView()).note, undefined);
});

// ---------------------------------------------------------------------------
// Test connection
// ---------------------------------------------------------------------------

/**
 * The Status row: its state label, the lines under it (what a test or a
 * session saw, why Test cannot be used) as `value` and `text`, and the Test
 * button, which sits in the detail header beside Remove.
 */
function statusRow(html) {
  const markup = decode(html);
  const row = markup.match(/<div class="config-detail-grid-label">状态<\/div><div class="config-detail-grid-value">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(row, "the detail pane has a 状态 row");
  const head = row.match(/^<span class="mcp-config-lines"><span class="mcp-config-state is-[a-z]+">([^<]*)<\/span>/);
  assert.ok(head, "the 状态 row starts with the state label");
  const value = row.slice(head[0].length);
  const actions = markup.match(/<div class="config-detail-actions">([\s\S]*?)<\/div><\/div>/)?.[1] ?? "";
  const button = actions.match(/<button([^>]*)>(测试连接|正在测试…)<\/button>/);
  assert.ok(button, "the detail header holds 测试");
  return { label: head[1], value, text: text(value), button: { attributes: button[1], label: button[2] } };
}

/** The span with this id, nested spans and all. */
function spanById(markup, id) {
  const start = markup.indexOf(`<span id="${id}"`);
  assert.ok(start >= 0, `a span with id ${id}`);
  let depth = 0;
  for (const match of markup.slice(start).matchAll(/<span\b|<\/span>/g)) {
    depth += match[0] === "</span>" ? -1 : 1;
    if (depth === 0) return markup.slice(start, start + match.index + match[0].length);
  }
  assert.fail(`the span with id ${id} is never closed`);
}

// The Status row shows a time alone only when it falls on the day the row
// renders (a date otherwise), so the clock stands still at 18:00 for the rest of
// the file: a run that crossed midnight would otherwise print a date. Only Date
// is mocked; timers run as usual.
mock.timers.enable({ apis: ["Date"], now: new Date(2026, 9, 2, 18, 0).getTime() });

/** Today at 10:42, local time: the Status row then shows the time alone (a date only when it is not today). */
const TODAY_10_42 = new Date(Date.now()).setHours(10, 42, 0, 0);

function testedStatus(state, extra = {}) {
  return { origin: "test", state, tools: [], toolCount: 0, durationMs: 420, testedAt: TODAY_10_42, ...extra };
}

function testView(serverOverrides = {}, props = {}) {
  const tested = server({ name: "docs", transport: "http", url: "https://docs/mcp", exposure: "codemode", ...serverOverrides });
  return view({
    load: { state: "loaded", data: overview({ servers: [tested], ...(props.data ?? {}) }) },
    selected: mcpServerKey(tested),
    ...props.view,
  });
}

const { mcpServerKey } = await jiti.import("./mcp-config-helpers.ts");

test("an untested server offers 测试 in its header, beside 移除", () => {
  const html = testView();
  const { text: shown, button } = statusRow(html);
  assert.equal(button.label, "测试连接");
  assert.doesNotMatch(button.attributes, /disabled|aria-describedby/);
  assert.match(decode(html), /<div class="config-detail-actions"><button type="button" class="config-button config-button-secondary config-button-small">测试连接<\/button><button[^>]*class="config-button config-button-danger/);
  assert.equal(shown, "尚未测试。");
  assert.equal(statusRow(html).label, "已开启");
  // A server that runs a shell command on every connection is labelled: its tests run one at a time.
  const serial = statusRow(testView({ transport: "stdio", url: undefined, command: "node", commandFields: [{ kind: "env", name: "TOKEN" }] }));
  assert.equal(serial.text, "尚未测试。 它会执行 shell 命令，因此测试要等其他此类测试结束。");
  // An HTTP server's header command is such a command too.
  const header = statusRow(testView({ commandFields: [{ kind: "header", name: "Authorization" }] }));
  assert.match(header.text, /它会执行 shell 命令，因此测试要等其他此类测试结束。/);
  // No listed tools before a test connected.
  assert.doesNotMatch(decode(testView()), /mcp-test-tools/);
});

test("a connected test shows what it listed, and the row reads connected", () => {
  const status = testedStatus("connected", {
    toolCount: 3,
    tools: [
      { name: "search", description: "Search the docs.", readOnly: true, exposure: "codemode" },
      { name: "publish", readOnly: false, exposure: "direct" },
      { name: "bidi‮tool", readOnly: false, exposure: "codemode" },
    ],
    serverInfo: { name: "docs-server", version: "2.1.0" },
    resources: true,
  });
  const html = testView({ status });
  const markup = decode(html);
  // The dot and the accessible name follow the test; connected needs no badge, as on needs none.
  assert.match(row(html, "docs"), /aria-label="docs：测试时已连接"/);
  assert.match(markup, /<button type="button" aria-label="docs：测试时已连接"[^>]*><span aria-hidden="true" class="config-status-dot is-active"><\/span><span class="config-sidebar-text is-grow">docs<\/span><\/button>/);
  const { label, value, text: shown } = statusRow(html);
  // The state is said once: what the test found follows it without its own "Connected".
  assert.equal(label, "测试时已连接");
  assert.match(value, /^<span class="mcp-config-line">列出了 3 个工具，用时 0\.4 秒，测试于 [^.]+。<\/span>/);
  assert.match(shown, /服务器：docs-server 2\.1\.0/);
  assert.match(shown, /提供资源。/);
  assert.doesNotMatch(shown, /Ran in/, "an HTTP server runs in no folder");
  assert.match(text(markup), /状态 测试时已连接 列出了 3 个工具，用时/);
  // A server that offers no resources does not say so.
  assert.doesNotMatch(statusRow(testView({ status: { ...status, resources: undefined } })).text, /resource/);
  // The tools it listed go under the Tools row's choice, in the same row.
  const tools = markup.match(/<div class="config-detail-grid-label">工具<\/div><div class="config-detail-grid-value">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(tools, "a 工具 row");
  assert.match(tools, /<select[\s\S]*<\/select>[\s\S]*<ul class="mcp-test-tools">/);
  assert.match(tools, /<li class="mcp-test-tool"><span class="mcp-config-chips"><code class="mcp-config-chip">search<\/code><span class="mcp-test-tool-tag">只读<\/span><\/span><span class="mcp-config-line is-dim">Search the docs.<\/span><\/li>/);
  // A tool whose exposure differs from its server's says so; one like its server's does not.
  assert.match(tools, /<code class="mcp-config-chip">publish<\/code><span class="mcp-test-tool-tag">直接声明<\/span>/);
  assert.doesNotMatch(tools, /<span class="mcp-test-tool-tag">代码模式<\/span>/);
  // A tool name is the server's text: hidden characters are shown as codes.
  assert.match(tools, /bidi\\u\{202E\}tool/);
  // More tools than listed say how many are not shown.
  assert.match(text(decode(testView({ status: { ...status, toolCount: 10 } }))), /另有 7 个未显示。/);
});

test("a stdio server's test names the folder it ran in", () => {
  const html = testView({ transport: "stdio", url: undefined, command: "node", status: testedStatus("connected", { cwd: "/srv/repo" }) });
  assert.match(statusRow(html).text, /运行于 \/srv\/repo。/);
  // Not when the Working directory row names that very folder; a relative one still gets the folder it resolved to.
  const own = testView({ transport: "stdio", url: undefined, command: "node", cwd: "/srv/repo", status: testedStatus("connected", { cwd: "/srv/repo" }) });
  assert.doesNotMatch(statusRow(own).text, /Ran in/);
  assert.match(text(decode(own)), /工作目录 \/srv\/repo/);
  const relative = testView({ transport: "stdio", url: undefined, command: "node", cwd: "repo", status: testedStatus("connected", { cwd: "/srv/repo" }) });
  assert.match(statusRow(relative).text, /运行于 \/srv\/repo。/);
});

test("a failed test shows the error and stderr, a sign-in, and no answer, each with visible text", () => {
  const failed = testView({ status: testedStatus("failed", { error: "spawn lint-mcp ENOENT", stderr: "line one\nline\u0007two", durationMs: 1_250 }) });
  assert.match(row(failed, "docs"), /aria-label="docs：测试时未能连接"/);
  assert.match(decode(failed), /<span class="mcp-sidebar-badge is-error">失败<\/span>/);
  const { label, value } = statusRow(failed);
  assert.equal(label, "测试时未能连接");
  assert.match(value, /^<span class="mcp-config-line">1\.3 秒后放弃，测试于/);
  assert.match(value, /<span class="mcp-config-line is-error">错误： <code class="mcp-config-chip">spawn lint-mcp ENOENT<\/code><\/span>/);
  // The stderr tail keeps its lines, and its control characters are shown as codes.
  assert.match(value, /<span class="mcp-config-line is-dim">它最后写入 stderr 的内容：<\/span><pre class="mcp-test-output">line one\nline\\u\{0007\}two<\/pre>/);

  const signIn = testView({ status: testedStatus("needs-auth") });
  assert.match(row(signIn, "docs"), /aria-label="docs：需要登录"/);
  assert.match(decode(signIn), /<span class="mcp-sidebar-badge is-warning">需登录<\/span>/);
  assert.match(statusRow(signIn).value, /^<span class="mcp-config-line">服务器要求 OAuth 登录。测试于/);
  // The panel's own Sign in, not a chat command, is where to sign in.
  assert.match(text(decode(signIn)), /状态 需要登录 服务器要求 OAuth 登录。/);
  assert.doesNotMatch(text(decode(signIn)), /for example with \/mcp/);

  const silent = statusRow(testView({ status: testedStatus("failed", { timedOut: true, durationMs: 20_000 }) }));
  assert.equal(silent.label, "测试时未能连接");
  assert.match(silent.value, /^<span class="mcp-config-line">它在 20\.0 秒内没有响应，因此 Pi Web 已停止测试。测试于/);

  // A test of a switched-off server is shown in its pane, but the row says what the file says.
  const off = testView({ enabled: false, status: testedStatus("connected") });
  assert.match(row(off, "docs"), /aria-label="docs：已在文件中关闭"/);
  // Its label says it is off, with no sentence repeating it; the test it had keeps its own word.
  assert.equal(statusRow(off).label, "已在文件中关闭");
  assert.match(statusRow(off).text, /^已连接 列出了 0 个工具/);
  assert.doesNotMatch(statusRow(off).text, /does not connect/);
});

test("测试 is disabled where the route would refuse it, and points at the visible reason", () => {
  const reason = (html) => {
    const { value, button } = statusRow(html);
    assert.match(button.attributes, /disabled=""/);
    const id = button.attributes.match(/aria-describedby="([^"]+)"/)?.[1];
    assert.ok(id, "the disabled button points at its reason");
    assert.equal(value.split(`id="${id}"`).length, 2, "exactly one line of the 状态 row has the id");
    return text(spanById(value, id));
  };
  const untrusted = { cwd: "/Users/me/repo", trust: { requiresTrust: true, trusted: false, decision: null, inherited: false } };
  const projectServer = { scope: "project", sourcePath: "/Users/me/repo/.pi/mcp.json", transport: "stdio", url: undefined, command: "node" };
  // A reason the notice above the list already says: Test points at that notice, and the Status row stays quiet.
  const saidAbove = (html, start) => {
    const { value, button } = statusRow(html);
    assert.match(button.attributes, /disabled=""/);
    assert.match(button.attributes, new RegExp(`aria-describedby="${noticeIdOf(html, start)}"`));
    assert.doesNotMatch(text(value), /does not start|tests no server/);
  };
  saidAbove(testView(projectServer, { data: { files: [globalFile, projectFile], project: untrusted }, view: { cwd: "/Users/me/repo" } }), "此项目未受信任");
  saidAbove(testView({}, { data: { mcp: { available: false, reason: "operator-disabled", error: "x" } } }), "MCP 已关闭");
  // A refused entry's own line says why, so Test points at it rather than a second line saying it again.
  const invalid = testView({ invalidError: "legacy SSE" });
  assert.equal(reason(invalid), "Pi 拒绝加载此条目，它不会连接： legacy SSE");
  assert.doesNotMatch(text(decode(invalid)), /nothing to test/);
  const password = testView({ webPasswordField: { kind: "header", name: "Authorization" } });
  assert.match(reason(password), /^引用了 PI_WEB_PASSWORD。Pi Web 会拒绝连接它，.*请求头 Authorization$/);
  assert.doesNotMatch(text(decode(password)), /so Pi Web does not connect it/);
  // -builtin:mcp leaves it as an explicit action.
  const builtin = statusRow(testView({}, { data: { mcp: { available: false, reason: "builtin-disabled", error: "x", settingsPath: "/s.json" } } }));
  assert.doesNotMatch(builtin.button.attributes, /disabled/);
});

test("while a test runs its button says so, and every other control keeps working", () => {
  const key = "global\0docs";
  const html = testView({}, { view: { tests: { [key]: { running: true } } } });
  const { button } = statusRow(html);
  assert.equal(button.label, "正在测试…");
  assert.match(button.attributes, /disabled="" aria-busy="true"/);
  // A test writes no file: the switch, Remove and Refresh do not wait for it.
  const controls = detailControls(html);
  assert.doesNotMatch(controls.toggle, /disabled/);
  assert.doesNotMatch(controls.remove[0], /disabled/);
  assert.match(decode(html), /<button type="button" class="config-button config-button-secondary config-button-default">刷新<\/button>/);
  // ...and a change on its way does not hold Test either.
  assert.doesNotMatch(statusRow(testView({}, { view: { busy: "switch:global\0docs" } })).button.attributes, /disabled/);
});

test("a test request that failed says why in a test's words, and keeps the last result", () => {
  const key = "global\0docs";
  const failure = (error, extra = {}) => statusRow(testView({ status: testedStatus("connected") }, { view: { tests: { [key]: { running: false, error, ...extra } } } }));
  const refused = failure({ error: "x", reason: "project-untrusted" });
  assert.match(refused.value, /<span role="alert" class="mcp-config-line is-error">无法测试该服务器： 此项目未受信任，因此 Pi Web 不会启动它的服务器。<\/span>/);
  assert.equal(refused.label, "测试时已连接", "the last result stays");
  assert.match(refused.text, /^列出了 0 个工具/);
  assert.match(failure({ error: "x", reason: "server-missing" }).text, /无法测试该服务器： 该文件已不再定义此服务器。/);
  assert.match(failure({ error: "EIO: i/o error", reason: "internal" }).text, /无法测试该服务器： EIO: i\/o error/);
  assert.match(failure({ error: "late", timedOut: true }).text, /无法测试该服务器： Pi Web 没有及时响应。测试可能仍会完成，按“刷新”查看结果。/);
  // A file problem reads as a test's, not as the writer's "left it unchanged".
  assert.match(failure({ error: "x", reason: "unparsable" }).text, /无法测试该服务器： 该文件不是有效的 JSON，Pi Web 无法读取此条目进行测试。/);
  assert.match(failure({ error: "x", reason: "entry-not-object" }).text, /无法测试该服务器： 此条目不是对象，因此没有可测试的内容。请在文件中修正。/);
  // A failure about the entry before it was edited is not shown for the edited one.
  assert.doesNotMatch(failure({ error: "x", reason: "server-invalid" }, { configKey: "old-key" }).text, /Could not test/);
  assert.match(failure({ error: "x", reason: "server-invalid" }, { configKey: "key" }).text, /无法测试该服务器： Pi 拒绝此条目/);
  const queued = statusRow(testView({}, { view: { tests: { [key]: { running: false, queueTimedOut: true, configKey: "key" } } } }));
  assert.match(queued.value, /<span role="alert" class="mcp-config-line is-error">另一个会执行 shell 命令的服务器的测试没有及时完成，因此此测试没有开始。请重试。<\/span>/);
  assert.doesNotMatch(statusRow(testView({}, { view: { tests: { [key]: { running: false, queueTimedOut: true, configKey: "old-key" } } } })).text, /did not start/);
});

test("the panel's own answer shows over the listing while it is about the entry shown", () => {
  const key = "global\0docs";
  const response = (configKey) => ({ scope: "global", name: "docs", configKey, result: { state: "failed", error: "boom", tools: [], toolCount: 0, durationMs: 10, testedAt: 5 } });
  const shown = testView({}, { view: { tests: { [key]: { running: false, response: response("key") } } } });
  assert.match(row(shown, "docs"), /aria-label="docs：测试时未能连接"/);
  assert.equal(statusRow(shown).label, "测试时未能连接");
  assert.match(statusRow(shown).text, /^0\.0 秒后放弃.* 错误： boom/);
  // An answer about the entry before it was edited is not this entry's.
  const stale = testView({}, { view: { tests: { [key]: { running: false, response: response("old-key") } } } });
  assert.match(statusRow(stale).text, /^尚未测试。/);
});

// ---------------------------------------------------------------------------
// What open sessions report
// ---------------------------------------------------------------------------

function sessionStatus(state, extra = {}) {
  return { origin: "session", state, sessionId: "s1", cwd: "/Users/me/repo", updatedAt: TODAY_10_42, ...extra };
}

test("a session's report names the state in the row and says which session saw it, and when", () => {
  const connected = testView({ status: sessionStatus("connected") });
  assert.match(row(connected, "docs"), /aria-label="docs：已在会话中连接"/);
  const { value, button } = statusRow(connected);
  // The session's folder, shortened as every path in the panel is.
  assert.match(value, /^<span class="mcp-config-line">~\/repo 中的一个会话于 [^.]+ 连接了它。<\/span>/);
  assert.match(text(decode(connected)), /状态 已在会话中连接 ~\/repo 中的一个会话于 .* 连接了它/);
  // A session lists no tools for the panel; only a test does.
  assert.doesNotMatch(decode(connected), /mcp-test-tools/);
  assert.equal(button.label, "测试连接", "测试 stays offered beside a session's report");

  const failed = testView({ transport: "stdio", url: undefined, command: "node", status: sessionStatus("failed", { error: "spawn lint ENOENT", stderr: "no\nconfig" }) });
  assert.match(row(failed, "docs"), /aria-label="docs：未能在会话中连接"/);
  assert.match(decode(failed), /<span class="mcp-sidebar-badge is-error">失败<\/span>/);
  const failedRow = statusRow(failed).value;
  assert.match(failedRow, /^<span class="mcp-config-line">~\/repo 中的一个会话于 .* 未能连接它/);
  assert.match(failedRow, /<span class="mcp-config-line is-error">错误： <code class="mcp-config-chip">spawn lint ENOENT<\/code><\/span>/);
  assert.match(failedRow, /<pre class="mcp-test-output">no\nconfig<\/pre>/);
  assert.match(text(decode(failed)), /状态 未能在会话中连接 ~\/repo 中的一个会话于 .* 未能连接它/);

  const signIn = testView({ status: sessionStatus("needs-auth") });
  assert.match(row(signIn, "docs"), /aria-label="docs：需要登录"/);
  assert.match(decode(signIn), /<span class="mcp-sidebar-badge is-warning">需登录<\/span>/);
  assert.match(statusRow(signIn).text, /^服务器于 .* 要求 ~\/repo 中的一个会话进行 OAuth 登录。/);
  assert.match(text(decode(signIn)), /状态 需要登录 服务器于 .* 要求 ~\/repo 中的一个会话进行 OAuth 登录。/);
});

test("a connection the session closed since reads like an untested entry, and says when it closed, with the date when not today", () => {
  const time = (ms) => new Date(ms).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const closedAt = TODAY_10_42 + 10 * 60_000;
  const closed = testView({ status: sessionStatus("connected", { closedAt }) });
  // No green "connected" for a connection nobody holds: the row reads on, as an untested entry does.
  assert.match(row(closed, "docs"), /aria-label="docs：已开启"/);
  const { label, value } = statusRow(closed);
  assert.equal(label, "已开启");
  // The sentence says it closed; no state word of its own repeats it.
  assert.equal(
    value.match(/^<span class="mcp-config-line">([^<]*)<\/span>/)?.[1],
    `~/repo 中的会话 ${time(TODAY_10_42)} 连接，${time(closedAt)} 关闭。`,
  );

  // A report from another day says which day.
  const yesterday = TODAY_10_42 - 24 * 60 * 60_000;
  const old = statusRow(testView({ status: sessionStatus("failed", { updatedAt: yesterday }) })).text;
  assert.ok(old.includes(`~\/repo 中的一个会话于 ${new Date(yesterday).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" })} 未能连接它。`), old);
});

test("connecting, a dropped connection and a name another extension holds each have visible words", () => {
  const connecting = testView({ status: sessionStatus("connecting") });
  assert.match(row(connecting, "docs"), /aria-label="docs：正在会话中连接"/);
  assert.match(decode(connecting), /<span class="mcp-sidebar-badge is-off">连接中<\/span>/);
  assert.match(statusRow(connecting).text, /^~\/repo 中的一个会话于 .* 开始连接它/);

  const dropped = testView({ transport: "stdio", url: undefined, command: "node", status: sessionStatus("disconnected", { stderr: "panic: out of memory" }) });
  assert.match(row(dropped, "docs"), /aria-label="docs：会话中的连接已断开"/);
  assert.match(decode(dropped), /<span class="mcp-sidebar-badge is-warning">已断开<\/span>/);
  assert.match(statusRow(dropped).value, /^<span class="mcp-config-line">~\/repo 中一个会话的连接于 [^.]+ 断开。<\/span>/);
  assert.match(statusRow(dropped).value, /<pre class="mcp-test-output">panic: out of memory<\/pre>/);
  // What happens next follows what the session saw, which it does not repeat.
  assert.match(statusRow(dropped).text, /panic: out of memory 该会话会在下次调用它的工具时重新连接。$/);

  const taken = testView({ status: sessionStatus("conflict", { conflict: "/Users/me/.pi/agent/extensions/jira.ts" }) });
  assert.match(row(taken, "docs"), /aria-label="docs：名称已被其他扩展占用"/);
  assert.match(decode(taken), /<span class="mcp-sidebar-badge is-error">冲突<\/span>/);
  const takenRow = statusRow(taken).value;
  assert.match(takenRow, /^<span class="mcp-config-line">~\/repo 中的一个会话于 [^,]+ 发现该名称已被占用，因此没有连接此条目。<\/span>/);
  // The owner is named, the home folder shortened as everywhere in the panel.
  assert.match(takenRow, /<span class="mcp-config-line is-error">先注册该名称的扩展： <code class="mcp-config-chip">~\/\.pi\/agent\/extensions\/jira\.ts<\/code><\/span>/);
  assert.match(statusRow(taken).text, /jira\.ts 请在文件中重命名此条目，或关闭那个扩展。$/);
});

test("a session that found the project untrusted is said in the 状态 row, whatever the listing says now", () => {
  const data = overview({
    files: [globalFile, projectFile],
    project: { cwd: "/Users/me/repo", trust: untrusted },
    servers: [server({ name: "repo", scope: "project", sourcePath: projectFile.path, transport: "stdio", command: "node", status: sessionStatus("not-trusted") })],
  });
  const select = { selected: "project\0repo", cwd: "/Users/me/repo" };
  const still = view({ load: { state: "loaded", data }, ...select });
  assert.match(row(still, "repo"), /aria-label="repo：项目未受信任"/);
  // The state comes from the files, not the report, so the report keeps its own word.
  assert.match(statusRow(still).value, /^<span class="mcp-config-line"><span class="mcp-config-state is-warning">未读取<\/span> ~\/repo 中的一个会话于 [^,]+ 没有读取它，因为当时没有任何决定信任该项目。/);
  assert.doesNotMatch(statusRow(still).text, /does not connect/, "the label says the project is not trusted");
  // Trusted since: the row reads on, since sessions read the file at their next message.
  const since = view({ load: { state: "loaded", data: { ...data, project: { cwd: "/Users/me/repo", trust: trusted } } }, ...select });
  assert.match(row(since, "repo"), /aria-label="repo：已开启"/);
  assert.match(statusRow(since).text, /^~\/repo 中的一个会话于 .* 没有读取它/);
});

test("a session whose /mcp is another extension's is said above the list, unless MCP 已关闭 anyway", () => {
  const hostInactive = { owner: "/Users/me/repo/.pi/extensions/mcp.ts", cwd: "/Users/me/repo", updatedAt: 1 };
  const shown = text(decode(view({ load: { state: "loaded", data: overview({ servers: [httpServer], hostInactive }) } })));
  assert.match(shown, /~\/repo 中的一个会话不会通过 Pi Web 连接这些服务器：它的 \/mcp 命令来自 ~\/repo\/\.pi\/extensions\/mcp\.ts，而不是 Pi 内置的 MCP 扩展。那个扩展可能会读取 mcp\.json，并以自己的方式连接它们。/);
  const off = text(decode(view({
    load: { state: "loaded", data: overview({ servers: [httpServer], hostInactive, mcp: { available: false, reason: "operator-disabled", error: "x" } }) },
  })));
  assert.doesNotMatch(off, /connects none of these servers/);
});

// ---------------------------------------------------------------------------
// Signing in to an OAuth server
// ---------------------------------------------------------------------------

/** The Sign-in row's value. */
function signInRow(html) {
  const markup = decode(html);
  const start = markup.indexOf("<div class=\"config-detail-grid-label\">登录</div>");
  assert.ok(start >= 0, "the detail pane has a 登录 row");
  const value = markup.slice(start, markup.indexOf('<div class="config-detail-grid-label">', start + 1));
  return { value, text: text(value) };
}

test("an OAuth server's pane signs in from its 登录 row, under the 状态 row that asks for it", () => {
  const html = testView({ usesOAuth: true, signedIn: false, status: testedStatus("needs-auth") });
  assert.match(text(decode(html)), /状态 需要登录 服务器要求 OAuth 登录。/);
  const { value, text: shown } = signInRow(html);
  assert.match(value, /<button type="button" class="config-button config-button-primary config-button-small">登录<\/button>/);
  assert.match(shown, /未登录。/);

  // The panel's sign-in for the selected server is the one the row shows.
  const key = mcpServerKey({ scope: "global", name: "docs" });
  const flow = { flowId: "f1", scope: "global", name: "docs", configKey: "key", phase: "authorize", expiresInMs: 100_000, authorizationUrl: "https://auth.example/authorize?state=s" };
  const waiting = signInRow(testView({ usesOAuth: true, signedIn: false }, { view: { signIns: { [key]: { flow } } } }));
  assert.match(waiting.value, /<a href="https:\/\/auth\.example\/authorize\?state=s" target="_blank" rel="noopener noreferrer">/);
  assert.match(waiting.value, /class="oauth-paste-input"/);

  // A project nobody trusted: no sign-in, and Sign in points at the trust notice above the list, which says why.
  const blockedHtml = view({
    cwd: "/Users/me/repo",
    load: { state: "loaded", data: overview({
      files: [globalFile, projectFile],
      servers: [server({ name: "docs", scope: "project", sourcePath: projectFile.path, transport: "http", url: "https://docs/mcp", usesOAuth: true, signedIn: false })],
      project: { cwd: "/Users/me/repo", trust: untrusted },
    }) },
    selected: mcpServerKey({ scope: "project", name: "docs" }),
  });
  const blocked = signInRow(blockedHtml);
  const id = blocked.value.match(/<button type="button" disabled="" aria-describedby="([^"]+)" class="config-button config-button-primary config-button-small">登录<\/button>/)?.[1];
  assert.equal(id, noticeIdOf(blockedHtml, "此项目未受信任"), "登录 is disabled and points at the reason");
  assert.doesNotMatch(blocked.text, /does not sign in/);
});

test("the connection a sign-in made is summed up as a sign-in's in the 状态 row", () => {
  const status = testedStatus("connected", { toolCount: 2, afterSignIn: true, tools: [{ name: "whoami", readOnly: true, exposure: "codemode" }] });
  const { value } = statusRow(testView({ usesOAuth: true, signedIn: true, status }));
  assert.match(value, /^<span class="mcp-config-line">已登录，随后列出了 2 个工具，用时 0\.4 秒，时间 [^.]+。<\/span>/);
  const after = statusRow(testView({ usesOAuth: true, signedIn: true, status: testedStatus("needs-auth", { afterSignIn: true }) }));
  assert.equal(after.label, "需要登录");
  assert.match(after.text, /^已登录，但服务器在 /);
});

test("a project override is listed as the global server it changes, which offers a switch for the project alone", () => {
  const cwd = "/Users/me/repo";
  const project = { cwd, trust: trusted };
  const lint = server({ ...stdioServer, exposure: "codemode" });
  const pressed = [];
  const shown = (servers, selected) => view({
    cwd,
    selected,
    load: { state: "loaded", data: overview({ files: [globalFile, projectFile], project, servers }) },
    onServerSwitchInProject: (target, enabled) => pressed.push([target.name, enabled]),
  });

  // No project entry of the name: a switch for the project alone, with one short line under it.
  const follows = text(shown([lint], "global\0lint"));
  assert.match(follows, /此项目 在此项目中关闭 只对此项目生效，保存在项目的 \.pi\/mcp\.json。 文件/);
  assert.match(text(shown([{ ...lint, enabled: false }], "global\0lint")), /在此项目中开启/);

  // Overridden: the global row reads as changed here, and links to the override.
  const override = server({
    ...lint,
    scope: "project",
    sourcePath: projectFile.path,
    enabled: false,
    override: { keys: ["enabled"] },
  });
  const globalRow = shown([{ ...lint, overriddenByProject: true }, override], "global\0lint");
  // Both groups list a lint: the project's first, turned off by its override, then the global one it changes.
  assert.deepEqual(
    [...decode(globalRow).matchAll(/aria-label="(lint：[^"]*)"/g)].map((match) => match[1]),
    ["lint：已在文件中关闭", "lint：已被项目的覆盖设置更改"],
  );
  assert.match(text(globalRow), /此项目的 \.pi\/mcp\.json 改了它的 enabled。 查看/);
  assert.doesNotMatch(text(globalRow), /在此项目中关闭/);

  // The override's own row: the global server's command, its own file, and what it changes.
  const overrideRow = text(shown([{ ...lint, overriddenByProject: true }, override], "project\0lint"));
  assert.match(overrideRow, /命令 npx -y @acme\/lint-mcp/);
  assert.match(overrideRow, /此项目受信任时，只更改你的同名全局服务器的 enabled。/);
  assert.match(overrideRow, /文件 ~?\/?.*repo\/\.pi\/mcp\.json/);
  assert.doesNotMatch(overrideRow, /此项目的 \.pi\/mcp\.json/);
  // Untrusted, the global row has no switch for the project.
  const untrustedRow = text(view({
    cwd,
    selected: "global\0lint",
    load: { state: "loaded", data: overview({ files: [globalFile, projectFile], project: { cwd, trust: untrusted }, servers: [lint] }) },
  }));
  assert.doesNotMatch(untrustedRow, /在此项目中关闭/);
});
