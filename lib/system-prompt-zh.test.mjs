import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  ZH_PREAMBLE,
  ZH_SYSTEM_PROMPT_EXTENSION_NAME,
  createChineseSystemPromptExtension,
  localizeSystemPromptOptions,
  rulesSection,
  toolsSection,
} = await createJiti(import.meta.url).import("./system-prompt-zh.ts");

function promptOptions(overrides = {}) {
  return {
    customPrompt: undefined,
    selectedTools: ["read", "bash", "edit", "write"],
    hiddenTools: [],
    toolSnippets: {
      read: "Read file contents",
      bash: "Execute bash commands (ls, grep, find, etc.)",
    },
    toolGuidelines: {
      read: ["Use read to examine files instead of cat or sed."],
      bash: ["You can inspect PI_* environment variables for current model and session details."],
    },
    promptGuidelines: [],
    appendSystemPrompt: "",
    sections: {},
    cwd: "/repo",
    contextFiles: [],
    skills: [],
    ...overrides,
  };
}

test("the shipped prompt is Chinese and asks for Chinese replies", () => {
  const options = promptOptions();
  localizeSystemPromptOptions(options);
  assert.equal(options.customPrompt, ZH_PREAMBLE);
  assert.match(options.customPrompt, /简体中文回复/);
  // The language rule leads the rules, where a model reads it last and weighs it most.
  const firstRule = options.sections.rules.split("\n")[0];
  assert.match(firstRule, /始终用简体中文回复用户/);
  assert.match(options.sections.rules, /代码、标识符、命令、文件路径、日志/);
});

test("Pi's tool, rules and docs sections are replaced, its own sections kept", () => {
  const options = promptOptions({ sections: { extra: "extension section" } });
  localizeSystemPromptOptions(options);
  assert.deepEqual(Object.keys(options.sections).sort(), ["docs", "extra", "rules", "tools"]);
  // Pi skips these once customPrompt is set, so nothing English is left to describe them.
  assert.doesNotMatch(options.sections.tools, /Read file contents/);
  assert.match(options.sections.tools, /- read：读取文件内容/);
  assert.match(options.sections.docs, /Pi 文档/);
});

test("a tool translation is only used for tools the options list", () => {
  const options = promptOptions();
  const tools = toolsSection(options);
  assert.match(tools, /- bash：执行 bash 命令（ls、grep、find 等）/);
  assert.doesNotMatch(tools, /codemode/);
  // A hidden tool is not declared, so its snippet stays out of the prompt.
  assert.doesNotMatch(toolsSection(promptOptions({ hiddenTools: ["bash"] })), /bash/);
});

test("a tool or guideline without a translation keeps its own wording", () => {
  const options = promptOptions({
    selectedTools: ["read", "my_tool"],
    toolSnippets: { read: "Read file contents", my_tool: "A project tool" },
    toolGuidelines: { my_tool: ["Prefer my_tool over bash here."] },
    promptGuidelines: ["Keep answers under 100 words."],
  });
  assert.match(toolsSection(options), /- my_tool：A project tool/);
  const rules = rulesSection(options);
  assert.match(rules, /- Prefer my_tool over bash here\./);
  assert.match(rules, /- Keep answers under 100 words\./);
});

test("guidelines are translated and deduplicated", () => {
  const options = promptOptions({
    promptGuidelines: [
      "Use read to examine files instead of cat or sed.",
      "  回答保持简洁  ",
    ],
  });
  const rules = rulesSection(options);
  assert.match(rules, /- 查看文件用 read，不要用 cat 或 sed。/);
  assert.equal(rules.match(/回答保持简洁/g).length, 1);
  assert.doesNotMatch(rules, /Use read to examine files/);
});

test("a session with its own SYSTEM.md keeps it", () => {
  const options = promptOptions({ customPrompt: "You are a release bot." });
  localizeSystemPromptOptions(options);
  assert.equal(options.customPrompt, "You are a release bot.");
  assert.deepEqual(options.sections, {});
});

test("the inline extension rewrites the prompt of every run", () => {
  const handlers = [];
  const extension = createChineseSystemPromptExtension();
  assert.equal(extension.name, ZH_SYSTEM_PROMPT_EXTENSION_NAME);
  assert.equal(extension.hidden, true);
  extension.factory({ on: (event, handler) => handlers.push([event, handler]) });
  assert.deepEqual(handlers.map(([event]) => event), ["before_agent_start"]);
  const options = promptOptions();
  handlers[0][1]({ type: "before_agent_start", messageType: "user", prompt: "hi", systemPrompt: "", systemPromptOptions: options });
  assert.equal(options.customPrompt, ZH_PREAMBLE);
  assert.match(options.sections.rules, /始终用简体中文回复用户/);
});
