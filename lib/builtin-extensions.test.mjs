import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

// The self-test's time limit is an unref'd timer, so it never keeps a server process alive. Node 22's
// test runner cancels a test whose only pending work is such a timer; this keeps the loop running meanwhile.
const keepAlive = setInterval(() => {}, 1_000);
after(() => clearInterval(keepAlive));

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  checkCodemodeSandbox,
  peekCodemodeSandbox,
  readBuiltinExtensionSwitches,
  runCodemodeSelfTest,
} = await jiti.import("./builtin-extensions.ts");

test("the codemode self-test runs a script in the SDK's sandbox", async () => {
  assert.deepEqual(await runCodemodeSelfTest(), { available: true });
});

function definitionReturning(execute) {
  return async () => ({ name: "codemode", execute });
}

test("the codemode self-test reports a sandbox that fails, answers wrong, or hangs", async () => {
  assert.deepEqual(
    await runCodemodeSelfTest({
      createDefinition: async () => {
        throw new Error("Cannot find module quickjs.wasm");
      },
    }),
    { available: false, reason: "Cannot find module quickjs.wasm" },
  );

  assert.deepEqual(
    await runCodemodeSelfTest({
      createDefinition: definitionReturning(async () => ({
        content: [{ type: "text", text: "Script failed\n" }, { type: "text", text: "Script error:\nworker exited" }],
        isError: true,
      })),
    }),
    { available: false, reason: "the self-test script failed: Script failed\n Script error:\nworker exited" },
  );

  assert.deepEqual(
    await runCodemodeSelfTest({
      createDefinition: definitionReturning(async () => ({ content: [{ type: "text", text: "undefined" }] })),
    }),
    { available: false, reason: "the self-test script returned \"undefined\"" },
  );

  let signal;
  const hung = await runCodemodeSelfTest({
    timeoutMs: 20,
    createDefinition: definitionReturning((_id, _params, runSignal) => {
      signal = runSignal;
      return new Promise(() => {});
    }),
  });
  assert.deepEqual(hung, { available: false, reason: "the sandbox did not answer within 20 ms" });
  assert.equal(signal.aborted, true, "the script is aborted when the self-test gives up on it");
});

function blockFor(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) { /* a synchronous stall, as a busy session start makes */ }
}

test("a stall of the server's own does not count against the codemode self-test (#1615)", async () => {
  const result = runCodemodeSelfTest({
    timeoutMs: 1_000,
    // The answer arrives the way the worker's does, as a message delivered in the poll phase. The stall
    // comes after a poll phase, so the next loop turn runs timers before it hands the answer over.
    createDefinition: definitionReturning(() => new Promise((resolve) => {
      const { port1, port2 } = new MessageChannel();
      port1.once("message", () => {
        port1.close();
        resolve({ content: [{ type: "text", text: "42" }] });
      });
      setImmediate(() => {
        port2.postMessage("done");
        blockFor(1_500);
      });
    })),
  });
  assert.deepEqual(await result, { available: true });
});

test("a failed codemode self-test is run again a minute later; a pass is kept", async () => {
  const runs = [];
  const selfTest = (status) => () => {
    runs.push(status.available);
    return Promise.resolve(status);
  };
  const failed = { available: false, reason: "the sandbox did not answer within 10000 ms" };
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(await checkCodemodeSandbox({ selfTest: selfTest(failed) }), failed);
    assert.deepEqual(await peekCodemodeSandbox(), { checked: true, ...failed });
    // Sessions starting within the minute read the failure.
    assert.deepEqual(await checkCodemodeSandbox({ selfTest: selfTest({ available: true }) }), failed);
    assert.deepEqual(runs, [false]);
    const later = Date.now() + 61_000;
    let pass;
    const retry = checkCodemodeSandbox({ now: later, selfTest: () => new Promise((resolve) => { pass = resolve; }) });
    assert.deepEqual(await peekCodemodeSandbox(), { checked: true, ...failed }, "a retry still running keeps the failure shown");
    pass({ available: true });
    runs.push(true);
    assert.deepEqual(await retry, { available: true });
    assert.deepEqual(await peekCodemodeSandbox(), { checked: true, available: true });
    assert.deepEqual(await checkCodemodeSandbox({ now: later + 3_600_000, selfTest: selfTest(failed) }), { available: true });
    assert.deepEqual(runs, [false, true]);
  } finally {
    console.warn = warn;
    delete globalThis[Symbol.for("pi-web.codemodeSandboxCheck")];
  }
});

test("Settings reads the sandbox self-test's result without ever starting it", async (t) => {
  const key = Symbol.for("pi-web.codemodeSandboxCheck");
  const previous = globalThis[key];
  t.after(() => {
    if (previous === undefined) delete globalThis[key];
    else globalThis[key] = previous;
  });
  delete globalThis[key];
  assert.deepEqual(await peekCodemodeSandbox(), { checked: false });
  assert.equal(globalThis[key], undefined, "peeking started no self-test");

  let settle;
  globalThis[key] = {
    result: new Promise((resolve) => {
      settle = resolve;
    }),
  };
  assert.deepEqual(await peekCodemodeSandbox(), { checked: false }, "still running");
  settle({ available: false, reason: "no wasm" });
  await globalThis[key].result;
  assert.deepEqual(await peekCodemodeSandbox(), { checked: true, available: false, reason: "no wasm" });
  globalThis[key] = { result: Promise.resolve({ available: true }) };
  assert.deepEqual(await peekCodemodeSandbox(), { checked: true, available: true });
});

test("the extensions settings switch built-ins off as the session's resource loader would", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-builtin-switches-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const agentDir = join(dir, "agent");
  const cwd = join(dir, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(join(cwd, ".pi"), { recursive: true });
  const globalPath = join(agentDir, "settings.json");
  const projectPath = join(cwd, ".pi", "settings.json");
  const on = { enabled: true };
  const read = (projectTrusted = true) => readBuiltinExtensionSwitches({ agentDir, cwd, projectTrusted });

  assert.deepEqual(await read(), { codemode: on, "tool-search": on });

  // Never installs: a configured package that is missing is not even looked up.
  await writeFile(globalPath, JSON.stringify({ extensions: ["-builtin:tool-search"], packages: ["npm:pi-web-test-not-a-package"] }));
  assert.deepEqual(await read(), { codemode: on, "tool-search": { enabled: false, settingsPath: globalPath } });

  // A trusted project's entry overrides the global one; an untrusted project's is not read. Each
  // switch then also says what the global list alone makes of it, for a global setting to be weighed against.
  await writeFile(projectPath, JSON.stringify({ extensions: ["+builtin:tool-search", "-builtin:codemode"] }));
  assert.deepEqual(await read(), {
    codemode: { enabled: false, settingsPath: projectPath, global: on },
    "tool-search": { ...on, global: { enabled: false, settingsPath: globalPath } },
  });
  assert.deepEqual(await read(false), { codemode: on, "tool-search": { enabled: false, settingsPath: globalPath } });
  assert.deepEqual(
    await readBuiltinExtensionSwitches({ agentDir, projectTrusted: true }),
    { codemode: on, "tool-search": { enabled: false, settingsPath: globalPath } },
    "without a project only the global settings count",
  );

  // Patterns follow the SDK's rules, not a string comparison.
  await writeFile(globalPath, `﻿${JSON.stringify({ extensions: ["!builtin:*", "+builtin:tool-search"] })}`);
  await rm(projectPath);
  const off = { enabled: false, settingsPath: globalPath };
  assert.deepEqual(await read(), { codemode: off, "tool-search": on });

  await writeFile(globalPath, "{ not json");
  assert.deepEqual(await read(), { codemode: on, "tool-search": on }, "an unparsable file counts as empty, as in the SDK");
});

test("a trusted project's settings that are not a regular file never stall the switches read", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-builtin-switches-fifo-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const agentDir = join(dir, "agent");
  const cwd = join(dir, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(join(cwd, ".pi"), { recursive: true });
  const projectPath = join(cwd, ".pi", "settings.json");
  const read = () => readBuiltinExtensionSwitches({ agentDir, cwd, projectTrusted: true });

  // A directory, and a file past the cap, throw as an unreadable file does; the overview then keeps the built-ins on.
  await mkdir(projectPath);
  await assert.rejects(read(), /not a regular file/);
  await rm(projectPath, { recursive: true });
  await writeFile(projectPath, `{"extensions":[],"pad":"${"x".repeat(1024 * 1024)}"}`);
  await assert.rejects(read(), /larger than/);
  if (process.platform !== "win32") {
    // A plain readFileSync() would wait on a FIFO until something writes to it, holding the whole server.
    await rm(projectPath);
    execFileSync("mkfifo", [projectPath]);
    await assert.rejects(read(), /not a regular file/);
    // Untrusted, the project's file is never opened at all.
    assert.deepEqual(
      await readBuiltinExtensionSwitches({ agentDir, cwd, projectTrusted: false }),
      { codemode: { enabled: true }, "tool-search": { enabled: true }, mcp: { enabled: true } },
    );
  }
});
