import { NextResponse } from "next/server";
import { listSessions, newSession } from "@/lib/harness";

export const dynamic = "force-dynamic";

export async function GET() {
	return NextResponse.json(await listSessions());
}

export async function POST() {
	try {
		return NextResponse.json({ id: await newSession() });
	} catch (error) {
		return NextResponse.json({ error: errorText(error) }, { status: 400 });
	}
}

function errorText(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}
