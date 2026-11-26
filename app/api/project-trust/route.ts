import { NextResponse } from "next/server";
import { statSync } from "fs";
import { isAbsolute } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { cwdAccessRefusal } from "@/lib/file-access";
import { invalidateModelsCache } from "@/lib/models-cache";
import { getProjectTrustStatus, trustProject } from "@/lib/project-trust";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { destroyRpcSessionsForCwd, hasBusyRpcSessionForCwd } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function refusal(status: number, reason: string, error: string) {
  return NextResponse.json({ error, reason }, { status });
}

/**
 * The folder: absolute, inside the folders Pi Web may read, then a
 * directory. A relative path is refused rather than resolved against the
 * server process's own folder, and a folder outside those roots gets 403
 * whether or not it exists.
 */
async function validateCwd(value: unknown): Promise<{ cwd: string } | { response: Response }> {
  if (typeof value !== "string" || value.trim() === "") {
    return { response: refusal(400, "cwd-invalid", "cwd required") };
  }
  const cwd = value.trim();
  if (!isAbsolute(cwd)) return { response: refusal(400, "cwd-invalid", "cwd must be absolute") };
  const refused = await cwdAccessRefusal(cwd);
  if (refused) return { response: refused };
  try {
    if (!statSync(cwd).isDirectory()) return { response: refusal(400, "cwd-invalid", "cwd is not a directory") };
  } catch {
    return { response: refusal(400, "cwd-invalid", "cwd does not exist") };
  }
  return { cwd };
}

// GET /api/project-trust?cwd=<folder>: the folder's trust status (ADR 0006).
export async function GET(req: Request) {
  const result = await validateCwd(new URL(req.url).searchParams.get("cwd"));
  if ("response" in result) return result.response;
  try {
    return NextResponse.json(getProjectTrustStatus(result.cwd, getAgentDir()));
  } catch (error) {
    // trust.json unparsable, or locked by another process (the pi CLI) past the
    // store's short wait; trusting would fail the same way right now.
    return NextResponse.json(
      { error: errorMessage(error), reason: "trust-unreadable" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return refusal(403, "request-denied", "Untrusted API request");
  if (!hasJsonContentType(req)) return refusal(415, "content-type", "Content-Type must be application/json");
  try {
    // A body that is not JSON names no cwd.
    const body = await req.json().catch(() => null) as { cwd?: unknown } | null;
    const result = await validateCwd(body?.cwd);
    if ("response" in result) return result.response;

    const agentDir = getAgentDir();
    const current = getProjectTrustStatus(result.cwd, agentDir);
    if (!current.requiresTrust) {
      return refusal(409, "trust-not-required", "This project has no resources that require trust");
    }
    if (hasBusyRpcSessionForCwd(result.cwd)) {
      return refusal(409, "session-busy", "Wait for the active session to finish before trusting this project");
    }

    const status = trustProject(result.cwd, agentDir);
    invalidateModelsCache();
    await destroyRpcSessionsForCwd(result.cwd);
    return NextResponse.json(status);
  } catch (error) {
    return refusal(500, "internal", errorMessage(error));
  }
}
