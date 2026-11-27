import { subscribe } from "@/lib/harness";
import type { WireEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** SSE stream: a full sync first, then text deltas and syncs. */
export async function GET(request: Request, { params }: Context) {
	const { id } = await params;
	const encoder = new TextEncoder();
	let closed = false;
	let unsubscribe: (() => void) | undefined;

	const stream = new ReadableStream({
		async start(controller) {
			const send = (event: WireEvent) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
				} catch {
					closed = true;
				}
			};

			try {
				unsubscribe = await subscribe(id, send);
			} catch (error) {
				send({ type: "error", message: error instanceof Error ? error.message : String(error) });
				controller.close();
				closed = true;
				return;
			}

			if (request.signal.aborted) {
				closed = true;
				unsubscribe();
				controller.close();
				return;
			}

			request.signal.addEventListener("abort", () => {
				closed = true;
				unsubscribe?.();
				try {
					controller.close();
				} catch {
					// already closed
				}
			});
		},
		cancel() {
			closed = true;
			unsubscribe?.();
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		},
	});
}
