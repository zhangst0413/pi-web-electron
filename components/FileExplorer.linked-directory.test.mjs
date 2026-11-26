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
const { TreeNode } = await jiti.import("./FileExplorer.tsx");
const { translateMessage } = await jiti.import("@/lib/i18n/format.ts");

const source = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");
const t = (key, params) => translateMessage("zh-CN", key, { "zh-CN": zhCNLocale.messages }, params);

function renderNode(node, { open = true } = {}) {
  return renderToStaticMarkup(React.createElement(TreeNode, {
    node,
    depth: 0,
    cwd: "/hub",
    onOpenFile() {},
    expandedPaths: new Set(open ? [node.fullPath] : []),
    onToggleExpanded() {},
    highlightedPaths: new Set(),
    gitStatusByPath: new Map(),
    changedDirectoryPaths: new Set(),
    t,
  }));
}

const linkedNode = {
  name: "linked",
  fullPath: "/hub/linked",
  isDir: true,
  size: 0,
  children: [],
  loaded: false,
  outsideLinkTarget: "/elsewhere/project",
};

test("an expanded link that leaves the project names its target and offers to allow it", () => {
  const html = renderNode(linkedNode);
  assert.match(html, /链接到项目外部：\/elsewhere\/project/);
  assert.match(html, /<button type="button" title="在 Pi Web 重启前允许浏览 \/elsewhere\/project，与将其选为项目目录相同"[^>]*>允许浏览<\/button>/);
  assert.doesNotMatch(html, />empty</);
});

test("a collapsed link that leaves the project is marked on its row", () => {
  const html = renderNode(linkedNode, { open: false });
  assert.match(html, /aria-label="链接到项目外部：\/elsewhere\/project"/);
  assert.doesNotMatch(html, /允许浏览/);
});

test("ordinary directories render no link notice", () => {
  const html = renderNode({ ...linkedNode, outsideLinkTarget: undefined, loaded: true });
  assert.doesNotMatch(html, /outside this project|允许浏览/);
  assert.match(html, />empty</);
});

test("a link that encloses the project or home folder warns and confirms before allowing", () => {
  const html = renderNode({ ...linkedNode, outsideLinkTarget: "/", outsideLinkEncloses: true });
  assert.match(html, /该文件夹包含当前项目或你的主目录。/);
  assert.doesNotMatch(renderNode(linkedNode), /contains this project/);
  assert.match(source, /if \(node\.outsideLinkEncloses && !window\.confirm\(t\("files\.allowEnclosingLinkConfirm"/);
});
