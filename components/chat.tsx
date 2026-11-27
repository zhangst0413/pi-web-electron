"use client";

/**
 * chat.tsx —— 聊天界面。基于 assistant-ui 的「外部状态」模式：
 * 消息列表由我们自己的 useState 维护（数据来自 SSE），
 * assistant-ui 只负责渲染和输入框交互。
 *
 * 给 Python 程序员的提示：
 *   - `"use client"` 表示这个文件在浏览器里运行（而不是服务端渲染）。
 *   - 组件就是一个函数，返回 JSX（很像 Jinja 模板 + 组件按需重渲染）。
 *   - `useState` 相当于一个可变的局部状态字段；`useEffect` 相当于"挂载/依赖变化时执行一次"的钩子。
 *   - 这里没有 class，函数体内的每个 `function` 都是闭包。
 */

import {
	AssistantRuntimeProvider,
	AuiIf,
	ComposerPrimitive,
	MessagePrimitive,
	type TextMessagePartProps,
	ThreadPrimitive,
	type ToolCallMessagePartProps,
	useAuiState,
	useExternalStoreRuntime,
	type AppendMessage,
	type ThreadMessageLike,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { useEffect, useRef, useState } from "react";
import remarkGfm from "remark-gfm";
import type { WireEvent } from "@/lib/types";

/** assistant 消息用 Markdown 渲染；MarkdownTextPrimitive 在流式追加时能增量解析。 */
const Markdown = () => <MarkdownTextPrimitive className="markdown" remarkPlugins={[remarkGfm]} />;
/** 用户消息按纯文本显示，避免误把用户输入当 Markdown 解析。 */
const Plain = ({ text }: TextMessagePartProps) => <div className="plain">{text}</div>;
/** 正在生成但还没有内容时显示的闪烁光标。 */
const Cursor = () => <span className="cursor" />;

/**
 * 一次工具调用的折叠卡片：默认只显示「工具名 + 一行摘要」，
 * 点击后展开查看完整参数与输出。
 */
function ToolCall({ toolName, args, result, isError }: ToolCallMessagePartProps) {
	const [open, setOpen] = useState(false);
	// result 可能是字符串、对象或 undefined（还没返回）。统一转成可打印的字符串。
	const output = typeof result === "string" ? result : result === undefined ? "" : JSON.stringify(result, null, 2);
	const summary = summarize(args);
	return (
		<div className={isError ? "tool error" : "tool"}>
			<button type="button" className="tool-head" onClick={() => setOpen((value) => !value)}>
				{/* 状态标记：✕ 失败 / … 进行中 / ✓ 完成 */}
				<span className="tool-badge">{isError ? "✕" : result === undefined ? "…" : "✓"}</span>
				<span className="tool-name">{toolName}</span>
				{summary && <span className="tool-summary">{summary}</span>}
			</button>
			{open && (
				<pre className="tool-body">
					{JSON.stringify(args, null, 2)}
					{output ? `\n\n${output}` : ""}
				</pre>
			)}
		</div>
	);
}

/** 取工具参数里第一个字符串值并截断，作为折叠状态下的摘要（例如文件路径）。 */
function summarize(args: unknown) {
	if (!args || typeof args !== "object") return "";
	const values = Object.values(args as Record<string, unknown>).filter((value) => typeof value === "string");
	return (values[0] as string | undefined)?.slice(0, 80) ?? "";
}

// 消息片段的渲染器注册表：assistant 支持 Markdown + 工具卡片，用户只用纯文本。
const assistantParts = { Text: Markdown, tools: { Fallback: ToolCall }, Empty: Cursor };
const userParts = { Text: Plain };

/** 渲染单条消息；根据角色（user / assistant）选择不同的片段组件。 */
function Message() {
	const role = useAuiState((state) => state.message.role);
	return (
		<MessagePrimitive.Root className={`message ${role}`}>
			<MessagePrimitive.Parts
				components={role === "user" ? userParts : assistantParts}
				unstable_showEmptyOnNonTextEnd={false}
			/>
		</MessagePrimitive.Root>
	);
}

/**
 * 把一段流式文本追加到「最后一条 assistant 消息」。
 * 返回新数组（不改原对象），这样 React 才能检测到状态变化。
 */
function appendDelta(messages: ThreadMessageLike[], text: string): ThreadMessageLike[] {
	const last = messages.at(-1);
	// 还没有收到初始 sync（消息列表为空或最后一条不是 assistant）时先忽略，
	// 紧接着到达的 sync 事件会带上完整内容。
	if (!last || last.role !== "assistant" || typeof last.content === "string") return messages;
	const content = [...last.content];
	const index = content.length - 1;
	const part = content[index];
	// 末尾已是文本片段就拼接，否则新起一段（例如工具调用之后又开始输出文本）。
	if (part?.type === "text") content[index] = { ...part, text: part.text + text };
	else content.push({ type: "text", text });
	return [...messages.slice(0, -1), { ...last, content }];
}

/**
 * 聊天面板。`sessionId` 变化时由父组件通过 `key` 强制重建，
 * 因此这里的 SSE 连接只会对应一个固定的会话。
 */
export function Chat({ sessionId, onActivity }: { sessionId: string; onActivity: () => void }) {
	const [messages, setMessages] = useState<ThreadMessageLike[]>([]);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState("");
	// 用 ref 记录上一次的运行状态，避免把 onActivity 放进 effect 依赖导致重连 SSE。
	const runningRef = useRef(false);
	// 始终指向最新的 onActivity 回调（父组件重新渲染时函数引用会变）。
	const activityRef = useRef(onActivity);
	activityRef.current = onActivity;

	// 建立 SSE 连接；组件卸载或 sessionId 变化时关闭。
	useEffect(() => {
		const source = new EventSource(`/api/sessions/${sessionId}/events`);
		source.onmessage = (event) => {
			const payload = JSON.parse(event.data) as WireEvent;
			if (payload.type === "sync") {
				// 全量覆盖：消息列表 + 运行状态。
				setMessages(payload.messages);
				setRunning(payload.running);
				// 运行状态切换时通知父组件刷新侧边栏（running 小圆点）。
				if (payload.running !== runningRef.current) {
					runningRef.current = payload.running;
					activityRef.current();
				}
				if (payload.running) setError("");
			} else if (payload.type === "delta") {
				// 增量文本：只拼到末尾那条消息上。
				setMessages((previous) => appendDelta(previous, payload.text));
			} else {
				setError(payload.message);
			}
		};
		// 清理函数：切换会话或卸载时断开连接，服务端随之取消订阅。
		return () => source.close();
	}, [sessionId]);

	/** 用户按下发送：把消息 POST 给服务端，真正的输出通过 SSE 回来。 */
	const onNew = async (message: AppendMessage) => {
		// 只取文本片段（目前不支持图片输入）。
		const text = message.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n");
		setError("");
		const response = await fetch(`/api/sessions/${sessionId}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text }),
		});
		if (!response.ok) throw new Error((await response.json()).error ?? "发送失败");
	};

	// 把上面的状态接进 assistant-ui，得到处理流式消息 / 停止按钮的运行时。
	const runtime = useExternalStoreRuntime({
		messages,
		isRunning: running,
		convertMessage: (message) => message,
		onNew,
		onCancel: async () => {
			await fetch(`/api/sessions/${sessionId}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ abort: true }),
			});
		},
	});

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<ThreadPrimitive.Root className="thread">
				<ThreadPrimitive.Viewport className="viewport">
					<AuiIf condition={(state) => state.thread.isEmpty}>
						<p className="placeholder">发消息开始对话</p>
					</AuiIf>
					<ThreadPrimitive.Messages components={{ Message }} />
				</ThreadPrimitive.Viewport>

				{/* 会话级错误（API Key 无效、网络中断等） */}
				{error && <div className="error">{error}</div>}

				<ComposerPrimitive.Root className="composer">
					<ComposerPrimitive.Input
						className="composer-input"
						placeholder="输入消息，Enter 发送，Shift+Enter 换行"
						submitMode="enter"
						autoFocus
					/>
					{running ? (
						<button type="button" className="button stop" onClick={() => runtime.thread.cancelRun()}>
							停止
						</button>
					) : (
						<ComposerPrimitive.Send className="button send">发送</ComposerPrimitive.Send>
					)}
				</ComposerPrimitive.Root>
			</ThreadPrimitive.Root>
		</AssistantRuntimeProvider>
	);
}
