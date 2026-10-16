const mapping = require("../config/sharedFields");
const { SHARED_SCHEMA_CACHE_MS } = require("../config/thresholds");
const warned = new Set();
function warnOnce(key) {
  if (!warned.has(key)) { warned.add(key); console.warn(`C3 skipped unavailable shared fields: ${key}`); }
}
function createReader(database) {
  const cache = new Map();
  async function columns(table) {
    const existing = cache.get(table);
    if (existing && Date.now() - existing.time < SHARED_SCHEMA_CACHE_MS) return existing.names;
    const [rows] = await database.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [table]);
    const names = new Set(rows.map((row) => row.COLUMN_NAME));
    cache.set(table, { time: Date.now(), names });
    return names;
  }
  async function read(table, where = {}, order = "id") {
    if (!Object.hasOwn(mapping, table)) throw new Error("Unsupported shared table");
    try {
      const available = await columns(table);
      const actual = Object.fromEntries(Object.entries(mapping[table]).map(([name, aliases]) => [name, aliases.find((alias) => available.has(alias))]));
      const required = table === "interview_sessions" ? ["id", "user_id"] : table === "interview_qa_logs" ? ["id", "session_id"] : ["id"];
      if ([...required, ...Object.keys(where)].some((name) => !actual[name])) { warnOnce(table); return []; }
      const quote = (name) => { if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error("Invalid configured identifier"); return `\`${name}\``; };
      const projection = Object.entries(actual).map(([name, column]) => `${column ? quote(column) : "NULL"} AS ${quote(name)}`).join(", ");
      const keys = Object.keys(where);
      const filter = keys.length ? ` WHERE ${keys.map((name) => `${quote(actual[name])} = ?`).join(" AND ")}` : "";
      const sort = actual[order] ? ` ORDER BY ${quote(actual[order])} ASC` : "";
      const [rows] = await database.query(`SELECT ${projection} FROM ${quote(table)}${filter}${sort}`, keys.map((name) => where[name]));
      return rows;
    } catch (_error) { warnOnce(table); return []; }
  }
  return {
    read,
    async session(id, userId) { return (await read("interview_sessions", userId == null ? { id } : { id, user_id: userId }))[0] || null; },
    sessions(userId) { return read("interview_sessions", userId == null ? {} : { user_id: userId }); },
    questions(sessionId) { return read("interview_qa_logs", { session_id: sessionId }, "question_number"); },
    users() { return read("users"); },
  };
}
module.exports = { createReader };
