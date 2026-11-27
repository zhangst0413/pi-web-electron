"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { clearStoredDrafts } from "@/lib/draft-store";

/**
 * Signs out of Pi Web's own password login, when the server has one. The button
 * is the footer's third slot beside 模型 and 技能, where 设置 used to be; with no
 * password it renders nothing and the two fill the row.
 */
export function SignOutButton() {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/web-auth")
      .then((response) => response.ok ? response.json() : null)
      .then((data: { enabled?: boolean } | null) => { if (!cancelled) setEnabled(data?.enabled === true); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!enabled) return null;

  const logOut = async () => {
    setLoggingOut(true);
    setError("");
    try {
      const response = await fetch("/api/web-auth", { method: "DELETE" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      // Unsent text stays in this browser's storage otherwise.
      clearStoredDrafts();
      window.location.replace("/login");
    } catch {
      setError(t("auth.logoutFailed"));
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void logOut()}
      disabled={loggingOut}
      title={error || t("auth.logOut")}
      aria-label={error || t("auth.logOut")}
      style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        height: 32, padding: 0, background: "none", border: "none",
        borderRadius: 9, color: "var(--text-muted)", cursor: "pointer",
        fontSize: 12, transition: "background 0.12s, color 0.12s",
      }}
      onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; event.currentTarget.style.color = "var(--text)"; }}
      onMouseLeave={(event) => { event.currentTarget.style.background = "none"; event.currentTarget.style.color = "var(--text-muted)"; }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10 17l5-5-5-5M15 12H3M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      </svg>
      <span>{loggingOut ? t("auth.loggingOut") : t("auth.logOut")}</span>
    </button>
  );
}
