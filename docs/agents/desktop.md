# Desktop shell (Electron)

The desktop shell wraps the unchanged Pi Web server in an Electron window. It is
a thin launcher, not a second distribution of the UI: the page it shows is the
same Next.js app a browser gets.

Files: `electron/main.js`, `electron/preload.js`, `electron/server.js`,
`electron/paths.js`, `electron-builder.yml`, `lib/desktop-bridge.ts`, the
desktop branch in `lib/browser-notifications.ts` and
`deliverSessionNotification` in `components/AppShell.tsx`.

## Starting up

`electron/main.js` resolves a data folder (`electron/paths.js`), starts the
server as a child process, then loads its URL:

- **Packaged** (`app.isPackaged`): `resources/app` holds the built app. The child
  is the Electron binary itself with `ELECTRON_RUN_AS_NODE=1`, so no Node.js
  install is needed; it runs `bin/pi-web.js --no-open`, i.e. the exact launcher
  the `pi-web` command runs, which in turn spawns `next start`. Next and
  node-pty load files by real path, which is why `electron-builder.yml` sets
  `asar: false`.
- **Development** (`npm run desktop`): the repo root is `appRoot`. A production
  build is used when `.next/BUILD_ID` exists; otherwise (and with
  `PI_WEB_DESKTOP_DEV=1`) it runs `next dev`, so no build is needed to try the
  shell. `PI_WEB_DESKTOP_URL=http://127.0.0.1:30141 npm run desktop` instead
  attaches the window to an already running server (`npm run dev`).

The port is the first free one from `PI_WEB_DESKTOP_PORT` (default 30141), so a
second instance does not fight over it; the single-instance lock means a second
launch focuses the first window instead. The window waits for the URL to answer
before `loadURL`, and the server log goes to `<data>/logs/server.log`.

Stopping is `taskkill /T` on Windows (the launcher's `next start` grandchild
would otherwise survive) and `SIGTERM` elsewhere.

## Data location

Everything the app writes lives beside the executable, not on C:

```
<install dir>/pi-web-data/
  agent/            PI_CODING_AGENT_DIR: sessions, settings.json, models.json, MCP…
  chromium/         Electron's userData: localStorage (theme, prefs), caches
  logs/server.log   the child process's output
```

`PI_WEB_DESKTOP_DATA_DIR` overrides the folder. A read-only install directory (a
per-machine install under Program Files) falls back to Electron's userData
folder; the shell never fails to start over it.

New sessions still default to `~/pi-cwd/<YYYYMMDD>` (`lib/default-cwd.ts`), the
same as the web UI: the setting is pi's, not the shell's.

## Notifications

The web client already decides when to notify (`deliverSessionNotification`,
`lib/browser-notifications.ts`). Inside Electron, `electron/preload.js` exposes
`window.piWebDesktop` and:

1. `deliverSessionNotification` skips the `Notification.permission` dance, which
   the shell does not have.
2. `showBrowserNotification` hands the payload to `notifyDesktop` before the
   service-worker and window paths, so there is exactly one notification. It
   reports `"desktop"` as the delivery; a throwing bridge (closed IPC) falls back
   to the browser paths instead of losing the notice.
3. The main process flashes the taskbar (`flashFrame`, cleared on window focus)
   and shows a native `Notification`. A click focuses the window and loads the
   finished chat's `/?session=<id>`.

`lib/desktop-bridge.ts` is the only page-side view of the bridge: an optional
`window.piWebDesktop`, so the browser build is unaffected. Keep it that way —
the shell must not add Pi Web-only options to the web UI.

## Icons

Three places need the app icon, and each one takes a different file:

| Where | File |
| --- | --- |
| The window (taskbar button, Alt-Tab) | `public/icons/icon.ico`, via `BrowserWindow`'s `icon` |
| `Pi Web.exe`, the installer, the uninstaller | `electron/build-resources/icon.ico` |
| The browser tab and the PWA manifest | `public/icons/icon-192.png`, `icon-512.png` |

Both `.ico` files are the same multi-size icon (16, 24, 32, 48, 64, 128, 256).
Do not hand Windows a PNG for the window or the exe: it renders the 16/24/32 px
variants itself and falls back to the Electron icon, which is exactly how the
default Electron logo ended up in the taskbar. Regenerate after changing the
artwork:

```bash
python -c "from PIL import Image; Image.open('public/icons/icon-512.png').convert('RGBA').save('electron/build-resources/icon.ico', format='ICO', sizes=[(256,256),(128,128),(64,64),(48,48),(32,32),(24,24),(16,16)])"
cp electron/build-resources/icon.ico public/icons/icon.ico
```

## Building

```bash
npm run desktop:pack   # next build + electron-builder --dir → desktop-dist/win-unpacked
npm run desktop:dist   # next build + electron-builder → NSIS installer
```

`npm run build` (webpack) must run before packaging: the packaged app carries
`.next`. Do not run it as part of `npm run dev` (see AGENTS.md).

### Downloads go through mirrors

Every download the desktop scripts cause is routed by `electron/mirrors.js`, so a
network that cannot reach GitHub still builds:

| What | Mirror variable | Default |
| --- | --- | --- |
| Electron runtime zip | `ELECTRON_MIRROR` | `https://npmmirror.com/mirrors/electron/` |
| NSIS, 7zip, icons | `ELECTRON_BUILDER_BINARIES_MIRROR` | `https://npmmirror.com/mirrors/electron-builder-binaries/` |

Defaults live in `package.json`'s `config` block (npm exports them as
`npm_package_config_*`, which both `@electron/get` and electron-builder read).
`bin/desktop-build.js` also sets the two variables explicitly, so the mirror
applies even when electron-builder is started directly. An environment variable
always wins; set it to the GitHub URL to go back to the default source.

`electronDist: node_modules/electron/dist` in `electron-builder.yml` is the
second half of the speed-up: electron-builder copies the distribution the
electron devDependency already unpacked instead of downloading and extracting
its own 158 MB zip on every build. `bin/ensure-electron.js` runs first and
fetches that distribution once through the mirror, printing the override
variable and failing early if the mirror is unreachable.

### What the build does not carry

- `!node_modules/@img/**` — `images.unoptimized` is set in `next.config.ts`, so
  sharp is never imported (19 MB). Next's `@next/swc-*` package must stay:
  `next start` compiles `next.config.ts` with it.
- Only NSIS is targeted. The portable target re-packs the whole app into a
  second self-extracting exe and doubles build time; add `- portable` under
  `win.target` when a single-file build is actually needed.
- `npmRebuild: false` is deliberate: node-pty ships N-API prebuilds that load in
  both Node and Electron, and the default rebuild would demand a full Visual
  Studio toolchain.

Artifact names live on the target, not under `win`: `artifactName` there does
not expand `${target}`.
