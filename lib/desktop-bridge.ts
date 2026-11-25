/**
 * The desktop shell (electron/preload.js) exposes `window.piWebDesktop`. Its
 * presence means the page runs inside Electron, where the shell owns OS
 * notifications and the taskbar flash, so the browser's own notification path
 * must stay out of the way.
 */
export interface PiWebDesktopBridge {
  isDesktop: true;
  platform: string;
  notify: (payload: { title: string; body?: string; sessionUrl?: string }) => void;
}

declare global {
  interface Window {
    piWebDesktop?: PiWebDesktopBridge;
  }
}

export function getDesktopBridge(): PiWebDesktopBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.piWebDesktop;
  return bridge && bridge.isDesktop === true && typeof bridge.notify === "function" ? bridge : null;
}
