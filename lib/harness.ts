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

const PROVIDER = "opencode-go";
const DEFAULT_MODEL = "deepseek-v4.1-flash";

const DATA_DIR = resolve(process.env.HARNESS_DATA || "data");
const AGENT_DIR = join(DATA_DIR, "agent");
const SESSIONS_DIR = join(DATA_DIR, "sessions");
const CONFIG_FILE = join(DATA_DIR, "config.json");

type Live = {
	id: string;
	cwd: string;
	session: AgentSession;
	running: boolean;
	createdAt: number;
	listeners: Set<(event: WireEvent) => void>;
};

const live = new Map<string, Live>();
const opening = new Map<string, Promise<Live>>();
let runtimePromise: Promise<ModelRuntime> | undefined;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

// ---------------------------------------------------------------- config

export function readConfig(): Config {
	const saved = existsSync(CONFIG_FILE)
		? (JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Partial<Config>)
		: {};
	return {
		apiKey: typeof saved.apiKey === "string" ? saved.apiKey : "",
		model: saved.model?.trim() || DEFAULT_MODEL,
		cwd: resolve(/*turbopackIgnore: true*/ saved.cwd?.trim() || process.cwd()),
	};
}

/** Validate and persist config. Existing live sessions are dropped so they pick up the new key/model. */
export async function saveConfig(patch: Partial<Config>): Promise<Config> {
	const config = readConfig();
	if (typeof patch.apiKey === "string") config.apiKey = patch.apiKey.trim();
	if (typeof patch.model === "string" && patch.model.trim()) config.model = patch.model.trim();
	if (typeof patch.cwd === "string" && patch.cwd.trim()) config.cwd = resolve(patch.cwd.trim());

	try {
		if (!statSync(config.cwd).isDirectory()) throw new Error();
	} catch {
		throw new Error(`工作目录不存在: ${config.cwd}`);
	}

	const runtime = await getRuntime(config.apiKey);
	if (!runtime.getModel(PROVIDER, config.model)) {
		throw new Error(`${PROVIDER} 没有模型 "${config.model}"`);
	}

	mkdirSync(DATA_DIR, { recursive: true });
	writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`);
	disposeAll();
	return config;
}

async function getRuntime(apiKey: string): Promise<ModelRuntime> {
	runtimePromise ??= ModelRuntime.create({ authPath: join(AGENT_DIR, "auth.json"), modelsPath: null }).catch(
		(error) => {
			runtimePromise = undefined;
			throw error;
		},
	);
	const runtime = await runtimePromise;
	if (apiKey) await runtime.setRuntimeApiKey(PROVIDER, apiKey);
	return runtime;
}

// ---------------------------------------------------------------- live sessions

/** pi message list -> assistant-ui message list. Tool results are folded into their call. */
function toUi(messages: readonly unknown[], running: boolean): UiMessage[] {
	const result: UiMessage[] = [];
	const toolParts = new Map<string, any>();

	(messages as any[]).forEach((message, index) => {
		const id = `m${message.timestamp ?? index}-${index}`;
		if (message.role === "user") {
			result.push({ id, role: "user", content: [{ type: "text", text: textOf(message.content) }] });
		} else if (message.role === "assistant") {
			const content: any[] = [];
			for (const part of message.content ?? []) {
				if (part.type === "text" && part.text) content.push({ type: "text", text: part.text });
				if (part.type === "toolCall") {
					const tool = { type: "tool-call", toolCallId: part.id, toolName: part.name, args: part.arguments ?? {} };
					content.push(tool);
					toolParts.set(part.id, tool);
				}
			}
			if (message.stopReason === "error" && message.errorMessage) {
				content.push({ type: "text", text: `⚠️ ${message.errorMessage}` });
			}
			result.push({
				id,
				role: "assistant",
				content,
				status: statusOf(message, running && index === messages.length - 1),
			});
		} else if (message.role === "toolResult") {
			const tool = toolParts.get(message.toolCallId);
			if (tool) {
				tool.result = textOf(message.content);
				tool.isError = message.isError;
			}
		}
	});
	return result;
}

function statusOf(message: Record<string, any>, isRunning: boolean): MessageStatus {
	if (isRunning) return { type: "running" };
	if (message.stopReason === "error") return { type: "incomplete", reason: "error", error: message.errorMessage };
	if (message.stopReason === "aborted") return { type: "incomplete", reason: "cancelled" };
	return { type: "complete", reason: "stop" };
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part: any) => (part?.type === "text" ? part.text : part?.type === "image" ? "[图片]" : ""))
		.filter(Boolean)
		.join("\n");
}

function stateOf(entry: Live): WireEvent {
	return { type: "sync", messages: toUi(entry.session.messages, entry.running), running: entry.running };
}

function broadcast(entry: Live, event: WireEvent) {
	for (const send of entry.listeners) {
		try {
			send(event);
		} catch {
			entry.listeners.delete(send);
		}
	}
}

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
	session.subscribe((event) => onAgentEvent(entry, event));
	live.set(entry.id, entry);
	return entry;
}

async function findSessionPath(id: string): Promise<string | undefined> {
	const sessions = await SessionManager.listAll(SESSIONS_DIR);
	return sessions.find((info) => info.id === id)?.path;
}

/** Open (or reuse) the live agent for a persisted session id. */
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
		opening.delete(id);
	}
}

export async function newSession(): Promise<string> {
	const config = readConfig();
	return (await createLive(SessionManager.create(config.cwd, SESSIONS_DIR))).id;
}

export async function listSessions(): Promise<SessionSummary[]> {
	const infos = await SessionManager.listAll(SESSIONS_DIR);
	const rows: SessionSummary[] = infos.map((info) => ({
		id: info.id,
		title: info.name || (info.firstMessage === "(no messages)" ? "" : info.firstMessage.slice(0, 60)) || "新会话",
		cwd: info.cwd,
		modified: info.modified.getTime(),
		running: live.get(info.id)?.running ?? false,
	}));
	// A brand-new session has no file (and no list entry) until its first message.
	for (const entry of live.values()) {
		if (rows.some((row) => row.id === entry.id)) continue;
		rows.push({ id: entry.id, title: "新会话", cwd: entry.cwd, modified: entry.createdAt, running: entry.running });
	}
	return rows.sort((a, b) => b.modified - a.modified);
}

/** Run a turn in the background; progress reaches the browser through the SSE stream. */
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

export async function abortRun(id: string): Promise<void> {
	await live.get(id)?.session.abort();
}

export async function deleteSession(id: string): Promise<void> {
	const entry = live.get(id);
	if (entry) {
		entry.session.dispose();
		live.delete(id);
	}
	const path = await findSessionPath(id);
	if (path) rmSync(path, { force: true });
}

/** Stream a session's state and events; returns the unsubscribe function. */
export async function subscribe(id: string, send: (event: WireEvent) => void): Promise<() => void> {
	const entry = await openSession(id);
	send(stateOf(entry));
	entry.listeners.add(send);
	return () => entry.listeners.delete(send);
}

function disposeAll() {
	for (const entry of live.values()) entry.session.dispose();
	live.clear();
}
