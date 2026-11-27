"use client";

import { useCallback, useEffect, useState } from "react";
import { Chat } from "@/components/chat";
import type { Config, SessionSummary } from "@/lib/types";

declare global {
	interface Window {
		harness?: { pickDirectory(current: string): Promise<string | null> };
	}
}

export default function Page() {
	const [config, setConfig] = useState<Config | null>(null);
	const [sessions, setSessions] = useState<SessionSummary[]>([]);
	const [active, setActive] = useState<string | null>(null);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [notice, setNotice] = useState("");

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
			const list = await loadSessions();
			if (list[0]) setActive(list[0].id);
			if (!loaded.apiKey) setSettingsOpen(true);
		})();
	}, [loadSessions]);

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
			return false;
		}
		location.reload();
		return true;
	};

	const pickDirectory = async () => {
		if (!config) return;
		const picked = window.harness
			? await window.harness.pickDirectory(config.cwd)
			: window.prompt("工作目录", config.cwd);
		if (picked) await saveConfig({ cwd: picked });
	};

	const createSession = async () => {
		setNotice("");
		const response = await fetch("/api/sessions", { method: "POST" });
		const data = await response.json();
		if (!response.ok) {
			setNotice(data.error ?? "创建会话失败");
			return;
		}
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
					<strong>pi harness</strong>
					<button type="button" className="link" onClick={() => setSettingsOpen(true)}>
						设置
					</button>
				</div>

				<button type="button" className="button new" onClick={createSession} disabled={!config?.apiKey}>
					＋ 新会话
				</button>
				<button type="button" className="cwd" title={config?.cwd} onClick={pickDirectory}>
					{config?.cwd ?? "选择工作目录"}
				</button>

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
							<div className="session-meta">
								{new Date(session.modified).toLocaleString()} · {session.cwd}
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
			</aside>

			<main className="main">
				{active ? (
					<Chat key={active} sessionId={active} onActivity={loadSessions} />
				) : (
					<div className="placeholder">
						{config?.apiKey ? "新建或选择一个会话" : "请先在设置里填写 opencode-go API Key"}
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
	onSave: (patch: Partial<Config>) => Promise<boolean>;
}) {
	const [model, setModel] = useState(config.model);
	const [apiKey, setApiKey] = useState(config.apiKey);
	const [cwd, setCwd] = useState(config.cwd);
	const [busy, setBusy] = useState(false);

	return (
		<div className="overlay" onClick={onClose}>
			<form
				className="modal"
				onClick={(event) => event.stopPropagation()}
				onSubmit={async (event) => {
					event.preventDefault();
					setBusy(true);
					await onSave({ model, apiKey, cwd });
					setBusy(false);
				}}
			>
				<h2>设置</h2>

				<label>
					opencode-go API Key
					<input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-..." />
				</label>

				<label>
					模型 ID
					<input value={model} onChange={(event) => setModel(event.target.value)} placeholder="deepseek-v4.1-flash" />
				</label>

				<label>
					工作目录
					<input value={cwd} onChange={(event) => setCwd(event.target.value)} />
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
