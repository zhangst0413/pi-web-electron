import { NextResponse } from "next/server";
import { readConfig, saveConfig } from "@/lib/harness";
import type { Config } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
	return NextResponse.json(readConfig());
}

export async function PUT(request: Request) {
	try {
		const patch = (await request.json()) as Partial<Config>;
		return NextResponse.json(await saveConfig(patch));
	} catch (error) {
		return NextResponse.json({ error: errorText(error) }, { status: 400 });
	}
}

function errorText(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}
