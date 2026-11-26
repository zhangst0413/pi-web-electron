import {
  getDocsPath,
  getExamplesPath,
  getReadmePath,
  type InlineExtension,
  type NormalizedBuildSystemPromptOptions,
} from "@earendil-works/pi-coding-agent";

export const ZH_SYSTEM_PROMPT_EXTENSION_NAME = "pi-web-zh-system-prompt";

/**
 * Pi's own prompt is English, and a model asked in English tends to answer in English, so the
 * shipped sessions send a Chinese prompt instead. The extension rewrites the prompt options in
 * `before_agent_start` rather than forcing a prompt string: Pi then diffs the changed sections
 * against the transcript as usual, so the model gets a section patch, not a cache miss.
 *
 * A `SYSTEM.md` (or `--system-prompt`) is the user's own prompt and wins: the extension leaves
 * that session untouched. `APPEND_SYSTEM.md` is unaffected either way (it lands in `addendum`).
 */
export const ZH_PREAMBLE =
  "你是在 pi 这个编码智能体（coding agent harness）中运行的编程助手，帮助用户查看文件、执行命令和修改代码。"
  + "无论用户用什么语言提问，默认始终用简体中文回复。";

/** Pi's tool snippets, per tool name. A tool this table does not know keeps Pi's own snippet. */
const TOOL_SNIPPETS: Record<string, string> = {
  read: "读取文件内容",
  bash: "执行 bash 命令（ls、grep、find 等）",
  powershell: "执行 PowerShell 命令",
  edit: "按精确文本替换修改文件，一次调用可包含多处互不重叠的修改",
  write: "创建文件或整体重写文件",
  grep: "在文件内容中按模式搜索（遵循 .gitignore）",
  find: "按 glob 模式查找文件（遵循 .gitignore）",
  ls: "列出目录内容",
  codemode: "运行可调用其他工具的 JavaScript",
};

/**
 * Pi's per-tool guideline bullets, keyed by the exact English text a tool contributes. An
 * extension's own guideline is not in this table and is kept as written.
 */
const GUIDELINES: Record<string, string> = {
  "Use read to examine files instead of cat or sed.": "查看文件用 read，不要用 cat 或 sed。",
  "You can inspect PI_* environment variables for current model and session details.":
    "可以读取 PI_* 环境变量获取当前模型和会话信息。",
  "Use write only for new files or complete rewrites.": "write 只用于新建文件或整体重写。",
  "Use edit for targeted changes. Batch changes to one file in a single call.":
    "edit 用于定点修改，同一个文件的改动合并到一次调用里。",
  "Each edits[].oldText must exactly and uniquely match the original file. Keep matches short and non-overlapping; merge nearby changes without including large unchanged regions.":
    "每条 edits[].oldText 必须与原文完全一致且只匹配一处：匹配片段要短、互不重叠，相邻改动合并处理，不要带上大段未改动的内容。",
  "Use codemode to batch independent tool calls (Promise.allSettled), chain them, or filter large output, instead of many separate calls.":
    "用 codemode 批量执行互不依赖的工具调用（Promise.allSettled）、串联调用或过滤大量输出，避免大量分散的单独调用。",
};

/** Rules every session gets, the language one first as the one the user asked for. */
const DEFAULT_RULES: string[] = [
  "始终用简体中文回复用户：正文、解释、计划、总结、提问和报错说明都用中文；代码、标识符、命令、文件路径、日志以及引用的原文保持原样，不要翻译。",
  "回答保持简洁",
  "涉及文件时写清路径",
  "读取文件、列目录、搜索内容时优先用专用工具（read、ls、grep、find），没有对应工具时再用 bash",
];

/** Pi's docs section with the same paths, so the model still finds the harness' own docs. */
function docsSection(): string {
  return [
    "Pi 文档（只在用户问到这个 harness 本身、它的 SDK、扩展、主题、技能或 TUI 时才读）：",
    `- 主文档：${getReadmePath()}`,
    `- 其他文档：${getDocsPath()}`,
    `- 示例：${getExamplesPath()}（扩展、自定义工具、SDK）`,
    "- 读 pi 文档和示例时，docs/... 在“其他文档”下解析、examples/... 在“示例”下解析，不要按当前工作目录解析",
    "- 问到这些主题时按需查阅：扩展（docs/extensions.md、examples/extensions/）、主题（docs/themes.md）、技能（docs/skills.md）、提示模板（docs/prompt-templates.md）、TUI 组件（docs/tui.md）、快捷键（docs/keybindings.md）、SDK 集成（docs/sdk.md）、自定义 provider（docs/custom-provider.md）、添加模型（docs/models.md）、包（docs/packages.md）、环境变量（docs/environment-variables.md）、MCP 服务器（docs/mcp.md）、codemode 脚本以及分类器、图像模型这类非 LLM 模型（docs/codemode.md）",
    "- 修改这个 harness 之前，先把它相关的文档和示例完整读一遍，并顺着交叉引用继续读",
  ].join("\n");
}

function declaredTools(options: NormalizedBuildSystemPromptOptions): string[] {
  return options.selectedTools.filter((name) => !options.hiddenTools.includes(name));
}

/** Pi's tools section, one Chinese line per tool it lists. */
export function toolsSection(options: NormalizedBuildSystemPromptOptions): string {
  const lines = declaredTools(options)
    .filter((name) => options.toolSnippets[name])
    .map((name) => `- ${name}：${TOOL_SNIPPETS[name] ?? options.toolSnippets[name]}`);
  const more = "请求中可能还提供其他工具。";
  return lines.length > 0 ? `${lines.join("\n")}\n\n${more}` : more;
}

/** Pi's rules section: the defaults, the tools' own guidelines, then the extension ones. */
export function rulesSection(options: NormalizedBuildSystemPromptOptions): string {
  const rules = [...DEFAULT_RULES];
  for (const name of declaredTools(options)) rules.push(...(options.toolGuidelines[name] ?? []));
  rules.push(...options.promptGuidelines);
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const rule of rules) {
    const normalized = rule.trim();
    if (!normalized) continue;
    const text = GUIDELINES[normalized] ?? normalized;
    if (seen.has(text)) continue;
    seen.add(text);
    lines.push(`- ${text}`);
  }
  return lines.join("\n");
}

/**
 * Rewrite the prompt options in place to Chinese. Pi skips its own `tools`, `rules` and `docs`
 * sections once `customPrompt` is set, so all three are supplied here; `addendum`,
 * `project_context`, `skills` and `cwd` are Pi's and stay.
 */
export function localizeSystemPromptOptions(options: NormalizedBuildSystemPromptOptions): void {
  if (options.customPrompt && options.customPrompt.trim()) return;
  options.customPrompt = ZH_PREAMBLE;
  options.sections = {
    ...options.sections,
    tools: toolsSection(options),
    rules: rulesSection(options),
    docs: docsSection(),
  };
}

/** A `before_agent_start` handler as an inline extension, as `createExactSystemPromptExtension` is. */
export function createChineseSystemPromptExtension(): InlineExtension {
  return {
    name: ZH_SYSTEM_PROMPT_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      pi.on("before_agent_start", (event) => {
        localizeSystemPromptOptions(event.systemPromptOptions);
      });
    },
  };
}
