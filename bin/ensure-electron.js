/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

// electron-builder copies the Electron distribution from `node_modules/electron/dist`
// (electronDist in electron-builder.yml) instead of downloading its own 158 MB
// zip. That folder is created by the electron devDependency, which downloads it
// lazily on first use. Make sure it is there before packaging, and fail with a
// mirror hint instead of electron-builder's "electronDist does not exist".

const { existsSync, readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const { resolveMirrors, withMirrorEnv } = require("../electron/mirrors");

function electronPackageDir() {
  try {
    return resolve(require.resolve("electron/package.json", { paths: [process.cwd()] }), "..");
  } catch {
    return null;
  }
}

function installedElectron(packageDir) {
  const pathFile = join(packageDir, "path.txt");
  if (!existsSync(pathFile)) return null;
  const executable = join(packageDir, "dist", readFileSync(pathFile, "utf8").trim());
  return existsSync(executable) ? executable : null;
}

function ensureElectron() {
  const packageDir = electronPackageDir();
  if (!packageDir) {
    console.error("The electron devDependency is missing. Run `npm install` first.");
    process.exit(1);
  }

  const existing = installedElectron(packageDir);
  if (existing) return existing;

  const mirrors = resolveMirrors();
  console.log(`Downloading the Electron runtime from ${mirrors.electron} (once, cached in node_modules/electron/dist)…`);
  const result = spawnSync(process.execPath, [join(packageDir, "install.js")], {
    stdio: "inherit",
    env: withMirrorEnv(),
  });
  const installed = installedElectron(packageDir);
  if (result.status !== 0 || !installed) {
    console.error([
      "",
      "Could not download the Electron runtime from the mirror.",
      "Try another mirror, then run the command again:",
      "  ELECTRON_MIRROR=https://github.com/electron/electron/releases/download/ npm run desktop:dist",
      `  ELECTRON_MIRROR=<your mirror> ELECTRON_BUILDER_BINARIES_MIRROR=<your mirror> npm run ${process.env.npm_lifecycle_event ?? "desktop:dist"}`,
      "",
    ].join("\n"));
    process.exit(1);
  }
  return installed;
}

if (require.main === module) {
  const executable = ensureElectron();
  console.log(`Electron ready: ${executable}`);
}

module.exports = { ensureElectron };
