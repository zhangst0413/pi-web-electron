// GET /api/sessions/[id]/events
//
// SSE（Server-Sent Events）：一条永不结束的 HTTP 响应，服务端不断往里写
// `data: {...}\n\n` 这样的文本块，浏览器用 EventSource 逐条接收。
// 相当于 Python 里的 StreamingResponse / websocket 的简化版（单向：服务端 -> 浏览器）。
import { errorText, subscribe } from "@/lib/harness";
import type { WireEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** 先发一次全量 sync，之后交替推送 delta（文本增量）与 sync（结构变化）。 */
export async function GET(request: Request, { params }: Context) {
	const { id } = await params;
	// TextEncoder 把 JS 字符串编码成 UTF-8 字节（SSE 的通用写法）。
	const encoder = new TextEncoder();
	let closed = false; // 流是否已关闭（关闭后再 enqueue 会抛错）
	let unsubscribe: (() => void) | undefined;

	const stream = new ReadableStream({
		async start(controller) {
			/** 把一条事件写给浏览器。任何失败都视为连接断开。 */
			const send = (event: WireEvent) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
				} catch {
					closed = true;
				}
			};

			// 订阅会话事件：内部会先回调一次全量 sync，再把回调登记到监听者集合。
			try {
				unsubscribe = await subscribe(id, send);
			} catch (error) {
				// 例如 API Key 未配置 / 会话不存在：用一条 error 事件告知前端后结束流。
				send({ type: "error", message: errorText(error) });
				closed = true;
				controller.close();
				return;
			}

			// 订阅期间浏览器可能已经断开，这里再检查一次。
			if (request.signal.aborted) {
				closed = true;
				unsubscribe();
				controller.close();
				return;
			}

			// 浏览器关闭页面 / 切换会话时触发 abort：取消订阅并关闭流。
			request.signal.addEventListener("abort", () => {
				closed = true;
				unsubscribe?.();
				try {
					controller.close();
				} catch {
					// 已经关闭过了，忽略
				}
			});
		},
		// 消费者主动取消读取时也会走到这里，同样需要清理订阅。
		cancel() {
			closed = true;
			unsubscribe?.();
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			// no-transform 防止中间代理压缩/缓冲，保证事件立即到达。
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			// 让 nginx 之类的反向代理不要缓冲这条流。
			"X-Accel-Buffering": "no",
		},
	});
}
