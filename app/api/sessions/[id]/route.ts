import { NextResponse } from "next/server";
import { abortRun, deleteSession, errorText, sendPrompt } from "@/lib/harness";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** POST { text } sends a turn, POST { abort: true } stops the running one. */
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

export async function DELETE(_request: Request, { params }: Context) {
	await deleteSession((await params).id);
	return NextResponse.json({ ok: true });
}

