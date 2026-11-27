import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  builtinToolsOf,
  readBuiltinTools,
  resolveDefaultToolEntries,
  withBuiltinTools,
  writeBuiltinTools,
} = await createJiti(import.meta.url).import("./builtin-tools.ts");

test("defaultTools entries resolve like pi's +name / -name modifiers", () => {
  assert.deepEqual(resolveDefaultToolEntries([]), []);
  assert.deepEqual(resolveDefaultToolEntries(["read", "grep"]), ["read", "grep"]);
  assert.deepEqual(resolveDefaultToolEntries(["+codemode"]), ["read", "bash", "edit", "write", "codemode"]);
  assert.deepEqual(resolveDefaultToolEntries(["-bash", "+powershell"]), ["read", "edit", "write", "powershell"]);
  assert.deepEqual(resolveDefaultToolEntries(["read", "+grep", "-read"]), ["grep"]);
});

test("a settings file naming powershell still reads the shell switch as on", () => {
  // The switch is the shell slot, whichever name the file uses.
  assert.deepEqual(builtinToolsOf(["-bash", "+powershell"]), ["read", "edit", "write", "bash"]);
});

test("the built-in tool switches edit only built-in entries, as modifiers unless a plain name is kept", () => {
  assert.deepEqual(builtinToolsOf(undefined), ["read", "edit", "write", "bash"]);
  assert.deepEqual(builtinToolsOf(["-bash", "+grep", "+codemode"]), ["read", "grep", "edit", "write"]);
  // pi's defaults remove the key; other entries stay as they are.
  assert.equal(withBuiltinTools(undefined, ["read", "edit", "write", "bash"]), undefined);
  assert.equal(withBuiltinTools(["read", "bash", "edit", "write", "grep"], ["read", "edit", "write", "bash"]), undefined);
  assert.deepEqual(withBuiltinTools(["+codemode", "-ls"], ["read", "bash"]), ["+codemode", "-edit", "-write"]);
  assert.deepEqual(withBuiltinTools(["+codemode"], []), ["+codemode", "-read", "-bash", "-edit", "-write"]);
  assert.deepEqual(withBuiltinTools(undefined, []), ["-read", "-bash", "-edit", "-write"]);
  // Beside an extension's plain name the built-ins are plain, or they would drop out.
  assert.deepEqual(withBuiltinTools(["lookup", "read", "-codemode"], ["read", "grep"]), ["read", "grep", "lookup", "-codemode"]);
});

test("saving the built-in tools drops a settings file's powershell for bash", () => {
  assert.deepEqual(withBuiltinTools(["-bash", "+powershell"], ["read", "grep", "bash"]), ["-edit", "-write", "+grep"]);
  assert.deepEqual(withBuiltinTools(["read", "powershell", "edit", "write"], ["read", "bash"]), ["-edit", "-write"]);
  assert.deepEqual(withBuiltinTools(["read", "powershell"], ["read"]), ["-bash", "-edit", "-write"]);
});

test("the built-in tools round-trip through the settings file", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-builtin-tools-"));
  const settingsPath = join(root, "settings.json");

  assert.deepEqual(await readBuiltinTools(settingsPath), ["read", "edit", "write", "bash"]);
  await writeBuiltinTools(["read", "ls", "bash"], settingsPath);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultTools: ["-edit", "-write", "+ls"] });
  assert.deepEqual(await readBuiltinTools(settingsPath), ["read", "ls", "bash"]);

  await writeBuiltinTools(["read", "edit", "write", "bash"], settingsPath);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {});
  assert.deepEqual(await readBuiltinTools(settingsPath), ["read", "edit", "write", "bash"]);
});

test("a settings file still naming powershell reads as bash and migrates when the switches are saved", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-builtin-tools-powershell-"));
  const settingsPath = join(root, "settings.json");
  await writeFile(settingsPath, JSON.stringify({ defaultTools: ["read", "powershell", "edit", "write"] }));
  assert.deepEqual(await readBuiltinTools(settingsPath), ["read", "edit", "write", "bash"]);

  await writeBuiltinTools(["read", "edit", "write", "bash"], settingsPath);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {});
  assert.deepEqual(await readBuiltinTools(settingsPath), ["read", "edit", "write", "bash"]);
});

test("invalid defaultTools are rejected without overwriting the settings file", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-builtin-tools-invalid-"));
  const settingsPath = join(root, "settings.json");
  const original = JSON.stringify({ defaultTools: "bash", unrelated: true });
  await writeFile(settingsPath, original);

  await assert.rejects(
    writeBuiltinTools(["read", "edit"], settingsPath),
    /defaultTools must be an array of strings/,
  );
  assert.equal(await readFile(settingsPath, "utf8"), original);
});
