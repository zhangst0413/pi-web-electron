import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { THEME_ID, THEME_INIT_SCRIPT } from "./theme.ts";

test("first paint paints the single dark palette", () => {
  for (const stored of ["light", "pine", "auto", null, "", "unknown", new Error("Blocked")]) {
    for (const systemDark of [false, true]) {
      const root = { dataset: {}, classList: { add: (name) => { root[name] = true; } } };
      runInNewContext(THEME_INIT_SCRIPT, {
        localStorage: { getItem: () => { if (stored instanceof Error) throw stored; return stored; } },
        window: { matchMedia: () => ({ matches: systemDark }) },
        document: { documentElement: root },
      });
      // The palette never follows storage or the system scheme.
      assert.equal(root.dataset.theme, THEME_ID);
      assert.equal(root.dark, true);
    }
  }
  assert.equal(THEME_ID, "dark");
});
