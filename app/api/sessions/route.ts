// GET /api/sessions             列出所有会话
// POST /api/sessions {cwd?}     在指定目录新建会话，返回 { id }
import { NextResponse } from "next/server";
import { errorText, listSessions, newSession } from "@/lib/harness";

export const dynamic = "force-dynamic";

/** 会话列表（含磁盘历史 + 尚未保存的新会话），已按最近修改时间排序。 */
export async function GET() {
	return NextResponse.json(await listSessions());
}

/** 新建会话；body 里的 cwd 省略时使用第一个工作目录。 */
export async function POST(request: Request) {
	try {
		// `.catch(() => ({}))` 容忍空 body：解析失败就当成空对象。
		const { cwd } = (await request.json().catch(() => ({}))) as { cwd?: string };
		return NextResponse.json({ id: await newSession(cwd) });
	} catch (error) {
		return NextResponse.json({ error: errorText(error) }, { status: 400 });
	}
}
