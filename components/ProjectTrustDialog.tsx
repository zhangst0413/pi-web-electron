"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ProjectTrustStatus } from "@/lib/api-types";
import { revealHiddenCharacters } from "@/lib/reveal-hidden-characters";
import { openStackedDialog } from "@/lib/stacked-dialog";

/** How long the dialog waits for the folder's status before it stops holding Trust back. */
export const PROJECT_TRUST_TIMEOUT_MS = 10_000;

/** Why trusting failed: a route refusal carries its `reason`; a network failure has none. */
export interface ProjectTrustFailure {
  error: string;
  reason?: string;
}

/** What the dialog knows about the folder's trust, read when it opens. */
export type ProjectTrustRead =
  | { state: "loading" }
  | { state: "failed"; error?: string; timedOut?: boolean }
  | { state: "loaded"; status?: ProjectTrustStatus; statusError?: string };

const STATUS_ID = "project-trust-status";
const NOTICE_ID = "project-trust-notice";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Why the dialog no longer offers Trust: the folder's trust changed since the page read it. */
function settledTrustNotice(status: ProjectTrustStatus | undefined): string | undefined {
  if (!status) return undefined;
  if (!status.requiresTrust) return "trust.alreadyTrusted";
  if (status.trusted) return "trust.alreadyTrusted";
  return undefined;
}

/**
 * Asks before trusting a project (ADR 0006). The status is fetched when the
 * dialog opens, not taken from the status the page loaded with, and goes to
 * `onStatus`; a folder trusted meanwhile, or no longer needing trust, is no
 * longer offered Trust. It opens from the page's restricted-mode banner, above
 * Settings, so Escape closes it alone.
 */
export function ProjectTrustDialog({
  cwd,
  busy,
  error,
  onCancel,
  onConfirm,
  onStatus,
}: {
  cwd: string;
  busy: boolean;
  error: ProjectTrustFailure | null;
  onCancel: () => void;
  onConfirm: () => void;
  /** The fresh status the dialog read, so the page's restricted-mode banner can follow it. */
  onStatus?: (status: ProjectTrustStatus) => void;
}) {
  const [read, setRead] = useState<ProjectTrustRead>({ state: "loading" });
  // Read through a ref, so a new callback on every page render does not fetch again.
  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    let active = true;
    let timedOut = false;
    setRead({ state: "loading" });
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, PROJECT_TRUST_TIMEOUT_MS);
    fetch(`/api/project-trust?cwd=${encodeURIComponent(cwd)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as Partial<ProjectTrustStatus> & { error?: string; reason?: string };
        if (!active) return;
        if (response.ok && typeof data.requiresTrust === "boolean") {
          const status = data as ProjectTrustStatus;
          setRead({ state: "loaded", status });
          onStatusRef.current?.(status);
          return;
        }
        setRead({ state: "loaded", statusError: data.error ?? `HTTP ${response.status}` });
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setRead(timedOut ? { state: "failed", timedOut: true } : { state: "failed", error: errorMessage(reason) });
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [cwd]);

  return (
    <ProjectTrustDialogView
      cwd={cwd}
      busy={busy}
      error={error}
      read={read}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

/** The dialog for a read in any state, without the fetch; exported for tests. */
export function ProjectTrustDialogView({
  cwd,
  busy,
  error,
  read,
  onCancel,
  onConfirm,
}: {
  cwd: string;
  busy: boolean;
  error: ProjectTrustFailure | null;
  read: ProjectTrustRead;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const loading = read.state === "loading";
  const notice = read.state === "loaded" ? settledTrustNotice(read.status) : undefined;
  const dialogRef = useRef<HTMLDivElement>(null);
  // Read through refs, so the Escape listener registered once sees the current props.
  const busyRef = useRef(busy);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    busyRef.current = busy;
    onCancelRef.current = onCancel;
  }, [busy, onCancel]);

  // The dialog opens above the page: Escape closes it alone (taken in the
  // capture phase, before any panel's own handler), focus moves into it, and
  // goes back to what had it once it closes. Escape is ignored while trusting,
  // like Cancel and the backdrop.
  useEffect(() => openStackedDialog(document, dialogRef.current, () => {
    if (!busyRef.current) onCancelRef.current();
  }), []);

  return (
    <div
      role="presentation"
      className="project-trust-backdrop"
      onClick={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-trust-title"
        aria-describedby="project-trust-description"
        tabIndex={-1}
        className="project-trust-dialog"
      >
        <div className="project-trust-body">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#f59e0b"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="project-trust-icon"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          <div className="project-trust-content">
            <div id="project-trust-title" className="project-trust-title">
              {t("trust.dialogTitle")}
            </div>
            <div id="project-trust-description" className="project-trust-text">
              {t("trust.dialogBody")}
            </div>
            <code className="project-trust-path">{revealHiddenCharacters(cwd)}</code>
            {notice && <p id={NOTICE_ID} role="status" className="project-trust-notice">{t(notice)}</p>}
            {read.state === "loaded" && read.statusError !== undefined && (
              <div className="project-trust-mcp-failed">
                <p className="project-trust-mcp-line is-warning">{t("trust.statusUnreadable")}</p>
                <code className="project-trust-mcp-detail">{revealHiddenCharacters(read.statusError)}</code>
              </div>
            )}
            {read.state === "failed" && (
              <div className="project-trust-mcp-failed">
                <p className="project-trust-mcp-line is-warning">
                  {t(read.timedOut ? "trust.statusTimedOut" : "trust.statusLoadFailed")}
                </p>
                {read.error && <code className="project-trust-mcp-detail">{revealHiddenCharacters(read.error)}</code>}
              </div>
            )}
            {loading && <p id={STATUS_ID} role="status" className="project-trust-mcp-status">{t("trust.status.loading")}</p>}
          </div>
        </div>
        {error && <ProjectTrustError error={error} />}
        <div className="project-trust-footer">
          <button
            type="button"
            className="project-trust-button"
            onClick={onCancel}
            disabled={busy}
          >
            {notice ? t("trust.close") : t("trust.cancel")}
          </button>
          {!notice && (
            <button
              type="button"
              className="project-trust-button is-primary"
              onClick={onConfirm}
              disabled={busy || loading}
              aria-busy={busy || undefined}
              aria-describedby={loading ? STATUS_ID : undefined}
            >
              {busy ? t("trust.trusting") : t("trust.trustProject")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Why trusting failed: the translated reason, or for an internal or network failure its diagnostic. */
function ProjectTrustError({ error }: { error: ProjectTrustFailure }) {
  const { t } = useI18n();
  const translated = error.reason === "trust-not-required" || error.reason === "session-busy";
  return (
    <div role="alert" className="project-trust-error">
      {translated ? t(`trust.refusal.${error.reason}`) : t("trust.trustFailed")}
      {!translated && <code className="project-trust-error-detail">{revealHiddenCharacters(error.error)}</code>}
    </div>
  );
}
