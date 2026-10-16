const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createReader } = require("../models/sharedReader");
const { statements, initC3 } = require("../db/initC3");
const { toCsv, pseudonym } = require("../services/privacy");
const { detectDriftFromSessions } = require("../services/drift");

test("C3 migration only creates prefixed tables and has no ALTER or DROP", () => {
  assert.equal(statements.length, 8);
  for (const sql of statements) {
    assert.match(sql, /^CREATE TABLE IF NOT EXISTS c3_/);
    assert.doesNotMatch(sql, /\bALTER\b|\bDROP\b/i);
  }
});

test("C3 migration failure does not throw into server startup", async () => {
  assert.equal(await initC3({ query: async () => { throw new Error("DB error"); } }), false);
});

test("missing or renamed shared columns degrade safely and use SELECT only", async () => {
  const queries = [];
  const database = { query: async (sql, values) => {
    queries.push([sql, values]);
    if (sql.includes("INFORMATION_SCHEMA")) return [[{ COLUMN_NAME: "id" }, { COLUMN_NAME: "userId" }]];
    return [[{ id: 12, user_id: 7 }]];
  } };
  const reader = createReader(database);
  assert.equal((await reader.session(12, 7)).id, 12);
  assert.match(queries[1][0], /`userId` = \?/);
  assert.deepEqual(queries[1][1], [12, 7]);
  assert.ok(queries.every(([sql]) => sql.startsWith("SELECT")));
  assert.doesNotMatch(queries[1][0], /SELECT \*/);
  const absent = createReader({ query: async () => [[]] });
  assert.equal(await absent.session(1, 7), null);
});

test("pseudonyms are deterministic and never expose the database id", () => {
  assert.equal(pseudonym("user", 5), pseudonym("user", 5));
  assert.notEqual(pseudonym("user", 5), pseudonym("session", 5));
  assert.match(pseudonym("user", 5), /^user_[a-f0-9]{20}$/);
});

test("CSV protects formulas, quotes and multiline text", () => {
  assert.equal(toCsv([{ value: '=HYPERLINK("url")' }]), 'value\n"\'=HYPERLINK(""url"")"');
  assert.equal(toCsv([{ value: "line\nbreak" }]), 'value\n"line\nbreak"');
});

test("drift without enough sessions returns insufficient data", () => {
  assert.equal(detectDriftFromSessions([]).status, "insufficient data");
  const emptySessions = Array.from({ length: 4 }, (_, i) => ({ session: { session_number: i + 1 }, summaries: [], aggregate: { average_metrics: {} } }));
  assert.equal(detectDriftFromSessions(emptySessions).status, "insufficient data");
});

test("normal sidecar code never writes to shared tables", () => {
  function walk(folder) { return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(folder, entry.name)) : [path.join(folder, entry.name)]); }
  for (const file of walk(path.join(__dirname, "..")).filter((file) => file.endsWith(".js") && !file.includes(`${path.sep}tests${path.sep}`) && !file.endsWith(`${path.sep}seed.js`))) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /(?:INSERT\s+(?:IGNORE\s+)?INTO|UPDATE|DELETE\s+FROM|ALTER\s+TABLE)\s+(?:users|cv_analysis|interview_sessions|interview_qa_logs)\b/i, file);
  }
});
