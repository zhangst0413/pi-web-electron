// POST   /api/sessions/[id]  {text} 或 {abort: true}
// DELETE /api/sessions/[id]  删除会话及其历史文件
//
// 说明：`[id]` 是 Next.js 的动态路由段，等价于 Python 框架里的
// `/api/sessions/<id>`；对应的 id 通过第二个参数 params 拿到（这里是异步的 Promise）。
import { NextResponse } from "next/server";
import { abortRun, deleteSession, errorText, sendPrompt } from "@/lib/harness";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** POST { text } 发送一轮对话；POST { abort: true } 中止正在运行的那一轮。 */
export async function POST(request: Request, { params }: Context) {
	const { id } = await params;
	try {
		const body = (await request.json()) as { text?: string; abort?: boolean };
		if (body.abort) await abortRun(id);
		else await sendPrompt(id, String(body.text ?? ""));
		return NextResponse.json({ ok: true });
	} catch (error) {
		return NextResponse.json({ error: errorText(error) }, { status: 400 });
	}
}

/** 删除会话：释放内存中的 agent 实例并删除磁盘上的 JSONL 历史。 */
export async function DELETE(_request: Request, { params }: Context) {
	await deleteSession((await params).id);
	return NextResponse.json({ ok: true });
}
