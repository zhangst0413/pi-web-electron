/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

// Portable data location for the desktop shell. Pi Web keeps its state in pi's
// agent directory; the shell puts that directory, the Chromium profile and the
// server log in one `pi-web-data` folder beside the executable, so an install on
// another drive keeps its data there instead of on C:.

const fs = require("node:fs");
const path = require("node:path");

function isDirectoryWritable(directory) {
  try {
    fs.mkdirSync(directory, { recursive: true });
    const probe = path.join(directory, `.write-probe-${process.pid}`);
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * `<install dir>/pi-web-data` when that folder can be written, which it is for
 * a per-user install and for any install outside Program Files.
 * `PI_WEB_DESKTOP_DATA_DIR` overrides it. A read-only install folder (a
 * per-machine install under Program Files) falls back to Electron's userData
 * folder, the only other place that is guaranteed writable.
 */
function resolveDataDir(app) {
  const configured = process.env.PI_WEB_DESKTOP_DATA_DIR?.trim();
  if (configured) {
    const directory = path.resolve(configured);
    fs.mkdirSync(directory, { recursive: true });
    return directory;
  }

  // electron-builder's portable target runs the app from a temp extraction
  // folder and names the folder the .exe was launched from here.
  const installDir = process.env.PORTABLE_EXECUTABLE_DIR?.trim()
    || (app.isPackaged ? path.dirname(app.getPath("exe")) : path.join(__dirname, ".."));
  const portable = path.join(installDir, "pi-web-data");
  if (isDirectoryWritable(portable)) return portable;

  const fallback = path.join(app.getPath("userData"), "pi-web-data");
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

module.exports = { resolveDataDir };
