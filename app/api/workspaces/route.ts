import { NextResponse } from "next/server";
import { addWorkspace, errorText, removeWorkspace } from "@/lib/harness";

export const dynamic = "force-dynamic";

/** Add a directory to the workspace list. */
export async function POST(request: Request) {
	try {
		const { path } = (await request.json()) as { path?: string };
		if (!path?.trim()) throw new Error("缺少目录路径");
		return NextResponse.json(addWorkspace(path));
	} catch (error) {
		return NextResponse.json({ error: errorText(error) }, { status: 400 });
	}
}

/** Remove a directory from the workspace list; its sessions stay readable. */
export async function DELETE(request: Request) {
	try {
		const path = new URL(request.url).searchParams.get("path");
		if (!path?.trim()) throw new Error("缺少目录路径");
		return NextResponse.json(removeWorkspace(path));
	} catch (error) {
		return NextResponse.json({ error: errorText(error) }, { status: 400 });
	}
}
