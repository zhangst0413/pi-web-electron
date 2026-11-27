/**
 * harness.ts —— 整个应用的「后端核心」。
 *
 * 可以把它理解为 Python 项目里的 service 层：
 *   - 读写配置文件（相当于 config.json + pydantic 校验）
 *   - 管理 pi SDK 的「活跃会话」对象（agent 实例）的生命周期
 *   - 把 pi SDK 的原始消息 / 事件转换成前端（assistant-ui）能直接渲染的结构
 *
 * 给 Python 程序员的阅读提示：
 *   - 本文件只在 Node.js 服务端运行（Next.js 的 Route Handler 会 import 它）。
 *   - `type Xxx = {...}` 是 TypeScript 的类型别名，类似 Python 的 TypedDict / dataclass。
 *   - `Partial<Config>` 等价于「所有字段都可选的 Config」，类似 `Config | dict`。
 *   - `??=` 是「若为 null/undefined 才赋值」，类似 Python 里 `if x is None: x = ...`。
 *   - `void promise` 表示「故意不 await」，类似 Python 里 fire-and-forget 的 task。
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	type AgentSession,
	type AgentSessionEvent,
	createAgentSession,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { MessageStatus } from "@assistant-ui/react";
import type { Config, SessionSummary, UiMessage, WireEvent } from "./types";

// ------------------------------------------------------------------ 常量
/** pi SDK 里使用的 provider 名称（对应 opencode-go 网关）。 */
const PROVIDER = "opencode-go";
/** 未配置模型时使用的默认模型 ID。 */
const DEFAULT_MODEL = "deepseek-v4.1-flash";

/**
 * 数据目录。默认是仓库/安装目录下的 ./data，
 * 可用环境变量 HARNESS_DATA 覆盖（Electron 打包后指向 userData/data）。
 */
const DATA_DIR = resolve(/*turbopackIgnore: true*/ process.env.HARNESS_DATA || "data");
/** pi SDK 的 agent 目录：存放 auth.json（凭据）等，与用户的 ~/.pi 隔离。 */
const AGENT_DIR = join(DATA_DIR, "agent");
/** 会话（JSONL 历史文件）存放目录，跨工作目录共用。 */
const SESSIONS_DIR = join(DATA_DIR, "sessions");
/** 应用配置文件：apiKey / model / workspaces。 */
const CONFIG_FILE = join(DATA_DIR, "config.json");

/**
 * 一个「活着的」会话：pi SDK 的 AgentSession 实例 + 若干 SSE 订阅者。
 * 类似 Python 里一个长期运行的对象，持有 session 与订阅回调列表。
 */
type Live = {
	id: string;
	cwd: string;
	session: AgentSession;
	/** 当前是否有一轮对话正在跑（用于前端显示「停止」按钮 / 侧边栏小圆点）。 */
	running: boolean;
	createdAt: number;
	/** 订阅者集合：每个浏览器标签页的 SSE 连接对应一个回调。 */
	listeners: Set<(event: WireEvent) => void>;
};

/** 内存中的活跃会话表（id -> Live）。进程重启后为空，需要时会从磁盘重新打开。 */
const live = new Map<string, Live>();
/** 「正在打开」的会话表：避免同一个会话被并发打开两次（类似 Python 的 asyncio.Lock 去重）。 */
const opening = new Map<string, Promise<Live>>();
/** ModelRuntime 只创建一次（懒加载 + 缓存 Promise，失败时清空以便重试）。 */
let runtimePromise: Promise<ModelRuntime> | undefined;

/** 把任意异常安全地转成字符串（Python 里常见的 `str(exc)` 兼容写法）。 */
export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

// ------------------------------------------------------- pi 消息的最小结构
// 这里只声明本文件用到的字段，避免强耦合 SDK 内部类型；`?` 表示字段可能不存在。
type PiContentPart = {
	type: string;
	text?: string;
	/** toolCall 片段的 id / 名称 / 参数 */
	id?: string;
	name?: string;
	arguments?: unknown;
};

type PiMessage = {
	role?: string;
	timestamp?: number;
	content?: string | PiContentPart[];
	/** 结束原因，例如 "stop" / "error" / "aborted"。 */
	stopReason?: string;
	errorMessage?: string;
	/** role === "toolResult" 时，指向被回应的 toolCall。 */
	toolCallId?: string;
	isError?: boolean;
};

/** 前端 tool-call 片段（会被 toolResult 消息补上 result / isError）。 */
type ToolCallPart = {
	type: "tool-call";
	toolCallId: string;
	toolName: string;
	args: unknown;
	result?: string;
	isError?: boolean;
};

// ------------------------------------------------------------------ 配置

/**
 * 读取配置（同步读文件，带旧版本迁移与默认值）。
 * 找不到文件或字段缺失时给出合理默认值，绝不抛异常。
 */
export function readConfig(): Config {
	const saved = existsSync(CONFIG_FILE)
		? (JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Partial<Config> & { cwd?: string })
		: {};
	// `cwd` 是第一版「只能有一个目录」的配置；这里自动迁移成 workspaces 列表。
	const workspaces = Array.isArray(saved.workspaces)
		? uniqueDirectories(saved.workspaces)
		: saved.cwd?.trim()
			? [resolve(/*turbopackIgnore: true*/ saved.cwd)]
			: [process.env.HARNESS_DEFAULT_CWD?.trim() || process.cwd()];
	return {
		apiKey: typeof saved.apiKey === "string" ? saved.apiKey : "",
		model: saved.model?.trim() || DEFAULT_MODEL,
		workspaces,
	};
}

/** 校验并保存 key/model。保存成功后丢弃所有活跃会话，让它们用新配置重新打开。 */
export async function saveConfig(patch: Partial<Config>): Promise<Config> {
	const config = readConfig();
	if (typeof patch.apiKey === "string") config.apiKey = patch.apiKey.trim();
	if (typeof patch.model === "string" && patch.model.trim()) config.model = patch.model.trim();

	// 写盘之前先确认这个模型真的存在，避免存下一个用不了的配置。
	const runtime = await getRuntime(config.apiKey);
	if (!runtime.getModel(PROVIDER, config.model)) {
		throw new Error(`${PROVIDER} 没有模型 "${config.model}"`);
	}

	persist(config);
	disposeAll();
	return config;
}

/** 把目录加入工作目录列表（去重 + 校验目录存在）。 */
export function addWorkspace(directory: string): Config {
	const dir = resolve(/*turbopackIgnore: true*/ directory);
	assertDirectory(dir);
	const config = readConfig();
	if (!config.workspaces.includes(dir)) config.workspaces = [...config.workspaces, dir];
	persist(config);
	return config;
}

/** 从工作目录列表移除（不删除该目录下的会话历史）。 */
export function removeWorkspace(directory: string): Config {
	const dir = resolve(/*turbopackIgnore: true*/ directory);
	const config = readConfig();
	config.workspaces = config.workspaces.filter((workspace) => workspace !== dir);
	persist(config);
	return config;
}

/** 去重 + 转成绝对路径，过滤掉非字符串和空串。 */
function uniqueDirectories(values: unknown[]): string[] {
	const dirs = values
		// Python 里类似：[v for v in values if isinstance(v, str) and v.strip()]
		.filter((value): value is string => typeof value === "string" && value.trim() !== "")
		.map((value) => resolve(/*turbopackIgnore: true*/ value));
	// Set 去重后再展开成数组，类似 list(dict.fromkeys(dirs))。
	return [...new Set(dirs)];
}

/** 断言目录存在，否则抛出中文错误信息。 */
function assertDirectory(directory: string) {
	try {
		if (statSync(directory).isDirectory()) return;
	} catch {
		// 忽略异常，统一在下面抛出更友好的提示
	}
	throw new Error(`工作目录不存在: ${directory}`);
}

/** 把配置写回磁盘（自动创建目录，末尾补换行，方便 git diff）。 */
function persist(config: Config) {
	mkdirSync(DATA_DIR, { recursive: true });
	writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * 获取（并缓存）pi SDK 的 ModelRuntime。
 * 每次调用都会把当前 apiKey 写入运行时，这样设置里改 key 后无需重启进程。
 */
async function getRuntime(apiKey: string): Promise<ModelRuntime> {
	runtimePromise ??= ModelRuntime.create({ authPath: join(AGENT_DIR, "auth.json"), modelsPath: null }).catch(
		(error) => {
			// 创建失败就不要缓存失败的 Promise，否则后续调用永远失败。
			runtimePromise = undefined;
			throw error;
		},
	);
	const runtime = await runtimePromise;
	if (apiKey) await runtime.setRuntimeApiKey(PROVIDER, apiKey);
	return runtime;
}

// ------------------------------------------------------------- 活跃会话

/** pi 消息列表 -> assistant-ui 消息列表。工具结果会被折叠进对应的 tool-call 片段。 */
function toUi(messages: readonly unknown[], running: boolean): UiMessage[] {
	const result: UiMessage[] = [];
	// toolCallId -> 片段对象。后面遇到 toolResult 消息时按 id 找回并补上结果。
	const toolParts = new Map<string, ToolCallPart>();

	(messages as PiMessage[]).forEach((message, index) => {
		// 前端渲染需要稳定 id；有 timestamp 用它，否则退回数组下标。
		const id = `m${message.timestamp ?? index}-${index}`;
		if (message.role === "user") {
			result.push({ id, role: "user", content: [{ type: "text", text: textOf(message.content) }] });
		} else if (message.role === "assistant") {
			const content: any[] = [];
			for (const part of Array.isArray(message.content) ? message.content : []) {
				if (part.type === "text" && part.text) content.push({ type: "text", text: part.text });
				if (part.type === "toolCall") {
					const tool: ToolCallPart = {
						type: "tool-call",
						toolCallId: part.id ?? "",
						toolName: part.name ?? "",
						args: part.arguments ?? {},
					};
					content.push(tool);
					toolParts.set(tool.toolCallId, tool);
				}
			}
			// 模型报错时，把错误信息作为一条文本追加在末尾，方便用户看到原因。
			if (message.stopReason === "error" && message.errorMessage) {
				content.push({ type: "text", text: `⚠️ ${message.errorMessage}` });
			}
			result.push({
				id,
				role: "assistant",
				content,
				// 只有「最后一条 assistant 消息」且整轮仍在运行时，才标记为 running。
				status: statusOf(message, running && index === messages.length - 1),
			});
		} else if (message.role === "toolResult") {
			const tool = message.toolCallId ? toolParts.get(message.toolCallId) : undefined;
			if (tool) {
				tool.result = textOf(message.content);
				tool.isError = message.isError;
			}
		}
	});
	return result;
}

/** 根据 pi 消息的 stopReason 生成 assistant-ui 的消息状态。 */
function statusOf(message: PiMessage, isRunning: boolean): MessageStatus {
	if (isRunning) return { type: "running" };
	if (message.stopReason === "error") return { type: "incomplete", reason: "error", error: message.errorMessage };
	if (message.stopReason === "aborted") return { type: "incomplete", reason: "cancelled" };
	return { type: "complete", reason: "stop" };
}

/** 把 pi 的消息内容（字符串或多段内容）压平成纯文本。 */
function textOf(content: PiMessage["content"]): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => (part?.type === "text" ? part.text : part?.type === "image" ? "[图片]" : ""))
		.filter(Boolean)
		.join("\n");
}

/** 生成一条「全量状态」事件：前端收到后整体替换消息列表。 */
function stateOf(entry: Live): WireEvent {
	return { type: "sync", messages: toUi(entry.session.messages, entry.running), running: entry.running };
}

/** 向所有订阅者广播事件；发送失败说明连接已断开，顺手移除该订阅者。 */
function broadcast(entry: Live, event: WireEvent) {
	for (const send of entry.listeners) {
		try {
			send(event);
		} catch {
			entry.listeners.delete(send);
		}
	}
}

/**
 * pi SDK 事件 -> 浏览器事件。
 * 文本增量走轻量的 `delta`，其余会改变消息结构的事件统一发全量 `sync`。
 */
function onAgentEvent(entry: Live, event: AgentSessionEvent) {
	if (event.type === "message_update") {
		if (event.assistantMessageEvent.type === "text_delta" && event.assistantMessageEvent.delta) {
			broadcast(entry, { type: "delta", text: event.assistantMessageEvent.delta });
		}
		return;
	}

	switch (event.type) {
		case "agent_start":
			entry.running = true;
			break;
		case "agent_end":
		case "agent_settled":
			entry.running = false;
			break;
		// 这些事件不需要额外处理，但仍要触发一次 sync 让前端刷新消息列表。
		case "message_start":
		case "message_end":
		case "tool_execution_start":
		case "tool_execution_end":
		case "session_info_changed":
			break;
		default:
			return;
	}
	broadcast(entry, stateOf(entry));
}

/** 用给定的 SessionManager 创建一个活跃会话（即真正启动 pi agent 实例）。 */
async function createLive(manager: SessionManager): Promise<Live> {
	const config = readConfig();
	if (!config.apiKey) throw new Error("请先在设置里填写 opencode-go API Key");
	const modelRuntime = await getRuntime(config.apiKey);
	const model = modelRuntime.getModel(PROVIDER, config.model);
	if (!model) throw new Error(`${PROVIDER} 没有模型 "${config.model}"`);

	const { session } = await createAgentSession({
		cwd: manager.getCwd(),
		agentDir: AGENT_DIR,
		modelRuntime,
		model,
		sessionManager: manager,
	});

	const entry: Live = {
		id: session.sessionId,
		cwd: manager.getCwd(),
		session,
		running: false,
		createdAt: Date.now(),
		listeners: new Set(),
	};
	// 订阅 SDK 事件，之后所有变化都会经由 SSE 推给浏览器。
	session.subscribe((event) => onAgentEvent(entry, event));
	live.set(entry.id, entry);
	return entry;
}

/** 在磁盘上查找某个会话 id 对应的 JSONL 文件路径。 */
async function findSessionPath(id: string): Promise<string | undefined> {
	const sessions = await SessionManager.listAll(SESSIONS_DIR);
	return sessions.find((info) => info.id === id)?.path;
}

/** 打开（或复用）某个已持久化会话的活跃实例。并发调用只会真正打开一次。 */
export async function openSession(id: string): Promise<Live> {
	const existing = live.get(id);
	if (existing) return existing;

	const pending = opening.get(id);
	if (pending) return pending;

	const promise = (async () => {
		const path = await findSessionPath(id);
		if (!path) throw new Error("会话不存在");
		return createLive(SessionManager.open(path));
	})();
	opening.set(id, promise);
	try {
		return await promise;
	} finally {
		// 无论成功失败都要清理「正在打开」标记。
		opening.delete(id);
	}
}

/** 在指定目录下新建会话，返回会话 id。 */
export async function newSession(cwd?: string): Promise<string> {
	const config = readConfig();
	// 优先级：请求里带的目录 > 第一个工作目录 > 进程当前目录。
	const directory = resolve(/*turbopackIgnore: true*/ cwd?.trim() || config.workspaces[0] || process.cwd());
	assertDirectory(directory);
	return (await createLive(SessionManager.create(directory, SESSIONS_DIR))).id;
}

/** 列出所有会话（磁盘上的历史 + 尚未落盘的新会话），按最近修改时间倒序。 */
export async function listSessions(): Promise<SessionSummary[]> {
	const infos = await SessionManager.listAll(SESSIONS_DIR);
	const rows: SessionSummary[] = infos.map((info) => ({
		id: info.id,
		// 标题优先级：用户命名 > 首条消息前 60 字 > "新会话"
		title: info.name || (info.firstMessage === "(no messages)" ? "" : info.firstMessage.slice(0, 60)) || "新会话",
		cwd: info.cwd,
		modified: info.modified.getTime(),
		running: live.get(info.id)?.running ?? false,
	}));
	// 全新的会话在发出第一条消息之前没有文件，也不会出现在 listAll 里，这里补上。
	const known = new Set(rows.map((row) => row.id));
	for (const entry of live.values()) {
		if (known.has(entry.id)) continue;
		rows.push({ id: entry.id, title: "新会话", cwd: entry.cwd, modified: entry.createdAt, running: entry.running });
	}
	return rows.sort((a, b) => b.modified - a.modified);
}

/**
 * 在后台跑一轮对话；进度通过 SSE 推给浏览器，所以这里不等结果就返回。
 * 类似 Python 里的 `asyncio.create_task(session.prompt(text))`。
 */
export async function sendPrompt(id: string, text: string): Promise<void> {
	const entry = await openSession(id);
	if (!text.trim()) return;

	entry.running = true;
	broadcast(entry, stateOf(entry));
	void entry.session
		.prompt(text)
		.catch((error) => broadcast(entry, { type: "error", message: errorText(error) }))
		.finally(() => {
			entry.running = false;
			broadcast(entry, stateOf(entry));
		});
}

/** 中止正在运行的这一轮对话。 */
export async function abortRun(id: string): Promise<void> {
	await live.get(id)?.session.abort();
}

/** 删除会话：先释放内存里的实例，再删掉磁盘上的 JSONL 文件。 */
export async function deleteSession(id: string): Promise<void> {
	const entry = live.get(id);
	if (entry) {
		entry.session.dispose();
		live.delete(id);
	}
	const path = await findSessionPath(id);
	if (path) rmSync(path, { force: true });
}

/**
 * 订阅某个会话的状态与事件（SSE 用）。
 * 返回取消订阅的函数；先注册监听再发初始快照，避免中间漏掉事件。
 */
export async function subscribe(id: string, send: (event: WireEvent) => void): Promise<() => void> {
	const entry = await openSession(id);
	entry.listeners.add(send);
	send(stateOf(entry));
	return () => entry.listeners.delete(send);
}

/** 释放所有活跃会话（修改配置后调用）。 */
function disposeAll() {
	for (const entry of live.values()) entry.session.dispose();
	live.clear();
	opening.clear();
}
