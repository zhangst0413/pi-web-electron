import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { getAgentsBadge, getSessionFamily, listSessionFamilies } = await createJiti(import.meta.url).import("./session-family.ts");

function session(id, modified, relation) {
  return {
    path: `/tmp/${id}.jsonl`,
    id,
    cwd: "/tmp",
    created: modified,
    modified,
    messageCount: 1,
    firstMessage: id,
    ...(relation ? { relation } : {}),
  };
}

test("groups nested side chats under their main session and uses family activity for sorting", () => {
  const main = session("main", "2026-01-01T00:00:00.000Z");
  const child = session("child", "2026-01-04T00:00:00.000Z", {
    kind: "side", parentSessionId: "main",
  });
  const grandchild = session("grandchild", "2026-01-03T00:00:00.000Z", {
    kind: "side", parentSessionId: "child",
  });
  const newerRoot = session("newer-root", "2026-01-02T00:00:00.000Z");

  const families = listSessionFamilies([main, child, grandchild, newerRoot]);
  assert.deepEqual(families.map((family) => family.root.id), ["main", "newer-root"]);
  assert.deepEqual(families[0].members.map((item) => item.id), ["child", "grandchild"]);
  assert.equal(getSessionFamily([main, child, grandchild], "grandchild")?.root.id, "main");
});

test("does not promote orphaned or cyclic side chat metadata into the main session list", () => {
  const orphan = session("orphan", "2026-01-03T00:00:00.000Z", {
    kind: "side", parentSessionId: "missing",
  });
  const a = session("a", "2026-01-01T00:00:00.000Z", { kind: "side", parentSessionId: "b" });
  const b = session("b", "2026-01-02T00:00:00.000Z", { kind: "side", parentSessionId: "a" });

  assert.deepEqual(listSessionFamilies([orphan, a, b]), []);
  assert.equal(getSessionFamily([orphan, a, b], "orphan"), null);
});

test("a fork is a family of its own, and its side chats fold into it, not into its origin", () => {
  const origin = session("origin", "2026-01-01T00:00:00.000Z");
  const fork = session("fork", "2026-01-01T00:00:00.000Z", { kind: "fork", originSessionId: "origin" });
  const forkSide = session("fork-side", "2026-01-02T00:00:00.000Z", {
    kind: "side", parentSessionId: "fork",
  });

  const families = listSessionFamilies([fork, origin, forkSide]);
  assert.deepEqual(families.map((family) => family.root.id), ["fork", "origin"]);
  assert.deepEqual(families[0].members.map((item) => item.id), ["fork-side"]);
  assert.deepEqual(families[1].members, []);
  assert.equal(getSessionFamily([fork, origin, forkSide], "fork-side")?.root.id, "fork");
});

test("the Agents badge counts running members while any runs, else all of them", () => {
  const members = ["a", "b", "c"].map((id) => session(id, "2026-01-01T00:00:00.000Z", {
    kind: "side", parentSessionId: "main",
  }));

  assert.deepEqual(getAgentsBadge(members, new Set()), { count: 3, running: false });
  // The main session and other families' runs do not count.
  assert.deepEqual(getAgentsBadge(members, new Set(["main", "elsewhere"])), { count: 3, running: false });
  assert.deepEqual(getAgentsBadge(members, new Set(["b"])), { count: 1, running: true });
  assert.deepEqual(getAgentsBadge(members, new Set(["a", "c", "main"])), { count: 2, running: true });
});
