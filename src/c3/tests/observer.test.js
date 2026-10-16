const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createObserver, snapshot } = require("../middleware/observer");
const { coreRoutes, extraRoutes } = require("../config/observedRoutes");

async function appWith(t, observer, body = { success: true, sessionId: 12, currentQuestion: { id: 41 } }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 5 }; next(); });
  app.use(observer);
  app.post("/api/interview/start", (_req, res) => res.status(201).json(body));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return async () => fetch(`http://127.0.0.1:${server.address().port}/api/interview/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "never-persist-me", token: "never-persist-me" }) });
}

test("observer handler failure preserves response status, headers and exact body", async (t) => {
  let called = false;
  const observer = createObserver({ dispatch: async () => { called = true; throw new Error("database down"); } });
  const request = await appWith(t, observer);
  const response = await request();
  assert.equal(response.status, 201);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.deepEqual(await response.json(), { success: true, sessionId: 12, currentQuestion: { id: 41 } });
  await observer.drain();
  assert.equal(called, true);
});

test("a pending handler does not delay the interview response", async (t) => {
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const observer = createObserver({ dispatch: async () => barrier });
  const response = await (await appWith(t, observer))();
  assert.equal(response.status, 201);
  assert.equal((await response.json()).success, true);
  release(); await observer.drain();
});

test("observer off is a full no-op and does not wrap res.json", async (t) => {
  let called = false;
  const observer = createObserver({ enabled: () => false, dispatch: () => { called = true; } });
  const response = await (await appWith(t, observer))();
  assert.equal(response.status, 201);
  await observer.drain();
  assert.equal(called, false);
  const res = { json() {} }; const json = res.json;
  observer({ method: "POST", url: "/api/interview/start" }, res, () => {});
  assert.equal(res.json, json);
});

test("failed operation and unrelated endpoints are not observed", () => {
  const observer = createObserver({ dispatch: () => assert.fail("unexpected handler") });
  const res = { json() {} }; const original = res.json;
  observer({ method: "POST", url: "/api/login" }, res, () => {});
  assert.equal(res.json, original);
  assert.equal(snapshot(coreRoutes[0], { user: { id: 1 }, body: {} }, { success: false, sessionId: 1 }, new Date()), null);
});

test("snapshots retain only selected numbers and labels, never secrets or images", () => {
  const rule = { ...extraRoutes[0], enabled: true, fields: { ...extraRoutes[0].fields,
    session: ["response.sessionId"], metrics: { gaze_off: ["response.data.metrics.gaze_off"], bad: ["response.image"] } } };
  const result = snapshot(rule, { user: { id: 1 }, headers: { authorization: "secret" }, body: { password: "secret", token: "secret" } },
    { sessionId: 12, image: "private-image", data: { metrics: { gaze_off: 0.3, emotion: "nervous" }, token: "secret" } }, new Date());
  assert.equal(result.metrics.gaze_off, 0.3);
  assert.deepEqual(Object.keys(result.metrics), ["gaze_off"]);
  assert.doesNotMatch(JSON.stringify(result), /secret|private-image|nervous/);
});

test("observations for the same session execute in order", async (t) => {
  const order = [];
  const observer = createObserver({ dispatch: async () => { const n = order.length; await new Promise((resolve) => setImmediate(resolve)); order.push(n); } });
  const request = await appWith(t, observer);
  await Promise.all([request(), request()]); await observer.drain();
  assert.deepEqual(order, [0, 1]);
});
