import { getDesktopBridge } from "./desktop-bridge";
import { isBlockingExtensionUiRequest } from "./extension-ui-queue";
import type { BlockingExtensionUiRequest, ExtensionUiRequest } from "./types";

interface WindowNotificationLike {
  onclick: Notification["onclick"];
  close: () => void;
}

interface ServiceWorkerRegistrationLike {
  showNotification: (title: string, options?: NotificationOptions) => Promise<void>;
}

export interface BrowserNotificationEnvironment {
  createWindowNotification: (title: string, options?: NotificationOptions) => WindowNotificationLike;
  getServiceWorkerRegistration: (() => Promise<ServiceWorkerRegistrationLike | undefined>) | null;
  /**
   * The desktop shell's bridge (lib/desktop-bridge.ts). Present only inside the
   * Electron app, where it answers true once it has shown the notification and
   * flashed the taskbar; the browser paths then stay out of the way.
   */
  notifyDesktop?: (payload: { title: string; body: string; sessionUrl: string }) => boolean;
}

export interface BrowserNotificationOptions {
  title: string;
  body: string;
  sessionUrl: string;
  onClick: () => void;
  tag?: string;
}

export type NotificationDelivery = "desktop" | "service-worker" | "window" | null;

type DocumentAttentionState = Pick<Document, "visibilityState" | "hasFocus">;

export function shouldShowBrowserNotification(
  attentionState: DocumentAttentionState = document,
): boolean {
  return attentionState.visibilityState !== "visible" || !attentionState.hasFocus();
}

// The classification lives with the request queues (lib/extension-ui-queue.ts),
// where the server's awaiting-input snapshot shares it.
export { isBlockingExtensionUiRequest };

export function claimExtensionAttentionNotification(
  request: ExtensionUiRequest,
  notifiedRequestIds: Set<string>,
): request is BlockingExtensionUiRequest {
  if (!isBlockingExtensionUiRequest(request) || notifiedRequestIds.has(request.id)) return false;
  notifiedRequestIds.add(request.id);
  return true;
}

function getBrowserEnvironment(): BrowserNotificationEnvironment {
  const desktop = getDesktopBridge();
  return {
    createWindowNotification: (title, options) => new Notification(title, options),
    getServiceWorkerRegistration: "serviceWorker" in navigator
      ? () => navigator.serviceWorker.getRegistration()
      : null,
    notifyDesktop: desktop
      ? (payload) => {
        // The main process owns the click (it focuses the window and opens the
        // finished chat), so onClick stays unused here.
        try {
          desktop.notify(payload);
          return true;
        } catch {
          return false;
        }
      }
      : undefined,
  };
}

export async function showBrowserNotification(
  options: BrowserNotificationOptions,
  environment: BrowserNotificationEnvironment = getBrowserEnvironment(),
): Promise<NotificationDelivery> {
  let deliveredByDesktop = false;
  try {
    deliveredByDesktop = environment.notifyDesktop?.({ title: options.title, body: options.body, sessionUrl: options.sessionUrl }) === true;
  } catch {
    // A closed IPC channel falls back to the browser paths rather than losing the notice.
  }
  if (deliveredByDesktop) return "desktop";

  const notificationOptions: NotificationOptions = {
    body: options.body,
    ...(options.tag ? { tag: options.tag, renotify: true } : {}),
  };

  if (environment.getServiceWorkerRegistration) {
    try {
      const registration = await environment.getServiceWorkerRegistration();
      if (registration) {
        await registration.showNotification(options.title, {
          ...notificationOptions,
          // shownAt lets the service worker tell this completion's push from a later task's (#1515).
          data: { url: options.sessionUrl, shownAt: Date.now() },
        });
        return "service-worker";
      }
    } catch {
      // Fall back to a page notification where the constructor is supported.
    }
  }

  try {
    const notification = environment.createWindowNotification(options.title, notificationOptions);
    notification.onclick = () => {
      notification.close();
      options.onClick();
    };
    return "window";
  } catch {
    // Most mobile browsers expose Notification but require service-worker delivery.
    return null;
  }
}
