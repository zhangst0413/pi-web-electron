/**
 * types.ts —— 全项目共享的类型定义（前后端都会 import）。
 *
 * 可以把它看成 Python 里集中放 TypedDict / dataclass 的 `models.py`：
 * 这里只有类型，没有运行时代码，编译后会被完全擦除。
 */

import type { ThreadMessageLike } from "@assistant-ui/react";

/** assistant-ui 能渲染的一条消息。由服务端从 pi 的原始消息转换而来。 */
export type UiMessage = ThreadMessageLike;

/**
 * 服务端 -> 浏览器的推送事件（走 SSE，也就是一条长连接的 HTTP 流）。
 * `|` 表示「三选一」，类似 Python 的 Union[SyncEvent, DeltaEvent, ErrorEvent]。
 */
export type WireEvent =
	/** 全量快照：前端收到后整体替换消息列表与运行状态。 */
	| { type: "sync"; messages: UiMessage[]; running: boolean }
	/** 增量文本：只追加到当前正在生成的 assistant 消息末尾，省流量。 */
	| { type: "delta"; text: string }
	/** 出错信息（例如 API Key 无效、模型不存在）。 */
	| { type: "error"; message: string };

/** 侧边栏会话列表的一行。 */
export type SessionSummary = {
	id: string;
	/** 显示用的标题（用户命名或首条消息摘要）。 */
	title: string;
	/** 会话所属的工作目录。 */
	cwd: string;
	/** 最后修改时间（毫秒时间戳）。 */
	modified: number;
	/** 是否正在运行，用于侧边栏的小圆点。 */
	running: boolean;
};

/** 应用配置，持久化在 data/config.json。 */
export type Config = {
	apiKey: string;
	model: string;
	/** 侧边栏里可供新建会话的目录列表。 */
	workspaces: string[];
};
