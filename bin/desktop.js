/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

// `npm run desktop` shows the built frontend in an Electron window, so the
// build it serves has to be the current source. When `.next` holds no build, or
// a source file changed after it, `next build` runs before the window opens;
// an unchanged tree reuses the existing build and starts straight away.
//
// The build-free paths stay as they were: `PI_WEB_DESKTOP_DEV=1` runs the
// desktop on `next dev`, and `PI_WEB_DESKTOP_URL=http://…:30141` attaches the
// window to a server already running (e.g. `npm run dev`).

const { spawn, spawnSync } = require("node:child_process");
const { existsSync, readdirSync, statSync } = require("node:fs");
const path = require("node:path");
const { ensureElectron } = require("./ensure-electron");

const projectDir = path.join(__dirname, "..");
const buildIdPath = path.join(projectDir, ".next", "BUILD_ID");

// What `next build` reads: the app's own sources and the configs around them.
const SOURCE_DIRS = ["app", "components", "hooks", "lib"];
const SOURCE_FILES = [
  "next.config.ts",
  "tsconfig.json",
  "postcss.config.mjs",
  "tailwind.config.ts",
  "proxy.ts",
  "instrumentation.ts",
  "instrumentation-node.ts",
  "package.json",
  "package-lock.json",
];

/** A file's mtime, or 0 when it cannot be read. */
function mtime(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/** The newest source mtime under a directory, tests excluded: they are not built. */
function newestMtime(dir) {
  if (!existsSync(dir)) return 0;
  let newest = mtime(dir);
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const entryPath = path.join(entry.parentPath ?? dir, entry.name);
    if (entry.isDirectory()) {
      // A folder's own mtime changes when a file is added, renamed or removed.
      newest = Math.max(newest, mtime(entryPath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".test.mjs") || entry.name.endsWith(".map")) continue;
    newest = Math.max(newest, mtime(entryPath));
  }
  return newest;
}

/** The newest mtime of everything the build depends on. */
function newestSourceMtime(root = projectDir) {
  let newest = 0;
  for (const dir of SOURCE_DIRS) newest = Math.max(newest, newestMtime(path.join(root, dir)));
  for (const file of SOURCE_FILES) newest = Math.max(newest, mtime(path.join(root, file)));
  return newest;
}

/** Whether the build in `.next` is missing or older than the source it serves. */
function buildIsStale(root = projectDir) {
  const builtAt = mtime(path.join(root, ".next", "BUILD_ID"));
  if (!builtAt) return true;
  return newestSourceMtime(root) > builtAt;
}

function build(root = projectDir) {
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const result = spawnSync(process.execPath, [nextBin, "build"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  if (result.status !== 0) {
    console.error("The frontend build failed, so the desktop window was not opened.");
    process.exit(result.status ?? 1);
  }
}

if (require.main === module) {
  const executable = ensureElectron();

  const attaches = Boolean(process.env.PI_WEB_DESKTOP_URL?.trim());
  const dev = process.env.PI_WEB_DESKTOP_DEV === "1";
  if (!attaches && !dev && buildIsStale()) {
    console.log(`Building the frontend for the desktop window${existsSync(buildIdPath) ? " (the existing build is out of date)" : ""}…`);
    build();
  }

  const child = spawn(executable, [projectDir], { cwd: projectDir, stdio: "inherit" });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

module.exports = { build, buildIsStale, newestSourceMtime };
