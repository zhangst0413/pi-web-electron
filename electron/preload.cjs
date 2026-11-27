// The page's only view of the desktop shell: the native folder picker.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("harness", {
	pickDirectory: (current) => ipcRenderer.invoke("pick-directory", current),
});
