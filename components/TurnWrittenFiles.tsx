"use client";

import { useI18n } from "@/hooks/useI18n";
import { getFileName } from "@/lib/file-paths";
import type { WrittenFile } from "@/lib/turn-written-files";

/**
 * Lists the files a turn actually wrote. Entries come from the turn's
 * successful `write`/`edit` tool calls — the reply text is never scanned for
 * paths.
 */
export function TurnWrittenFiles({ files }: { files: WrittenFile[] }) {
  const { t } = useI18n();
  if (files.length === 0) return null;

  return (
    <div aria-label={t("chat.filesWritten")} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 6 }}>
      {files.map(({ filePath }) => (
        <span
          key={filePath}
          title={filePath}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "2px 8px",
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            color: "var(--text)",
            background: "var(--bg-subtle)",
            border: "1px solid var(--border)",
            borderRadius: 6,
          }}
        >
          {getFileName(filePath)}
        </span>
      ))}
    </div>
  );
}
