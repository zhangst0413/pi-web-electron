import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillsSource = await readFile(new URL("./SkillsConfig.tsx", import.meta.url), "utf8");

test("every add pane chooses its scope in one place: the save target under its title", () => {
  const pane = skillsSource.match(/function AddSkillPanel[\s\S]*?\r?\n\}\r?\n/)?.[0] ?? "";
  assert.ok(pane, "AddSkillPanel");
  assert.match(pane, /<ConfigSaveTarget[\s\S]*?label=\{t\("config\.saveTo"\)\}[\s\S]*?path=\{/);
  assert.doesNotMatch(pane, /<ConfigScopeSwitch/, "the pane uses the shared row, not a switch of its own");
});
