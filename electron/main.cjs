// Electron shell: start (or reuse) the Next.js server, then show it in a window.
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const URL = "http://127.0.0.1:4311";
const PROD = existsSync(path.join(ROOT, ".next", "BUILD_ID"));

let server;

function ping() {
	return new Promise((resolve) => {
		const request = http.get(URL, (response) => {
			response.resume();
			resolve(true);
		});
		request.setTimeout(1000, () => request.destroy());
		request.on("error", () => resolve(false));
	});
}

async function waitForServer() {
	const deadline = Date.now() + 180_000;
	while (Date.now() < deadline) {
		if (await ping()) return;
		await new Promise((resolve) => setTimeout(resolve, 400));
	}
	throw new Error(`Next.js did not start on ${URL}`);
}

async function main() {
	// `npm run dev` already serving the app? Then just attach to it.
	if (!(await ping())) {
		const nextCli = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
		server = spawn(process.execPath, [nextCli, PROD ? "start" : "dev", "-H", "127.0.0.1", "-p", "4311"], {
			cwd: ROOT,
			env: {
				...process.env,
				ELECTRON_RUN_AS_NODE: "1",
				HARNESS_DATA: process.env.HARNESS_DATA || path.join(ROOT, "data"),
				NEXT_TELEMETRY_DISABLED: "1",
			},
			stdio: "ignore",
		});
		await waitForServer();
	}

	const window = new BrowserWindow({
		width: 1200,
		height: 840,
		backgroundColor: "#111214",
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			contextIsolation: true,
			sandbox: true,
		},
	});
	window.loadURL(URL);

	ipcMain.handle("pick-directory", async (_event, current) => {
		const result = await dialog.showOpenDialog(window, { properties: ["openDirectory"], defaultPath: current });
		return result.canceled ? null : result.filePaths[0];
	});
}

app.whenReady().then(main).catch((error) => {
	console.error(error);
	app.quit();
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", stopServer);

function stopServer() {
	if (!server) return;
	if (process.platform === "win32") {
		spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
	} else {
		server.kill();
	}
	server = undefined;
}
