"use client";

import { useCallback, useEffect, useState } from "react";
import logo from "@/lib/pi-logo.svg";
import { Chat } from "@/components/chat";
import type { Config, SessionSummary } from "@/lib/types";

declare global {
	interface Window {
		harness?: { pickDirectory(current: string): Promise<string | null> };
	}
}

const logoUrl: string = typeof logo === "string" ? logo : logo.src;
const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

export default function Page() {
	const [config, setConfig] = useState<Config | null>(null);
	const [sessions, setSessions] = useState<SessionSummary[]>([]);
	const [active, setActive] = useState<string | null>(null);
	const [workspace, setWorkspace] = useState<string | null>(null);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [notice, setNotice] = useState("");

	const selected = workspace && config?.workspaces.includes(workspace) ? workspace : (config?.workspaces[0] ?? null);
	const anyRunning = sessions.some((session) => session.running);

	const loadSessions = useCallback(async () => {
		const response = await fetch("/api/sessions");
		if (!response.ok) return [];
		const list: SessionSummary[] = await response.json();
		setSessions(list);
		return list;
	}, []);

	useEffect(() => {
		void (async () => {
			const loaded: Config = await fetch("/api/config").then((response) => response.json());
			setConfig(loaded);
			setWorkspace(loaded.workspaces[0] ?? null);
			const list = await loadSessions();
			if (list[0]) setActive(list[0].id);
			if (!loaded.apiKey) setSettingsOpen(true);
		})();
	}, [loadSessions]);

	// Keep the sidebar's running dots fresh while a background session works.
	useEffect(() => {
		if (!anyRunning) return;
		const timer = setInterval(() => void loadSessions(), 2000);
		return () => clearInterval(timer);
	}, [anyRunning, loadSessions]);

	const saveConfig = async (patch: Partial<Config>) => {
		setNotice("");
		const response = await fetch("/api/config", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(patch),
		});
		const data = await response.json();
		if (!response.ok) {
			setNotice(data.error ?? "保存失败");
			return;
		}
		location.reload();
	};

	const addWorkspace = async () => {
		const picked = window.harness
			? await window.harness.pickDirectory(selected ?? "")
			: window.prompt("工作目录", selected ?? "");
		if (!picked) return;
		setNotice("");
		const response = await fetch("/api/workspaces", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ path: picked }),
		});
		const data = await response.json();
		if (!response.ok) return setNotice(data.error ?? "添加失败");
		setConfig(data);
		setWorkspace(data.workspaces.at(-1) ?? null);
	};

	const removeWorkspace = async (path: string) => {
		const response = await fetch(`/api/workspaces?path=${encodeURIComponent(path)}`, { method: "DELETE" });
		const data = await response.json();
		if (!response.ok) return setNotice(data.error ?? "移除失败");
		setConfig(data);
	};

	const createSession = async (cwd: string) => {
		setNotice("");
		const response = await fetch("/api/sessions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ cwd }),
		});
		const data = await response.json();
		if (!response.ok) return setNotice(data.error ?? "创建会话失败");
		setWorkspace(cwd);
		await loadSessions();
		setActive(data.id);
	};

	const removeSession = async (id: string) => {
		if (!window.confirm("删除这个会话？")) return;
		await fetch(`/api/sessions/${id}`, { method: "DELETE" });
		const list = await loadSessions();
		if (active === id) setActive(list[0]?.id ?? null);
	};

	return (
		<div className="app">
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

			<main className="main">
				{active ? (
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

function Settings({
	config,
	onClose,
	onSave,
}: {
	config: Config;
	onClose: () => void;
	onSave: (patch: Partial<Config>) => Promise<void>;
}) {
	const [model, setModel] = useState(config.model);
	const [apiKey, setApiKey] = useState(config.apiKey);
	const [busy, setBusy] = useState(false);

	return (
		<div className="overlay" onClick={onClose}>
			<form
				className="modal"
				onClick={(event) => event.stopPropagation()}
				onSubmit={async (event) => {
					event.preventDefault();
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
