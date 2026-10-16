const { createHmac, randomBytes } = require("node:crypto");
const sessionSecret = randomBytes(32);
function pseudonym(kind, id) {
  return `${kind}_${createHmac("sha256", process.env.JWT_SECRET || sessionSecret).update(`c3:${kind}:${id}`).digest("hex").slice(0, 20)}`;
}
function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value) => {
    let text = value == null ? "" : String(value);
    // Avoid spreadsheet formula execution when an export is opened in Excel.
    if (/^[=+@\t\r]/.test(text) || /^-(?!\d)/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((key) => escape(row[key])).join(","))].join("\n");
}
module.exports = { pseudonym, toCsv };
