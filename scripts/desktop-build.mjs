// Runs electron-builder with the npmmirror binary mirror, so the Electron zip and
// NSIS/winCodeSign toolsets don't have to come from GitHub.
//
// `next build` links externalized server packages into `.next/node_modules` as
// symlinks. electron-builder copies those links as links, which Windows refuses
// without developer mode, so materialize them as real directories first.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const cli = join(root, "node_modules", "electron-builder", "out", "cli", "cli.js");
if (!existsSync(cli)) {
	console.error("electron-builder 未安装，先运行 npm install。");
	process.exit(1);
}

const nextDir = join(root, ".next");
if (existsSync(nextDir)) materializeSymlinks(nextDir);

const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
	cwd: root,
	stdio: "inherit",
	env: {
		...process.env,
		ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/",
		ELECTRON_BUILDER_BINARIES_MIRROR:
			process.env.ELECTRON_BUILDER_BINARIES_MIRROR || "https://npmmirror.com/mirrors/electron-builder-binaries/",
	},
});
process.exit(result.status ?? 1);

function materializeSymlinks(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isSymbolicLink()) {
			const copy = `${path}.materialized`;
			cpSync(path, copy, { recursive: true, dereference: true });
			unlinkSync(path);
			renameSync(copy, path);
		} else if (entry.isDirectory()) {
			materializeSymlinks(path);
		}
	}
}
