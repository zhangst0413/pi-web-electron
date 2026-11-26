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
const { McpSignInRow } = await jiti.import("./McpSignIn.tsx");
const source = await readFile(new URL("./McpSignIn.tsx", import.meta.url), "utf8");

const h = React.createElement;
const messages = zhCNLocale.messages;

function decode(html) {
  return html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function text(html) {
  return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

const oauth = {
  name: "docs",
  scope: "global",
  sourcePath: "/Users/me/.pi/agent/mcp.json",
  configKey: "key",
  enabled: true,
  validated: true,
  transport: "http",
  url: "https://docs.example/mcp",
  envNames: [],
  headerNames: [],
  usesOAuth: true,
  signedIn: false,
  commandFields: [],
  variableReferences: [],
  masked: false,
};

const PAGE = "https://auth.example/authorize?client_id=pi&state=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A53682%2Fcallback";
const flow = (phase, extra = {}) => ({ flowId: "f1", scope: "global", name: "docs", configKey: "key", phase, expiresInMs: 200_000, ...extra });

function row(props = {}) {
  return decode(renderToStaticMarkup(h(I18nProvider, null, h(McpSignInRow, {
    server: oauth,
    run: undefined,
    block: undefined,
    signOutBlock: undefined,
    controlsBusy: false,
    signingOut: false,
    onSignIn() {},
    onSignOut() {},
    onPaste() {},
    onCancel() {},
    ...props,
  }))));
}

/** The buttons of the row: their attributes and labels. */
function buttons(html) {
  return [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(([, attributes, label]) => ({ attributes, label }));
}

test("a server with its own Authorization 请求头 has no 登录 row: its 请求头 row lists the header", () => {
  assert.equal(row({ server: { ...oauth, usesOAuth: false, headerNames: ["Accept", "authorization"] } }), "");
  // One that signs in some other way without OAuth still says how, with nothing to press.
  const html = row({ server: { ...oauth, usesOAuth: false } });
  assert.equal(text(html), "登录 Authorization 请求头");
  assert.deepEqual(buttons(html), []);
  const provider = row({ server: { ...oauth, usesOAuth: false, headerNames: ["Authorization"], authProvider: "github" } });
  assert.match(text(provider), /^登录 发送 pi 提供商 github 的令牌/);
});

test("an OAuth server offers 登录, says what it does and, once something is stored, that it may replace it, and 退出登录", () => {
  const out = row();
  assert.deepEqual(buttons(out).map((button) => button.label), ["登录"]);
  assert.match(text(out), /^登录 未登录。/);
  // Nothing stored for the URL: nothing to replace, and nothing to sign out of.
  assert.doesNotMatch(text(out), /may replace|退出登录 deletes/);

  const signedIn = row({ server: { ...oauth, signedIn: true } });
  assert.deepEqual(buttons(signedIn).map((button) => button.label), ["登录", "退出登录"]);
  assert.match(text(signedIn), /^登录 已登录。/);
  assert.match(text(signedIn), /登录可能会替换此服务器已保存的令牌和注册信息。/);
  assert.match(text(signedIn), /退出登录会删除此服务器保存的令牌和注册信息，已打开的会话在下次请求时失去访问权限。/);
  // An unreadable mcp-auth.json still offers Sign out.
  assert.deepEqual(buttons(row({ server: { ...oauth, signedIn: undefined } })).map((button) => button.label), ["登录", "退出登录"]);
  // A cancelled or expired sign-in leaves a client registration and its PKCE state but no tokens:
  // Sign out still clears them, as `pi mcp logout` would.
  const leftover = row({ server: { ...oauth, signedIn: false, oauthStateStored: true } });
  assert.deepEqual(buttons(leftover).map((button) => button.label), ["登录", "退出登录"]);
  assert.match(text(leftover), /^登录 未登录，但保存了此服务器的客户端注册信息或未完成的登录。/);
  assert.deepEqual(buttons(row({ server: { ...oauth, signedIn: false, oauthStateStored: false } })).map((button) => button.label), ["登录"]);
  // While a change runs, Sign out waits; Sign in, which writes no mcp.json, does not.
  const busy = buttons(row({ server: { ...oauth, signedIn: true }, controlsBusy: true }));
  assert.doesNotMatch(busy[0].attributes, /disabled/);
  assert.match(busy[1].attributes, /disabled=""/);
  assert.equal(buttons(row({ server: { ...oauth, signedIn: true }, controlsBusy: true, signingOut: true }))[1].label, "正在退出登录…");
  // A Sign out on its way would cancel a sign-in that reached the server first, so Sign in waits for it.
  assert.match(buttons(row({ server: { ...oauth, signedIn: true }, controlsBusy: true, signingOut: true }))[0].attributes, /disabled=""/);
});

test("a blocked sign-in is disabled and points at the visible reason", () => {
  const html = row({ server: { ...oauth, signedIn: true }, block: "project-untrusted", signOutBlock: "project-untrusted" });
  const [signIn, signOut] = buttons(html);
  for (const button of [signIn, signOut]) {
    assert.match(button.attributes, /disabled=""/);
    const id = button.attributes.match(/aria-describedby="([^"]+)"/)?.[1];
    assert.ok(id, button.label);
    assert.match(html, new RegExp(`<span id="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" class="mcp-config-line is-dim">此项目未受信任，因此 Pi Web 不会登录或退出它的服务器。</span>`));
  }
  assert.doesNotMatch(text(html), /may replace|退出登录 deletes/, "no explanation of what cannot be done");
  // A PI_WEB_PASSWORD entry cannot sign in, but its tokens can still go.
  const password = buttons(row({ server: { ...oauth, signedIn: true }, block: "web-password" }));
  assert.match(password[0].attributes, /disabled=""/);
  assert.doesNotMatch(password[1].attributes, /disabled/);
});

test("a sign-in under way says what it does, and offers 取消 instead", () => {
  const connecting = row({ run: { flow: flow("connecting") } });
  assert.match(connecting, /<span role="status" class="mcp-config-line">正在检查服务器是否要求登录…<\/span>/);
  assert.deepEqual(buttons(connecting).map((button) => button.label), ["取消登录"]);
  assert.match(row({ run: { flow: flow("starting") } }), /正在通过服务器的授权服务器准备登录…/);
  const finishing = row({ run: { flow: flow("finishing") } });
  assert.match(finishing, /正在完成登录…/);
  assert.match(buttons(finishing)[0].attributes, /disabled=""/, "the code is on its way: nothing left to cancel");
  // Why it cannot be cancelled is a visible line the disabled button points at.
  const noCancel = buttons(finishing)[0].attributes.match(/aria-describedby="([^"]+)"/)?.[1];
  assert.ok(noCancel);
  assert.match(finishing, new RegExp(`<span id="${noCancel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" class="mcp-config-line is-dim">授权服务器已经回应，因此这一步无法再取消。</span>`));
  assert.doesNotMatch(buttons(connecting)[0].attributes, /aria-describedby/);
  assert.doesNotMatch(text(connecting), /can no longer be cancelled/);
  assert.equal(buttons(row({ run: { flow: flow("connecting"), cancelling: true } }))[0].label, "正在取消…");
  // No Sign out while one runs.
  assert.deepEqual(buttons(row({ server: { ...oauth, signedIn: true }, run: { flow: flow("connecting") } })).map((button) => button.label), ["取消登录"]);
  // The other file's entry of the same name and URL started it: the row says whose it is.
  assert.match(text(row({ run: { flow: flow("connecting", { scope: "project" }) } })), /另一个同名的 docs 条目使用相同的 URL，这是它的登录：令牌对两者都有效。/);
});

test("waiting for the browser shows the page as a link, the paste box, and where the browser goes back to", () => {
  const html = row({ run: { flow: flow("authorize", { authorizationUrl: PAGE, redirectUrl: "http://127.0.0.1:53682/callback" }) } });
  assert.match(html, /<p class="oauth-paste-message">打开登录页并批准访问。/);
  assert.match(html, new RegExp(`<p class="oauth-paste-hint">登录页： <a href="${PAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" target="_blank" rel="noopener noreferrer">`));
  // The box is never focused by itself, has a name, and submits only a value.
  assert.match(html, /<input class="oauth-paste-input" placeholder="http:\/\/127\.0\.0\.1:…\/callback\?code=…" aria-label="浏览器最终打开的地址" value=""\/>/);
  assert.match(html, /<button type="button" class="oauth-paste-submit" disabled="">继续<\/button>/);
  assert.match(text(html), /批准后，浏览器会被发送到 http:\/\/127\.0\.0\.1:53682\/callback，只有运行 Pi Web 的计算机才能打开它。/);
  assert.match(text(html), /Pi Web 从登录开始起最多等待 5 分钟。/);
  assert.deepEqual(buttons(html).map((button) => button.label), ["继续", "取消登录"]);

  // A page that is not an http(s) address is shown as text, never as a link.
  const odd = row({ run: { flow: flow("authorize", { authorizationUrl: "javascript:alert(1)" }) } });
  assert.doesNotMatch(odd, /<a /);
  assert.match(text(odd), /服务器给出的登录页不是网址，因此只以文本显示： javascript:alert\(1\)/);

  // A refused paste says why in the panel's words, and the box stays.
  const refused = row({ run: { flow: flow("authorize", { authorizationUrl: PAGE }), pasteError: { error: "x", reason: "redirect-state-mismatch" } } });
  assert.match(refused, /<span role="alert" class="mcp-config-line is-error">该地址无法完成这次登录： 该地址属于另一次登录。请粘贴这次登录后浏览器最终打开的地址。/);
  assert.match(refused, /class="oauth-paste-input"/);
  const denied = row({ run: { flow: flow("authorize", { authorizationUrl: PAGE }), pasteError: { error: "The user said no", reason: "redirect-denied" } } });
  assert.match(text(denied), /授权服务器没有授予访问权限。请重新打开登录页，或取消。 The user said no/);
  // While a paste is checked, the box and its button wait.
  const pasting = row({ run: { flow: flow("authorize", { authorizationUrl: PAGE }), pasting: true } });
  assert.match(pasting, /<input class="oauth-paste-input"[^>]*disabled=""/);
  assert.match(pasting, /<button type="button" class="oauth-paste-submit" disabled="">正在检查…<\/button>/);
});

test("how the sign-in ended stays under the row, with 登录 again", () => {
  const result = (state, extra = {}) => ({ state, tools: [], toolCount: 1, durationMs: 4, testedAt: 1, afterSignIn: true, ...extra });
  assert.match(text(row({ run: { flow: flow("done", { result: result("connected") }) } })), /已登录。上方的“状态”显示服务器提供的内容。/);
  assert.match(text(row({ run: { flow: flow("done", { alreadySignedIn: true, result: result("connected") }) } })), /已经登录：服务器无需重新登录就连接上了。/);
  assert.match(text(row({ run: { flow: flow("done", { refreshed: true, result: result("connected") }) } })), /已使用保存的刷新令牌重新登录，无需浏览器。/);
  const after = row({ run: { flow: flow("done", { result: result("failed", { error: "ECONNRESET" }) }) } });
  assert.match(after, /<span role="status" class="mcp-config-line is-warning">已登录，但之后服务器没有连接成功。上方的“状态”说明了原因。<\/span>/);
  const failed = row({ run: { flow: flow("failed", { failure: "sign-in-failed", error: "registration failed: •••" }) } });
  assert.match(failed, /<span role="status" class="mcp-config-line is-error">登录失败。<\/span><span class="mcp-config-line is-error">错误： <code class="mcp-config-chip">registration failed: •••<\/code><\/span>/);
  assert.match(text(row({ run: { flow: flow("expired") } })), /登录没有在 5 分钟内完成，因此 Pi Web 停止了等待。/);
  assert.match(text(row({ run: { flow: flow("cancelled") } })), /已取消登录。/);
  assert.deepEqual(buttons(row({ run: { flow: flow("cancelled") } })).map((button) => button.label), ["登录"]);
  // A flow the server forgot, and requests that failed, each say so.
  assert.match(text(row({ run: { flow: flow("authorize"), gone: true } })), /Pi Web 已不再记得这次登录：它已结束一段时间，或者 Pi Web 已重启。按“登录”重新开始。/);
  assert.match(text(row({ run: { error: { error: "x", reason: "sign-in-not-oauth" } } })), /无法登录： 此服务器不通过 OAuth 登录：只有没有 Authorization 请求头的 HTTP 服务器才会这样登录。/);
  assert.match(text(row({ run: { error: { error: "x", reason: "project-untrusted" } } })), /无法登录： 此项目未受信任，因此 Pi Web 不会登录或退出它的服务器。/);
  assert.match(text(row({ run: { error: { error: "x", reason: "unparsable" } } })), /无法登录： Pi Web 已无法从文件中读取此条目。请按“刷新”。/);
  assert.match(text(row({ run: { error: { error: "GET timed out", timedOut: true } } })), /Pi Web 没有及时响应。再按一次“登录”可查看正在进行的登录。/);
  assert.match(text(row({ server: { ...oauth, signedIn: true }, run: { signOutError: { error: "x", timedOut: true } } })), /无法退出登录： Pi Web 没有及时响应，更改可能未生效。/);
  assert.match(text(row({ run: { signedOut: { removed: true } } })), /已退出登录：为该服务器保存的令牌已删除。/);
  assert.match(text(row({ run: { signedOut: { removed: false } } })), /该服务器没有保存任何内容，因此无需退出登录。/);
});

test("a sign-in joined from the other entry of the name and URL ends naming that entry, not this one's 状态 row", () => {
  const result = { state: "connected", tools: [], toolCount: 1, durationMs: 4, testedAt: 1, afterSignIn: true };
  const done = text(row({ run: { flow: flow("done", { scope: "project", result }) } }));
  assert.match(done, /已通过另一个同名的 docs 条目登录，它使用相同的 URL，因此令牌对此条目同样有效。按“测试连接”查看此条目的服务器提供的内容。/);
  assert.doesNotMatch(done, /状态 above/);
  assert.match(text(row({ run: { flow: flow("done", { scope: "project", alreadySignedIn: true, result }) } })), /另一个同名的 docs 条目使用相同的 URL，并且已经登录/);
  const failed = text(row({ run: { flow: flow("failed", { scope: "project", failure: "connect-failed", result: { ...result, state: "failed" } }) } }));
  assert.match(failed, /通过另一个同名的 docs 条目（使用相同的 URL）进行的登录没有可登录的内容：该条目的服务器没有连接成功，也没有要求登录。它的“状态”一行说明了原因。/);
  // The entry that started it keeps its own words.
  assert.match(text(row({ run: { flow: flow("done", { result }) } })), /已登录。上方的“状态”显示服务器提供的内容。/);
});

test("a failed cancel is shown while the sign-in runs, and not once it has ended", () => {
  const cancelError = { error: "DELETE timed out", timedOut: true };
  assert.match(text(row({ run: { flow: flow("authorize", { authorizationUrl: PAGE }), cancelError } })), /无法取消登录： Pi Web 没有及时响应。登录可能仍在进行；一旦有进展，这里会显示。/);
  const ended = text(row({ run: { flow: flow("done", { result: { state: "connected", tools: [], toolCount: 1, durationMs: 4, testedAt: 1 } }), cancelError } }));
  assert.match(ended, /已登录。/);
  assert.doesNotMatch(ended, /Could not cancel/);
  assert.doesNotMatch(text(row({ run: { flow: flow("authorize"), gone: true, cancelError } })), /Could not cancel/);
});

test("the row's words come from the locale files", () => {
  const keys = [...source.matchAll(/t\("([^"]+)"/g)].map((match) => match[1]);
  assert.ok(keys.length >= 20);
  for (const key of keys) assert.equal(typeof messages[key], "string", `${key} is missing from en.ts`);
  assert.doesNotMatch(source, />\s*[A-Z][a-z]+(?: [a-z]+){2,}[.:]?\s*</);
});
