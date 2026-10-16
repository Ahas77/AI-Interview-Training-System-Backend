const { pool } = require("../../config/db");
const store = require("../models/store");
const { backfillSession } = require("../services/observationHandlers");
async function backfill() {
  let count = 0;
  for (const session of await store.reader.sessions()) {
    if (await backfillSession(session.id, session.user_id)) count++;
  }
  return count;
}
module.exports = { backfill };
if (require.main === module) {
  require("../db/initC3").initC3().then((ok) => { if (!ok) throw new Error("C3 migration failed"); return backfill(); })
    .then((count) => console.log(`C3 backfill complete: ${count} interviews; unknown latency stays null.`))
    .catch(() => { console.error("C3 backfill could not finish; safe to retry."); process.exitCode = 1; }).finally(() => pool.end());
}
