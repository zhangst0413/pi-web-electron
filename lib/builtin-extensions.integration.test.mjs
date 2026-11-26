import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxProvider } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(join(tmpdir(), "pi-web-builtins-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { createPiWebBuiltinExtensions } = await jiti.import("./builtin-extensions.ts");

test.after(() => rm(agentDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }));

async function startSession(t, { settings = {}, extensionFactories = [] } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-builtins-cwd-"));
  const faux = fauxProvider({ models: [{ id: "faux-builtins" }] });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory(settings);
  // Built-in extensions load as `builtin:<name>` resources, which `noExtensions` would disable.
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    extensionFactories: [...(await createPiWebBuiltinExtensions()).extensions, ...extensionFactories],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    model: faux.getModel("faux-builtins"),
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager,
    resourceLoader,
  });
  const wrapper = new AgentSessionWrapper(session);
  wrapper.beginExtensionBinding();
  await wrapper.waitUntilReady();
  t.after(async () => {
    wrapper.destroy();
    await rm(cwd, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  });
  return { session, faux, wrapper };
}

function toolNames(session) {
  return session.getAllTools().map((tool) => tool.name);
}

test("a normal session loads codemode and tool_search inactive", async (t) => {
  const { session } = await startSession(t);
  const names = toolNames(session);
  assert.ok(names.includes("codemode"));
  assert.ok(names.includes("tool_search"));
  assert.ok(!session.getActiveToolNames().includes("codemode"));
  assert.ok(!session.getActiveToolNames().includes("tool_search"));
});

test("defaultTools +codemode activates the built-in codemode tool", async (t) => {
  const { session } = await startSession(t, { settings: { defaultTools: ["+codemode"] } });
  assert.ok(session.getActiveToolNames().includes("codemode"));
});

test("-builtin:<name> in the extensions setting leaves that built-in out", async (t) => {
  const { session } = await startSession(t, { settings: { extensions: ["-builtin:tool-search"] } });
  assert.ok(toolNames(session).includes("codemode"));
  assert.ok(!toolNames(session).includes("tool_search"));
});
