// POST   /api/workspaces        {path}  把一个目录加入工作目录列表
// DELETE /api/workspaces?path=…         从列表中移除（不删除该目录的会话历史）
import { NextResponse } from "next/server";
import { addWorkspace, errorText, removeWorkspace } from "@/lib/harness";

export const dynamic = "force-dynamic";

/** 添加目录。返回更新后的完整配置，前端直接 setConfig 即可。 */
export async function POST(request: Request) {
	try {
		const { path } = (await request.json()) as { path?: string };
		if (!path?.trim()) throw new Error("缺少目录路径");
		return NextResponse.json(addWorkspace(path));
	} catch (error) {
		return NextResponse.json({ error: errorText(error) }, { status: 400 });
	}
}

/** 移除目录。路径通过 query string 传递（目录内含 / 与 \，需要 encodeURIComponent）。 */
export async function DELETE(request: Request) {
	try {
		const path = new URL(request.url).searchParams.get("path");
		if (!path?.trim()) throw new Error("缺少目录路径");
		return NextResponse.json(removeWorkspace(path));
	} catch (error) {
		return NextResponse.json({ error: errorText(error) }, { status: 400 });
	}
}
