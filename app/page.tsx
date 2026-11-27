"use client";

/**
 * page.tsx —— 单页应用的外壳：左侧（工作目录 + 会话列表），右侧（聊天区），
 * 外加一个设置弹窗。所有数据都通过 /api/* 接口读写。
 *
 * 给 Python 程序员的提示：
 *   - `useState` 是组件内部状态，`setXxx` 触发重新渲染（类似前端的"重新执行函数"）。
 *   - `useCallback` 只是把函数缓存起来，避免每次渲染都生成新引用（影响 useEffect 依赖比较）。
 *   - `useEffect(() => {...}, [deps])` 里的 deps 类似"依赖变了才重跑的初始化代码"。
 *   - `.map(...)` 在 JSX 里等价于遍历渲染列表，`?.` 是安全取值（None 短路），`??` 是取默认值。
 */

import { useCallback, useEffect, useState } from "react";
import logo from "@/lib/pi-logo.svg";
import { Chat } from "@/components/chat";
import type { Config, SessionSummary } from "@/lib/types";

// Electron 预加载脚本注入的桌面能力；在纯浏览器里打开时是 undefined。
declare global {
	interface Window {
		harness?: { pickDirectory(current: string): Promise<string | null> };
	}
}

// 打包工具可能把 SVG 导入成字符串，也可能导入成 { src } 对象，这里两种情况都兼容。
const logoUrl: string = typeof logo === "string" ? logo : logo.src;

/** 取路径最后一段作为显示名（兼容 Windows 的 \ 与 POSIX 的 /）。 */
const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

/**
 * 统一的 JSON 请求封装：非 2xx 时抛出带服务端 error 文案的异常。
 * 相当于 Python 里 `response.raise_for_status()` + 解析 body 的小工具函数。
 */
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
	const response = await fetch(url, init);
	const data = (await response.json().catch(() => ({}))) as T & { error?: string };
	if (!response.ok) throw new Error(data?.error || `请求失败（HTTP ${response.status}）`);
	return data;
}

/** POST/PUT 用的 JSON 请求头，抽出来避免重复。 */
const jsonInit = (method: string, body: unknown): RequestInit => ({
	method,
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify(body),
});

export default function Page() {
	const [config, setConfig] = useState<Config | null>(null);
	const [sessions, setSessions] = useState<SessionSummary[]>([]);
	/** 当前打开的会话 id。 */
	const [active, setActive] = useState<string | null>(null);
	/** 当前选中的工作目录（只影响"新建会话"落在哪个目录）。 */
	const [workspace, setWorkspace] = useState<string | null>(null);
	const [settingsOpen, setSettingsOpen] = useState(false);
	/** 轻提示文案，非空时右下角显示 toast。 */
	const [notice, setNotice] = useState("");

	// 选中的目录可能已被移除，此时回退到列表第一个。
	const selected = workspace && config?.workspaces.includes(workspace) ? workspace : (config?.workspaces[0] ?? null);
	// 只要有任意会话在跑，就开启轮询刷新侧边栏状态。
	const anyRunning = sessions.some((session) => session.running);

	/** 拉取会话列表并写入状态；返回最新列表方便调用方立即使用。 */
	const loadSessions = useCallback(async () => {
		try {
			const list = await requestJson<SessionSummary[]>("/api/sessions");
			setSessions(list);
			return list;
		} catch {
			return [];
		}
	}, []);

	// 首次挂载：读配置 -> 选目录 -> 拉会话 -> 默认打开最近一个 -> 没 key 就弹设置。
	useEffect(() => {
		void (async () => {
			const loaded = await requestJson<Config>("/api/config");
			setConfig(loaded);
			setWorkspace(loaded.workspaces[0] ?? null);
			const list = await loadSessions();
			if (list[0]) setActive(list[0].id);
			if (!loaded.apiKey) setSettingsOpen(true);
		})().catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
	}, [loadSessions]);

	// 有会话在后台运行时，每 2 秒刷新一次列表，让侧边栏的 running 小圆点保持最新。
	useEffect(() => {
		if (!anyRunning) return;
		const timer = setInterval(() => void loadSessions(), 2000);
		return () => clearInterval(timer);
	}, [anyRunning, loadSessions]);

	/** 保存 key/model。服务端会重建所有活跃会话，所以保存后整页刷新最稳妥。 */
	const saveConfig = async (patch: Partial<Config>) => {
		setNotice("");
		try {
			await requestJson<Config>("/api/config", jsonInit("PUT", patch));
			location.reload();
		} catch (error) {
			setNotice(error instanceof Error ? error.message : "保存失败");
		}
	};

	/** 添加工作目录：桌面端用系统目录选择框，浏览器里退化为 prompt 输入。 */
	const addWorkspace = async () => {
		const picked = window.harness
			? await window.harness.pickDirectory(selected ?? "")
			: window.prompt("工作目录", selected ?? "");
		if (!picked) return;
		setNotice("");
		try {
			const next = await requestJson<Config>("/api/workspaces", jsonInit("POST", { path: picked }));
			setConfig(next);
			// 新增的目录总在列表末尾，直接选中它。
			setWorkspace(next.workspaces.at(-1) ?? null);
		} catch (error) {
			setNotice(error instanceof Error ? error.message : "添加失败");
		}
	};

	/** 从列表移除工作目录（不会删除该目录下已有的会话历史）。 */
	const removeWorkspace = async (path: string) => {
		try {
			setConfig(await requestJson<Config>(`/api/workspaces?path=${encodeURIComponent(path)}`, { method: "DELETE" }));
		} catch (error) {
			setNotice(error instanceof Error ? error.message : "移除失败");
		}
	};

	/** 在指定目录新建会话并切换过去。 */
	const createSession = async (cwd: string) => {
		setNotice("");
		try {
			const { id } = await requestJson<{ id: string }>("/api/sessions", jsonInit("POST", { cwd }));
			setWorkspace(cwd);
			await loadSessions();
			setActive(id);
		} catch (error) {
			setNotice(error instanceof Error ? error.message : "创建会话失败");
		}
	};

	/** 删除会话；如果删的是当前打开的会话，就切到列表第一个。 */
	const removeSession = async (id: string) => {
		if (!window.confirm("删除这个会话？")) return;
		try {
			await requestJson<{ ok: boolean }>(`/api/sessions/${id}`, { method: "DELETE" });
		} catch (error) {
			setNotice(error instanceof Error ? error.message : "删除失败");
		}
		const list = await loadSessions();
		if (active === id) setActive(list[0]?.id ?? null);
	};

	return (
		<div className="app">
			{/* ---------------------------------------------------------- 侧边栏 */}
			<aside className="sidebar">
				<div className="sidebar-head">
					<span className="brand">
						<img className="brand-logo" src={logoUrl} alt="" />
						pi harness
					</span>
					<button type="button" className="link" onClick={() => setSettingsOpen(true)}>
						设置
					</button>
				</div>

				{/* 工作目录列表：点击选中；行尾 ＋ 在该目录新建会话；× 从列表移除 */}
				<div className="section">
					<div className="section-title">
						工作目录
						<button type="button" className="icon-button" title="添加目录" onClick={addWorkspace}>
							＋
						</button>
					</div>
					<div className="workspace-list">
						{config?.workspaces.map((dir) => (
							<div
								key={dir}
								className={dir === selected ? "workspace active" : "workspace"}
								title={dir}
								onClick={() => setWorkspace(dir)}
							>
								<span className="workspace-name">{baseName(dir)}</span>
								<button
									type="button"
									className="workspace-action always"
									title="在此目录新建会话"
									onClick={(event) => {
										// 阻止冒泡，避免同时触发外层的"选中目录"。
										event.stopPropagation();
										void createSession(dir);
									}}
								>
									＋
								</button>
								<button
									type="button"
									className="workspace-action"
									title="从列表移除"
									onClick={(event) => {
										event.stopPropagation();
										void removeWorkspace(dir);
									}}
								>
									×
								</button>
							</div>
						))}
					</div>
				</div>

				{/* 会话列表：running 时显示小圆点 */}
				<div className="section session-section">
					<div className="section-title">会话</div>
					<div className="session-list">
						{sessions.map((session) => (
							<div
								key={session.id}
								className={session.id === active ? "session active" : "session"}
								onClick={() => setActive(session.id)}
							>
								<div className="session-title">
									{session.running && <span className="dot" />}
									{session.title}
								</div>
								<div className="session-meta" title={session.cwd}>
									{baseName(session.cwd)} · {new Date(session.modified).toLocaleString()}
								</div>
								<button
									type="button"
									className="remove"
									title="删除"
									onClick={(event) => {
										event.stopPropagation();
										void removeSession(session.id);
									}}
								>
									×
								</button>
							</div>
						))}
						{sessions.length === 0 && <p className="hint">还没有会话</p>}
					</div>
				</div>
			</aside>

			{/* ---------------------------------------------------------- 主区域 */}
			<main className="main">
				{active ? (
					// key={active}：切换会话时强制重建 Chat，顺带重建 SSE 连接与内部状态。
					<Chat key={active} sessionId={active} onActivity={loadSessions} />
				) : (
					<div className="placeholder">
						{!config?.apiKey
							? "请先在设置里填写 opencode-go API Key"
							: config.workspaces.length === 0
								? "先添加一个工作目录"
								: "新建或选择一个会话"}
					</div>
				)}
			</main>

			{settingsOpen && config && (
				<Settings config={config} onClose={() => setSettingsOpen(false)} onSave={saveConfig} />
			)}
			{notice && <div className="toast">{notice}</div>}
		</div>
	);
}

/** 设置弹窗：填写 API Key 与模型 ID。点击遮罩层关闭。 */
function Settings({
	config,
	onClose,
	onSave,
}: {
	config: Config;
	onClose: () => void;
	onSave: (patch: Partial<Config>) => Promise<void>;
}) {
	// 表单用局部状态，点「保存」时才提交，避免边输入边写盘。
	const [model, setModel] = useState(config.model);
	const [apiKey, setApiKey] = useState(config.apiKey);
	const [busy, setBusy] = useState(false);

	return (
		<div className="overlay" onClick={onClose}>
			<form
				className="modal"
				// 阻止点击弹窗内部冒泡到遮罩层，否则一点输入框就关掉弹窗。
				onClick={(event) => event.stopPropagation()}
				onSubmit={async (event) => {
					event.preventDefault(); // 阻止浏览器默认的整页提交
					setBusy(true);
					await onSave({ model, apiKey });
					setBusy(false);
				}}
			>
				<h2>设置</h2>

				<label>
					opencode-go API Key
					<input
						type="password"
						autoComplete="off"
						spellCheck={false}
						value={apiKey}
						onChange={(event) => setApiKey(event.target.value)}
						placeholder="sk-..."
					/>
				</label>

				<label>
					模型 ID
					<input value={model} onChange={(event) => setModel(event.target.value)} placeholder="deepseek-v4.1-flash" />
				</label>

				<div className="modal-actions">
					<button type="button" className="button" onClick={onClose}>
						取消
					</button>
					<button type="submit" className="button primary" disabled={busy}>
						保存
					</button>
				</div>
			</form>
		</div>
	);
}
