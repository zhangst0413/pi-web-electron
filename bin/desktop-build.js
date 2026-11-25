/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

// Runs electron-builder with the mirror environment set (electron/mirrors.js) so
// neither the Electron runtime nor its toolsets are fetched from GitHub. The
// Electron runtime is taken from node_modules/electron/dist, downloaded once by
// bin/ensure-electron.js instead of electron-builder's own 158 MB zip.

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { ensureElectron } = require("./ensure-electron");
const { resolveMirrors, withMirrorEnv } = require("../electron/mirrors");

const dirOnly = process.argv.includes("--dir");
const projectDir = path.join(__dirname, "..");
const builderBin = path.join(projectDir, "node_modules", "electron-builder", "out", "cli", "cli.js");

if (!require("node:fs").existsSync(builderBin)) {
  console.error("electron-builder is not installed. Run `npm install` first.");
  process.exit(1);
}

ensureElectron();

const mirrors = resolveMirrors();
console.log(`Using mirrors: electron=${mirrors.electron} binaries=${mirrors.binaries}`);

const result = spawnSync(
  process.execPath,
  [builderBin, "--config", "electron-builder.yml", ...(dirOnly ? ["--dir"] : [])],
  {
    cwd: projectDir,
    stdio: "inherit",
    env: withMirrorEnv(),
  },
);

process.exit(result.status ?? 1);
