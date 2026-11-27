"use client";

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

const Markdown = () => <MarkdownTextPrimitive className="markdown" remarkPlugins={[remarkGfm]} />;
const Plain = ({ text }: TextMessagePartProps) => <div className="plain">{text}</div>;
const Cursor = () => <span className="cursor" />;

function ToolCall({ toolName, args, result, isError }: ToolCallMessagePartProps) {
	const [open, setOpen] = useState(false);
	const output = typeof result === "string" ? result : result === undefined ? "" : JSON.stringify(result, null, 2);
	const summary = summarize(args);
	return (
		<div className={isError ? "tool error" : "tool"}>
			<button type="button" className="tool-head" onClick={() => setOpen((value) => !value)}>
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

function summarize(args: unknown) {
	if (!args || typeof args !== "object") return "";
	const values = Object.values(args as Record<string, unknown>).filter((value) => typeof value === "string");
	return (values[0] as string | undefined)?.slice(0, 80) ?? "";
}

const assistantParts = { Text: Markdown, tools: { Fallback: ToolCall }, Empty: Cursor };
const userParts = { Text: Plain };

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

/** Appends streamed text to the trailing assistant message. */
function appendDelta(messages: ThreadMessageLike[], text: string): ThreadMessageLike[] {
	const last = messages.at(-1);
	if (!last || last.role !== "assistant" || typeof last.content === "string") return messages;
	const content = [...last.content];
	const index = content.length - 1;
	const part = content[index];
	if (part?.type === "text") content[index] = { ...part, text: part.text + text };
	else content.push({ type: "text", text });
	return [...messages.slice(0, -1), { ...last, content }];
}

export function Chat({ sessionId, onActivity }: { sessionId: string; onActivity: () => void }) {
	const [messages, setMessages] = useState<ThreadMessageLike[]>([]);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState("");
	const runningRef = useRef(false);
	const activityRef = useRef(onActivity);
	activityRef.current = onActivity;

	useEffect(() => {
		const source = new EventSource(`/api/sessions/${sessionId}/events`);
		source.onmessage = (event) => {
			const payload = JSON.parse(event.data) as WireEvent;
			if (payload.type === "sync") {
				setMessages(payload.messages);
				setRunning(payload.running);
				if (payload.running !== runningRef.current) {
					runningRef.current = payload.running;
					activityRef.current();
				}
				if (payload.running) setError("");
			} else if (payload.type === "delta") {
				setMessages((previous) => appendDelta(previous, payload.text));
			} else {
				setError(payload.message);
			}
		};
		return () => source.close();
	}, [sessionId]);

	const onNew = async (message: AppendMessage) => {
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
