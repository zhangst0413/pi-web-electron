/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

// Starts the Pi Web server for the desktop shell as a child process. The child
// is the Electron binary running as plain Node (`ELECTRON_RUN_AS_NODE`), so no
// separate Node.js install is needed; it runs the same launcher the `pi-web`
// command runs, which in turn spawns Next.js.

const { spawn, spawnSync } = require("node:child_process");
const { createWriteStream, existsSync, mkdirSync } = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const HOST = "127.0.0.1";
const DEFAULT_PORT = 30141;
const PORT_ATTEMPTS = 20;
const READY_TIMEOUT_MS = 240_000;
const READY_POLL_MS = 500;

function canListen(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen({ port, host: HOST }, () => probe.close(() => resolve(true)));
  });
}

/** The same port on every launch while it is free, which keeps localStorage (theme, prefs) stable. */
async function findPort(preferred) {
  for (let port = preferred; port < preferred + PORT_ATTEMPTS; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`No free port between ${preferred} and ${preferred + PORT_ATTEMPTS - 1}.`);
}

function ping(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(true);
    });
    request.setTimeout(5_000, () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function preferredPort() {
  const configured = Number(process.env.PI_WEB_DESKTOP_PORT);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_PORT;
}

/**
 * `dev` runs `next dev` (no build needed); otherwise the built server is
 * started through `bin/pi-web.js`, exactly as the `pi-web` command does.
 *
 * @returns {Promise<{ url: string, stop: () => void }>}
 */
async function startPiWebServer({ appRoot, dataDir, dev, log = () => {} }) {
  const port = await findPort(preferredPort());
  const url = `http://${HOST}:${port}`;

  // pi's agent directory (sessions, settings, run records) moves with the rest.
  const agentDir = process.env.PI_CODING_AGENT_DIR?.trim() || path.join(dataDir, "agent");
  mkdirSync(agentDir, { recursive: true });
  const logsDir = path.join(dataDir, "logs");
  mkdirSync(logsDir, { recursive: true });
  const logStream = createWriteStream(path.join(logsDir, "server.log"), { flags: "a" });
  const write = (chunk) => {
    const text = chunk.toString();
    logStream.write(text);
    log(text);
  };

  const args = dev
    ? [path.join(appRoot, "node_modules", "next", "dist", "bin", "next"), "dev", "-H", HOST, "-p", String(port)]
    : [path.join(appRoot, "bin", "pi-web.js"), "--no-open", "-H", HOST, "-p", String(port)];

  const child = spawn(process.execPath, args, {
    cwd: appRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PI_WEB_NO_OPEN: "1",
      PI_CODING_AGENT_DIR: agentDir,
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", write);
  child.stderr.on("data", write);

  let exit = null;
  child.once("exit", (code, signal) => {
    exit = { code, signal };
    write(`\n[pi-web] server exited (code=${code ?? "-"}, signal=${signal ?? "-"})\n`);
  });
  child.once("error", (error) => {
    exit = { code: null, signal: null, error };
    write(`\n[pi-web] server failed to start: ${error.message}\n`);
  });

  const deadline = Date.now() + READY_TIMEOUT_MS;
  let ready = false;
  while (Date.now() < deadline) {
    if (exit) {
      const reason = exit.error?.message ?? `exit code ${exit.code ?? "unknown"}`;
      logStream.end();
      throw new Error(`The Pi Web server stopped during startup (${reason}). See ${path.join(logsDir, "server.log")}.`);
    }
    if (await ping(url)) {
      ready = true;
      break;
    }
    await delay(READY_POLL_MS);
  }
  if (!ready) {
    stopChild(child);
    logStream.end();
    throw new Error(`The Pi Web server did not answer on ${url} within ${Math.round(READY_TIMEOUT_MS / 1000)}s. See ${path.join(logsDir, "server.log")}.`);
  }

  return {
    url,
    stop() {
      if (child.exitCode === null && child.signalCode === null) stopChild(child);
      logStream.end();
    },
  };
}

/** Whether a built server is present; without one the shell falls back to `next dev`. */
function hasBuild(appRoot) {
  return existsSync(path.join(appRoot, ".next", "BUILD_ID"));
}

// The launcher spawns Next.js itself; on Windows a plain kill leaves that
// grandchild behind, so take the whole tree.
function stopChild(child) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  child.kill("SIGTERM");
}

module.exports = { startPiWebServer, hasBuild };
