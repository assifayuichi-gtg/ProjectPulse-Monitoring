import assert from "node:assert/strict";
import { test } from "node:test";

test("chat proposals require admin approval and preserve snapshot rules", async (t) => {
  const actionKey = "a".repeat(64);
  const settings = new Map([
    ["PROJECTPULSE_CHATGPT_ACTION_KEY", actionKey],
    ["SUPABASE_URL", "https://example.invalid"],
    ["SUPABASE_SERVICE_ROLE_KEY", "mock-server-key"],
  ]);
  let serve;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.endsWith("/auth/v1/user")) {
      const admin = options.headers.Authorization === "Bearer admin-session";
      return Response.json({ id: "reviewer", app_metadata: { projectpulse_role: admin ? "admin" : "member" } });
    }
    if (url.includes("/projectpulse_state?")) return Response.json([state]);
    if (url.includes("/projectpulse_pic_links?")) return Response.json(links);
    assert.match(url, /\/rpc\/projectpulse_put_state$/);
    const { p_payload, p_expected_revision } = JSON.parse(options.body);
    if (p_expected_revision !== state.revision) return Response.json([]);
    state = { payload: p_payload, revision: state.revision + 1 };
    writes++;
    return Response.json([{ revision: state.revision }]);
  });
  globalThis.Deno = { env: settings, serve: (handler) => { serve = handler; } };
  t.after(() => { delete globalThis.Deno; });
  await import("../supabase/functions/projectpulse-chatgpt/index.ts");

  let writes = 0;
  let links = [];
  let state = { revision: 5, payload: {
    projects: [{ id: "p", code: "42", name: "Repair" }],
    tasks: [{ id: "t", name: "Pump", projectId: "p", wbs: [{ id: "keep" }] }],
    subs: [
      { id: "a", taskId: "t", name: "Inspect", progress: 10 },
      { id: "b", taskId: "t", name: "Replace", dependsOn: ["a"], pic: "Huda" },
    ],
    activity: [],
  } };
  const call = async (op, body, credential = actionKey) => {
    const response = await serve(new Request("https://example.invalid/projectpulse-chatgpt/" + op, {
      method: "POST", headers: { Authorization: "Bearer " + credential }, body: JSON.stringify(body),
    }));
    return { status: response.status, data: await response.json() };
  };
  const propose = async (id, patch, kind = "subtask") => {
    const response = await call("propose", { id, patch, kind });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return new URL(response.data.approvalUrl).hash.slice(9);
  };

  assert.equal((await call("search", { project: "42" }, "wrong")).status, 401);
  const found = await call("search", { project: "42", keyword: "replace" });
  assert.equal(found.data.items[0].taskId, "t");
  assert.equal((await call("propose", { kind: "task", id: "t", patch: { progress: 50 } })).status, 400);
  assert.equal((await call("propose", { kind: "subtask", id: "b", patch: { progress: 50 } })).status, 409);
  assert.equal((await call("propose", { kind: "subtask", id: "a", patch: { progress: 101 } })).status, 400);
  const token = await propose("a", { progress: 100, note: "Selesai diperiksa" });
  const stale = await propose("t", { name: "Pump assembly" }, "task");
  assert.equal(writes, 0);
  assert.equal((await call("apply", { token }, "member-session")).status, 403);
  const altered = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
  assert.equal((await call("apply", { token: altered }, "admin-session")).status, 403);
  const reviewed = await call("review", { token }, "admin-session");
  assert.deepEqual(reviewed.data.preview.changes.progress, { before: 10, after: 100 });
  assert.equal(writes, 0);
  assert.equal((await call("apply", { token }, "admin-session")).data.status, "applied");
  assert.equal(state.payload.subs[0].status, "Selesai");
  assert.equal(state.payload.subs[0].history[0].progress, 100);
  assert.equal(state.payload.activity[0].approvedBy, "reviewer");
  assert.equal(state.payload.tasks[0].wbs[0].id, "keep");
  assert.equal((await call("apply", { token }, "admin-session")).data.status, "already_applied");
  assert.equal((await call("apply", { token: stale }, "admin-session")).status, 409);
  assert.equal(writes, 1);

  const reassignment = await propose("b", { pic: "Bima", progress: 75 });
  links = [{ payload: { items: [{ id: "b", taskId: "t" }] } }];
  assert.equal((await call("apply", { token: reassignment }, "admin-session")).status, 409);
  links = [];
  assert.equal((await call("apply", { token: reassignment }, "admin-session")).data.status, "applied");
  assert.equal(state.payload.subs[1].pic, "Bima");
  assert.equal(state.payload.subs[1].progress, 75);

  const expiring = await propose("t", { description: "Test" }, "task");
  const later = Date.now() + 11 * 60 * 1000;
  t.mock.method(Date, "now", () => later);
  assert.equal((await call("apply", { token: expiring }, "admin-session")).status, 410);
  assert.equal(writes, 2);
});
