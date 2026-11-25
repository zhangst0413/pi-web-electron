/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

// Desktop shell for Pi Web: starts the local server, shows it in a window, and
// turns the web client's completion notifications into OS notifications with a
// taskbar flash. All state lives in the data folder chosen by electron/paths.js.

const { app, BrowserWindow, Notification, dialog, ipcMain, shell } = require("electron");
const path = require("node:path");
const { resolveDataDir } = require("./paths");
const { startPiWebServer, hasBuild } = require("./server");

const appRoot = app.isPackaged ? path.join(process.resourcesPath, "app") : path.join(__dirname, "..");

let mainWindow = null;
let server = null;

// Chromium's profile (localStorage: theme, prefs) goes beside pi's sessions in
// the portable data folder, never in %APPDATA%.
const dataDir = resolveDataDir(app);
app.setPath("userData", path.join(dataDir, "chromium"));
// Windows groups taskbar buttons and toasts by this id.
app.setAppUserModelId("com.agegr.piweb.desktop");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => focusWindow());
  app.on("activate", () => {
    if (mainWindow) focusWindow();
    else if (server) createWindow(server.url);
  });
  app.on("before-quit", () => { server?.stop(); server = null; });
  app.on("window-all-closed", () => { app.quit(); });
  app.whenReady().then(boot).catch(fail);
}

async function boot() {
  if (process.env.PI_WEB_DESKTOP_URL?.trim()) {
    // Dev workflow: `npm run dev` already serves the UI on this URL.
    createWindow(process.env.PI_WEB_DESKTOP_URL.trim());
    return;
  }

  // `npm run desktop` without a build still works, through Next's dev server.
  const dev = process.env.PI_WEB_DESKTOP_DEV === "1" || (!app.isPackaged && !hasBuild(appRoot));
  server = await startPiWebServer({
    appRoot,
    dataDir,
    dev,
    log: (text) => process.stdout.write(text),
  });
  createWindow(server.url);
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 480,
    minHeight: 400,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#181818",
    title: "Pi Web",
    // The taskbar and Alt-Tab draw this window icon. A .ico with 16/24/32 px
    // entries keeps those sizes crisp; Windows ignores a PNG here and falls
    // back to the Electron icon.
    icon: path.join(appRoot, "public", "icons", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.removeMenu();
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("focus", () => mainWindow?.flashFrame(false));
  mainWindow.on("closed", () => { mainWindow = null; });

  // A link to another host belongs in the user's browser, not in this shell.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isLocalUrl(target)) return { action: "allow" };
    void shell.openExternal(target);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (isLocalUrl(target)) return;
    event.preventDefault();
    void shell.openExternal(target);
  });

  void mainWindow.loadURL(url);
}

function isLocalUrl(target) {
  try {
    const parsed = new URL(target);
    return parsed.protocol === "http:"
      && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
  } catch {
    return false;
  }
}

function focusWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// The web client sends this instead of a browser notification when it runs in
// the desktop shell (lib/desktop-bridge.ts): the toast and the taskbar flash
// come from here, and clicking the toast opens the chat that finished.
ipcMain.on("pi-web:notify", (_event, payload) => {
  if (!payload || typeof payload.title !== "string") return;
  const { title, body, sessionUrl } = payload;

  if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true);
  if (!Notification.isSupported()) return;

  const notification = new Notification({
    title,
    body: typeof body === "string" ? body : "",
  });
  notification.on("click", () => {
    focusWindow();
    if (!mainWindow) return;
    if (typeof sessionUrl === "string" && sessionUrl.startsWith("/")) {
      void mainWindow.loadURL(`${server?.url ?? ""}${sessionUrl}`);
    }
  });
  notification.show();
});

function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  dialog.showErrorBox("Pi Web could not start", message);
  server?.stop();
  app.exit(1);
}
