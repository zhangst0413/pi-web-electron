import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  getLocalePlugin,
  getSupportedLocales,
} = await jiti.import("./registry.ts");

test("registers Simplified Chinese as the only interface language", () => {
  assert.deepEqual(getSupportedLocales(), ["zh-CN"]);
  assert.equal(getLocalePlugin("zh-CN").id, "zh-CN");
  assert.equal(getLocalePlugin("zh-CN")?.label, "简体中文");
  assert.equal(getLocalePlugin("zh-CN")?.messages["sidebar.brandLabel"].startsWith("Pi Web"), true);
  assert.equal(getLocalePlugin("en"), undefined);
  assert.equal(getLocalePlugin("zh-TW"), undefined);
  assert.equal(getLocalePlugin("missing"), undefined);
});
