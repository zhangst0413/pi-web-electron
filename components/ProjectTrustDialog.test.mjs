import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { zhCNLocale } = await jiti.import("@/lib/i18n/messages/zh-CN.ts");
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { ProjectTrustDialog, ProjectTrustDialogView } = await jiti.import("./ProjectTrustDialog.tsx");
const source = await readFile(new URL("./ProjectTrustDialog.tsx", import.meta.url), "utf8");
const settingsCss = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");

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

const untrusted = { requiresTrust: true, trusted: false, decision: null, inherited: false };

function view(props) {
  return render(h(ProjectTrustDialogView, {
    cwd: "/repo",
    busy: false,
    error: null,
    read: { state: "loaded", status: untrusted },
    onCancel() {},
    onConfirm() {},
    ...props,
  }));
}

test("while the status loads it says so, and Trust waits for it", () => {
  const html = render(h(ProjectTrustDialog, { cwd: "/repo", busy: false, error: null, onCancel() {}, onConfirm() {} }));
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="project-trust-title" aria-describedby="project-trust-description" tabindex="-1" class="project-trust-dialog"/);
  assert.match(html, /<p id="project-trust-status" role="status" class="project-trust-mcp-status">正在读取项目的信任状态…<\/p>/);
  assert.match(html, /<button type="button" class="project-trust-button is-primary" disabled="" aria-describedby="project-trust-status">信任项目<\/button>/);
  assert.match(html, /<button type="button" class="project-trust-button">取消<\/button>/);
  assert.match(html, /<code class="project-trust-path">\/repo<\/code>/);
  // Padding and layout live in CSS, so the safe-area rules and the scrolling body apply.
  assert.doesNotMatch(html, /style="/);
});

test("the trust error stays outside the scrolling body, translated from its reason", () => {
  const busy = render(h(ProjectTrustDialog, {
    cwd: "/repo",
    busy: true,
    error: { error: "Wait for the active session to finish before trusting this project", reason: "session-busy" },
    onCancel() {},
    onConfirm() {},
  }));
  assert.match(
    busy,
    /<\/div><\/div><div role="alert" class="project-trust-error">请等活动会话结束后再信任此项目。<\/div><div class="project-trust-footer">/,
  );
  assert.match(busy, /disabled="" aria-busy="true" aria-describedby="project-trust-status">正在信任\.\.\.<\/button>/);

  // An internal or network failure has nothing to translate: its diagnostic follows a generic line.
  const internal = view({ error: { error: "Lock file is already being held", reason: "internal" } });
  assert.match(internal, /<div role="alert" class="project-trust-error">无法信任此项目。<code class="project-trust-error-detail">Lock file is already being held<\/code><\/div>/);
  const network = view({ error: { error: "失败 to fetch" } });
  assert.match(network, /无法信任此项目。<code class="project-trust-error-detail">失败 to fetch<\/code>/);
});

test("a folder trusted meanwhile, or no longer needing trust, is not offered Trust", () => {
  const trusted = view({ read: { state: "loaded", status: { ...untrusted, trusted: true, decision: true, decisionPath: "/", inherited: true } } });
  assert.match(trusted, /<p id="project-trust-notice" role="status" class="project-trust-notice">此项目已受信任。<\/p>/);
  assert.doesNotMatch(trusted, /信任项目/);
  assert.match(trusted, /<button type="button" class="project-trust-button">关闭<\/button>/);

  const fresh = view({ read: { state: "loaded", status: { requiresTrust: false, trusted: true, decision: null, inherited: false } } });
  assert.match(fresh, /此项目已受信任。/);
  assert.doesNotMatch(fresh, /信任项目/);

  const open = view({});
  assert.match(open, /<button type="button" class="project-trust-button is-primary">信任项目<\/button>/);
  assert.doesNotMatch(open, /project-trust-notice/);
});

test("a trust store that cannot be read is said so, and Trust stays offered", () => {
  const html = view({ read: { state: "loaded", statusError: "Lock file is already being held" } });
  assert.match(
    text(html),
    /无法读取项目的信任状态。 Lock file is already being held/,
  );
  assert.match(html, /class="project-trust-button is-primary">信任项目<\/button>/);
});

test("a status that failed names why, or gives its diagnostic", () => {
  assert.match(
    text(view({ read: { state: "failed", error: "Access denied" } })),
    /无法读取项目的信任状态。 Access denied/,
  );
  assert.match(text(view({ read: { state: "failed", timedOut: true } })), /读取项目的信任状态耗时过长。/);
});

test("every string the dialog shows is translated", async () => {
  const literalKeys = [...source.matchAll(/\bt\("([^"]+)"/g)].map((match) => match[1]);
  const ternaryKeys = [...source.matchAll(/\? "([a-z]+\.[\w.-]+)" : "([a-z]+\.[\w.-]+)"/g)].flatMap((match) => [match[1], match[2]]);
  const returnedKeys = [...source.matchAll(/return "([a-z]+\.[\w.-]+)";/g)].map((match) => match[1]);
  const templateKeys = [...source.matchAll(/t\(`(trust\.refusal\.\$\{error\.reason\})`\)/g)].map((match) => match[1]);
  const keys = [...literalKeys, ...ternaryKeys, ...returnedKeys];
  assert.deepEqual([...new Set(returnedKeys)].sort(), ["trust.alreadyTrusted"]);
  assert.deepEqual(templateKeys, ["trust.refusal.${error.reason}"]);
  for (const key of keys) assert.equal(typeof messages[key], "string", `${key} is missing`);
  for (const reason of ["trust-not-required", "session-busy"]) {
    assert.equal(typeof messages[`trust.refusal.${reason}`], "string", reason);
  }
});

test("repository text in the dialog never keeps its own line breaks or runs of spaces", () => {
  // Either could push a value's tail out of view of the person deciding trust.
  for (const selector of [".project-trust-mcp-detail"]) {
    const block = settingsCss.slice(settingsCss.indexOf(`${selector} {`));
    assert.match(block.slice(0, block.indexOf("}")), /white-space: normal;/, selector);
  }
});
