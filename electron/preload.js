/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

// The page's only view of the desktop shell: a notify() the web client uses
// instead of a browser notification, so the OS notification and the taskbar
// flash come from the main process.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("piWebDesktop", {
  isDesktop: true,
  platform: process.platform,
  notify(payload) {
    if (!payload || typeof payload.title !== "string") return;
    ipcRenderer.send("pi-web:notify", {
      title: payload.title,
      body: typeof payload.body === "string" ? payload.body : "",
      sessionUrl: typeof payload.sessionUrl === "string" ? payload.sessionUrl : undefined,
    });
  },
});
