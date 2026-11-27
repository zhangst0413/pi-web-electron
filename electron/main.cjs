// electron/main.cjs —— 桌面端外壳（Electron 主进程）。
//
// 它做三件事：
//   1. 如果 127.0.0.1:4311 上还没有 Next.js 服务，就自己起一个（打包后用 start，开发时用 dev）；
//   2. 打开一个窗口加载这个地址；
//   3. 提供「选择文件夹」的原生对话框（通过 IPC 暴露给页面）。
//
// 给 Python 程序员的提示：
//   - 文件后缀 .cjs 表示"按 CommonJS 解析"，所以用 require() 而不是 import。
//   - 主进程 = 有系统权限的 Node.js 进程；页面（渲染进程）跑在沙箱里，
//     两者只能通过 ipcMain / ipcRenderer 通信。
//   - `?` 与 `??` 分别是"可能为空时短路"和"取默认值"，`?.` 等价于 Python 的 `if x is not None`。
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

/** 应用根目录（electron/main.cjs 的上一级）。 */
const ROOT = path.join(__dirname, "..");
/** Next.js 固定监听的本地地址；端口写死是为了让「复用已有服务」的逻辑简单。 */
const URL = "http://127.0.0.1:4311";
/** 存在 .next/BUILD_ID 说明已经 `next build` 过，应该用 start 跑生产版本。 */
const PROD = existsSync(path.join(ROOT, ".next", "BUILD_ID"));
/**
 * 数据目录：优先用 HARNESS_DATA；打包后放 Electron userData（用户可写、卸载不丢），
 * 开发时放仓库下的 ./data。
 */
const DATA_DIR =
	process.env.HARNESS_DATA ||
	(app.isPackaged ? path.join(app.getPath("userData"), "data") : path.join(ROOT, "data"));

// Windows 任务栏图标分组需要这个 ID。
app.setAppUserModelId("com.pi.harness.desktop");

/** 我们启动的 Next 子进程（复用已有服务时为 undefined）。 */
let server;

/** 探测一次 4311 端口是否已经有服务在响应，1 秒超时。 */
function ping() {
	return new Promise((resolve) => {
		const request = http.get(URL, (response) => {
			response.resume(); // 丢掉响应体，只关心"连得上"
			resolve(true);
		});
		request.setTimeout(1000, () => request.destroy());
		request.on("error", () => resolve(false));
	});
}

/** 轮询等待 Next 服务可用（最多 180 秒，首次编译可能很慢）。 */
async function waitForServer() {
	const deadline = Date.now() + 180_000;
	while (Date.now() < deadline) {
		if (await ping()) return;
		await new Promise((resolve) => setTimeout(resolve, 400));
	}
	throw new Error(`Next.js did not start on ${URL}`);
}

async function main() {
	// 如果 `npm run dev` 已经在跑，就直接复用，不重复启动。
	if (!(await ping())) {
		const nextCli = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
		// ELECTRON_RUN_AS_NODE=1：让 Electron 二进制以普通 Node 的形式运行 next 脚本。
		server = spawn(process.execPath, [nextCli, PROD ? "start" : "dev", "-H", "127.0.0.1", "-p", "4311"], {
			cwd: ROOT,
			env: {
				...process.env,
				ELECTRON_RUN_AS_NODE: "1",
				HARNESS_DATA: DATA_DIR,
				// 打包后默认在用户主目录开新会话；开发时默认用仓库目录。
				HARNESS_DEFAULT_CWD: app.isPackaged ? os.homedir() : ROOT,
				NEXT_TELEMETRY_DISABLED: "1",
			},
			stdio: "ignore",
		});
		await waitForServer();
	}

	const window = new BrowserWindow({
		width: 1200,
		height: 840,
		backgroundColor: "#111214", // 与页面背景一致，避免启动时白闪
		autoHideMenuBar: true,
		icon: path.join(__dirname, "icon.png"),
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			// 安全三件套：上下文隔离 + 沙箱 + 页面只能通过 preload 暴露的 API 访问系统能力。
			contextIsolation: true,
			sandbox: true,
			spellcheck: false,
		},
	});
	window.loadURL(URL);

	// 页面调用 window.harness.pickDirectory() 时，会走到这里弹系统目录选择框。
	ipcMain.handle("pick-directory", async (_event, current) => {
		const result = await dialog.showOpenDialog(window, { properties: ["openDirectory"], defaultPath: current });
		return result.canceled ? null : result.filePaths[0];
	});
}

app.whenReady().then(main).catch((error) => {
	console.error(error);
	app.quit();
});
// 关掉窗口即退出应用（这是一个单窗口工具，不需要 macOS 那种常驻行为）。
app.on("window-all-closed", () => app.quit());
// 退出前一定要杀掉我们启动的 Next 子进程，否则端口会被占住。
app.on("before-quit", stopServer);

/** 停止 Next 子进程；Windows 需要 taskkill /T 才能把子进程树一起结束。 */
function stopServer() {
	if (!server) return;
	if (process.platform === "win32") {
		spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
	} else {
		server.kill();
	}
	server = undefined;
}
