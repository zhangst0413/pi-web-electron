import { NextResponse } from "next/server";
import { errorText, listSessions, newSession } from "@/lib/harness";

export const dynamic = "force-dynamic";

export async function GET() {
	return NextResponse.json(await listSessions());
}

export async function POST(request: Request) {
	try {
		const { cwd } = (await request.json().catch(() => ({}))) as { cwd?: string };
		return NextResponse.json({ id: await newSession(cwd) });
	} catch (error) {
		return NextResponse.json({ error: errorText(error) }, { status: 400 });
	}
}
