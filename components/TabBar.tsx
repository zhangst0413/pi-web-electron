"use client";

import { useRef, useState } from "react";
import { useHorizontalStrip } from "@/hooks/useHorizontalStrip";
import { useI18n } from "@/hooks/useI18n";

/** A right-panel tab: a side chat of the session in the chat. */
export interface Tab {
  id: string;
  label: string;
  closing?: boolean;
}

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onReorderTab?: (source: string, target: string, after: boolean) => void;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onReorderTab }: Props) {
  const { t } = useI18n();
  const [hoveredClose, setHoveredClose] = useState<string | null>(null);
  // The strip has no scrollbar (globals.css): a vertical wheel scrolls it
  // sideways, and an opened or selected tab is brought into view.
  const listRef = useHorizontalStrip<HTMLDivElement>('[role="tab"][aria-selected="true"]', `${tabs.length}\n${activeTabId}`);
  const draggedId = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);

  return (
    <div
      ref={listRef}
      role="tablist"
      className="tabbar-scroll"
      style={{
        // The scrollbar is hidden (globals.css): it would take its height out
        // of the bar (--top-bar-height), squeezing the tabs or clipping their tops (#1225).
        display: "flex",
        alignItems: "stretch",
        background: "var(--bg-panel)",
        overflowX: "auto",
        overflowY: "hidden",
        flexShrink: 0,
        height: "var(--top-bar-height)",
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-label={t("sideChat.tabLabel")}
            aria-selected={isActive}
            draggable={Boolean(onReorderTab)}
            onDragStart={(event) => {
              if (!onReorderTab) return;
              draggedId.current = tab.id;
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", tab.id);
            }}
            onDragOver={(event) => {
              if (!draggedId.current || draggedId.current === tab.id) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              const rect = event.currentTarget.getBoundingClientRect();
              const after = event.clientX >= rect.left + rect.width / 2;
              setDropTarget((prev) => prev?.id === tab.id && prev.after === after ? prev : { id: tab.id, after });
            }}
            onDrop={(event) => {
              if (!draggedId.current || draggedId.current === tab.id) return;
              event.preventDefault();
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              onReorderTab?.(draggedId.current, tab.id, event.clientX >= rect.left + rect.width / 2);
              draggedId.current = null;
              setDropTarget(null);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              setDropTarget((prev) => prev?.id === tab.id ? null : prev);
            }}
            onDragEnd={() => { draggedId.current = null; setDropTarget(null); }}
            tabIndex={isActive || (!activeTabId && tabs[0].id === tab.id) ? 0 : -1}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectTab(tab.id);
              } else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const index = tabs.findIndex((item) => item.id === tab.id);
                const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
                  : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                onSelectTab(tabs[next].id);
                (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
              }
            }}
            onClick={() => onSelectTab(tab.id)}
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault();
            }}
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              e.stopPropagation();
              if (!tab.closing) onCloseTab(tab.id);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              paddingLeft: 12,
              paddingRight: 6,
              borderRight: "1px solid var(--border)",
              background: isActive ? "var(--bg)" : "var(--bg-panel)",
              cursor: "pointer",
              fontSize: 12,
              color: isActive ? "var(--text)" : "var(--text-muted)",
              whiteSpace: "nowrap",
              maxWidth: 180,
              minWidth: 80,
              flexShrink: 0,
              userSelect: "none",
              transition: "background 0.1s, color 0.1s",
              boxShadow: dropTarget?.id === tab.id ? `inset ${dropTarget.after ? "-2px" : "2px"} 0 var(--accent)` : undefined,
            }}
          >
            <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7, display: "flex", alignItems: "center" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12a8 8 0 0 1-8 8H5.5a2 2 0 0 1-1.4-3.4A8 8 0 1 1 21 12z" />
              </svg>
            </span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                flex: 1,
                fontWeight: isActive ? 500 : 400,
              }}
              title={tab.label}
            >
              {tab.label}
            </span>
            <button
              draggable={false}
              onDragStart={(event) => event.stopPropagation()}
              disabled={tab.closing}
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
              onMouseEnter={() => setHoveredClose(tab.id)}
              onMouseLeave={() => setHoveredClose(null)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 24, height: 24,
                background: hoveredClose === tab.id ? "var(--bg-hover)" : "transparent",
                border: "none",
                borderRadius: 4,
                color: hoveredClose === tab.id ? "var(--text)" : "var(--text-dim)",
                cursor: "pointer",
                padding: 0,
                flexShrink: 0,
                transition: "background 0.1s, color 0.1s",
              }}
               title={t("i18n.close")}
               aria-label={`${t("i18n.close")} ${tab.label}`}
            >
              <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <line x1="2" y1="2" x2="8" y2="8" />
                <line x1="8" y1="2" x2="2" y2="8" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
