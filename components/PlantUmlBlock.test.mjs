import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { PlantUmlBlock, PlantUmlPreviewBody, approvePlantUmlSource } = await jiti.import("./PlantUmlBlock.tsx");
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

const source = "@startuml\nAlice -> Bob: Hello!\n@enduml";

function render(element) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, element));
}

test("PlantUmlBlock shows the source and a button naming plantuml.com, sending nothing", () => {
  const html = render(React.createElement(PlantUmlBlock, { code: source, lang: "plantuml" }));
  assert.match(html, /Alice -&gt; Bob/);
  assert.match(html, /<button[^>]*title="在 plantuml\.com 渲染"[^>]*>在 plantuml\.com 渲染<\/button>/);
  assert.doesNotMatch(html, /<img|plantuml\.com\/plantuml/);
});

test("PlantUmlBlock waits for the end of a streamed reply", () => {
  const html = render(React.createElement(PlantUmlBlock, { code: source, lang: "puml", isStreaming: true }));
  assert.match(html, /<button[^>]*disabled=""[^>]*title="流式输出完成后可预览"/);
  assert.match(html, />puml</);
  assert.doesNotMatch(html, /<img/);
});

test("```plantuml and ```puml fences render through PlantUmlBlock; others do not", () => {
  const markdown = (lang, isStreaming) => render(
    React.createElement(MarkdownBody, { isStreaming }, `\`\`\`${lang}\n${source}\n\`\`\``),
  );
  for (const lang of ["plantuml", "puml", "PlantUML"]) {
    assert.match(markdown(lang), />在 plantuml\.com 渲染</, lang);
    assert.match(markdown(lang, true), />在 plantuml\.com 渲染</, `${lang} streaming`);
  }
  for (const lang of ["uml", "text", "mermaid"]) {
    assert.doesNotMatch(markdown(lang), /plantuml\.com/, lang);
  }
});

test("an empty fence offers no render", () => {
  for (const code of ["", "  \n\t"]) {
    const html = render(React.createElement(PlantUmlBlock, { code, lang: "plantuml" }));
    assert.doesNotMatch(html, /plantuml\.com/);
    assert.match(html, />复制</);
  }
});

test("a source approved on 本页面 mounts as its preview; any other source as code", () => {
  const approved = "@startuml\nCarol -> Dave: approved\n@enduml";
  approvePlantUmlSource(approved);
  const html = render(React.createElement(PlantUmlBlock, { code: approved, lang: "plantuml" }));
  assert.match(html, />源代码</);
  assert.match(html, /mermaid-block-loading[^>]*aria-label="正在渲染 PlantUML 图表"/);
  assert.doesNotMatch(html, /Carol -&gt; Dave/);
  // Not while it streams, and not for a source nobody approved.
  const streaming = render(React.createElement(PlantUmlBlock, { code: approved, lang: "plantuml", isStreaming: true }));
  assert.match(streaming, /Carol -&gt; Dave/);
  const other = render(React.createElement(PlantUmlBlock, { code: `${approved}\n`, lang: "plantuml" }));
  assert.match(other, />在 plantuml\.com 渲染</);
});

test("the preview is an <img> of the server's SVG with no referrer, shown once loaded", () => {
  const url = "https://www.plantuml.com/plantuml/svg/SyfFKj2rKt3CoKnELR1Io4ZDoSa70000";
  const html = render(React.createElement(PlantUmlPreviewBody, { result: { code: "x", status: "ready", url } }));
  assert.match(html, /aria-label="正在渲染 PlantUML 图表"/);
  assert.match(html, /<button[^>]*hidden=""[^>]*><img /);
  const img = html.match(/<img [^>]*>/)[0];
  assert.ok(img.includes(`src="${url}"`), img);
  assert.match(img, /referrerPolicy="no-referrer"/i);
  assert.match(img, /alt="PlantUML 图表"/);
});

test("the preview says why there is no picture", () => {
  const body = (result) => render(React.createElement(PlantUmlPreviewBody, { result }));
  assert.match(body(undefined), /mermaid-block-loading/);
  assert.match(body({ code: "x", status: "tooLong" }), /mermaid-block-error">过长，plantuml\.com 无法渲染</);
  assert.match(body({ code: "x", status: "failed" }), /mermaid-block-error">无法从 plantuml.com 加载</);
  assert.doesNotMatch(body({ code: "x", status: "tooLong" }), /<img/);
});
