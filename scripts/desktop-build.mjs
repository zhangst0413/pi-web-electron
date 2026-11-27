// scripts/desktop-build.mjs —— 打包入口：先修好 .next 里的符号链接，再调用 electron-builder。
//
// 两个坑：
//   1. 国内网络拉 GitHub 上的 Electron / NSIS 很慢，所以默认走 npmmirror 镜像
//      （可用 ELECTRON_MIRROR、ELECTRON_BUILDER_BINARIES_MIRROR 覆盖）。
//   2. `next build` 会把外部化的服务端依赖以「符号链接」的形式放在 .next/node_modules 里。
//      electron-builder 会按链接原样复制，而 Windows 非开发者模式不允许创建符号链接，
//      所以先把这些链接"实体化"成真实目录。
//
// 给 Python 程序员的提示：.mjs 是 ES Module（用 import），
// `process.argv.slice(2)` 相当于 sys.argv[1:]，`process.exit(code)` 相当于 sys.exit(code)。
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";

// import.meta.dirname 类似 Python 的 __file__ 所在目录。
const root = join(import.meta.dirname, "..");
const cli = join(root, "node_modules", "electron-builder", "out", "cli", "cli.js");
if (!existsSync(cli)) {
	console.error("electron-builder 未安装，先运行 npm install。");
	process.exit(1);
}

// 构建产物里如果还有符号链接，先实体化（Windows 打包必需）。
const nextDir = join(root, ".next");
if (existsSync(nextDir)) materializeSymlinks(nextDir);

// 把命令行参数原样透传给 electron-builder（例如 --dir）。
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
	cwd: root,
	stdio: "inherit", // 让子进程直接输出到终端
	env: {
		...process.env,
		ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/",
		ELECTRON_BUILDER_BINARIES_MIRROR:
			process.env.ELECTRON_BUILDER_BINARIES_MIRROR || "https://npmmirror.com/mirrors/electron-builder-binaries/",
	},
});
process.exit(result.status ?? 1);

/** 递归把目录里的符号链接替换成真实拷贝（dereference: true 表示跟随链接复制内容）。 */
function materializeSymlinks(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isSymbolicLink()) {
			// 先复制到临时名，再删除链接、改名回来，避免同路径读写冲突。
			const copy = `${path}.materialized`;
			cpSync(path, copy, { recursive: true, dereference: true });
			unlinkSync(path);
			renameSync(copy, path);
		} else if (entry.isDirectory()) {
			materializeSymlinks(path);
		}
	}
}
