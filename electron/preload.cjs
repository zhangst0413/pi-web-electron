// electron/preload.cjs —— 预加载脚本，在页面加载前执行。
//
// 这是渲染进程（页面）唯一能接触系统能力的地方：
// 用 contextBridge 把一个极小的 API 挂到 window.harness 上，
// 页面因此看不到 ipcRenderer / Node.js 的其他能力（安全考虑）。
// 对应 app/page.tsx 里的 `window.harness?.pickDirectory`。
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("harness", {
	/** 打开系统「选择文件夹」对话框，返回绝对路径或 null（用户取消）。 */
	pickDirectory: (current) => ipcRenderer.invoke("pick-directory", current),
});
