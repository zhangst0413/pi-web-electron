/**
 * opencode-go 终端对话助手（单文件）。
 *
 * 用法：在本目录执行 `node test.ts`（Node 22.19+ 可直接运行 .ts）。
 *
 * 首次运行会生成 config.json，填好 apiKey 后再次运行：
 *   {
 *     "model": "deepseek-v4.1-flash",      // opencode-go 的模型 id
 *     "apiKey": "sk-...",             // opencode-go 的 API key
 *     "dataDir": "./pi-chat-data"     // 数据目录，相对路径按运行目录解析
 *   }
 *
 * 数据目录内容：
 *   auth.json          与 ~/.pi 隔离的 pi 凭据
 *   sessions/*.jsonl   会话历史，启动时自动续接最近一次会话
 *
 * 输入 /exit 退出。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";

const DEFAULT_MODEL = "deepseek-v4.1-flash";

// 配置文件：不存在时写一份模板，改完再运行。
const configPath = resolve("config.json");
if (!existsSync(configPath)) {
	writeFileSync(
		configPath,
		`${JSON.stringify({ model: DEFAULT_MODEL, apiKey: "", dataDir: "./pi-chat-data" }, null, 2)}\n`,
	);
	console.error(`已生成 ${configPath}，填写 apiKey 后重新运行 node test.ts。`);
	process.exit(1);
}

// JSON.parse 的结果没有类型，这里断言成我们约定的结构。
const config = JSON.parse(readFileSync(configPath, "utf8")) as {
	model?: string;
	apiKey?: string;
	dataDir?: string;
};
const apiKey = typeof config.apiKey === "string" ? config.apiKey.trim() : "";
if (!apiKey) {
	console.error(`请在 ${configPath} 里填写 apiKey。`);
	process.exit(1);
}
const modelId = config.model || DEFAULT_MODEL;
const dataDir = resolve(config.dataDir || "pi-chat-data");
mkdirSync(dataDir, { recursive: true });

// 只支持 opencode-go：key 放进 runtime，模型从内置目录里取。
const modelRuntime = await ModelRuntime.create({ authPath: join(dataDir, "auth.json"), modelsPath: null });
await modelRuntime.setRuntimeApiKey("opencode-go", apiKey);
const model = modelRuntime.getModel("opencode-go", modelId);
if (!model) {
	console.error(`opencode-go 没有模型 "${modelId}"。`);
	process.exit(1);
}

// 会话文件放在数据目录；continueRecent 续接最近一次会话，没有就新建。
const { session } = await createAgentSession({
	cwd: process.cwd(),
	agentDir: dataDir,
	model,
	modelRuntime,
	sessionManager: SessionManager.continueRecent(process.cwd(), join(dataDir, "sessions")),
});

// 流式打印助手文本。
session.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

/** 发送一轮消息并打印结果。 */
async function runTurn(text: string): Promise<void> {
	process.stdout.write("助手 > ");
	await session.prompt(text);
	// 请求失败时 pi 不抛异常，而是把错误写进最后一条助手消息。
	const last = session.messages.at(-1);
	if (last?.role === "assistant" && last.stopReason === "error") {
		console.error(`\n错误: ${last.errorMessage ?? "未知错误"}\n`);
	} else {
		process.stdout.write("\n\n");
	}
}

console.log(`模型: opencode-go/${model.id}`);
console.log(`数据目录: ${dataDir}`);
console.log(`会话: ${session.sessionFile ?? "(首条消息后创建)"}`);
console.log("输入消息回车发送，/exit 退出。\n");

const rl = createInterface({ input: process.stdin, output: process.stdout });
try {
	while (true) {
		const line = (await rl.question("你 > ")).trim();
		if (line === "/exit") break;
		if (!line) continue;
		try {
			await runTurn(line);
		} catch (error) {
			console.error("\n错误:", error instanceof Error ? error.message : error, "\n");
		}
	}
} catch {
	// Ctrl+C 或 stdin 关闭，直接退出。
} finally {
	rl.close();
	session.dispose();
}
