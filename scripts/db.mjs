// ============================================================================
// Ad-hoc SQL runner against a Supabase Postgres project (DDL-capable).
// ----------------------------------------------------------------------------
// The supabase-js client speaks PostgREST only (no DDL/RLS), so schema and
// policy work needs a real Postgres connection — that's what this is for.
//
// Connection string is read from (in order):
//   1. $DATABASE_URL
//   2. .passwords/prod-db-url.txt   (git-ignored; the prod Session-pooler URI)
//
// The secret is NEVER printed.
//
// Usage:
//   node scripts/db.mjs --file path/to.sql      # run a .sql file
//   node scripts/db.mjs --sql "select 1;"       # run an inline statement
//   node scripts/db.mjs --file x.sql --commit   # wrap in a txn and COMMIT
//                                                 (default is rollback = dry run)
// ============================================================================
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";

function connString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL.trim();
  const f = ".passwords/prod-db-url.txt";
  if (existsSync(f)) return readFileSync(f, "utf8").trim();
  console.error("No connection string. Set $DATABASE_URL or create .passwords/prod-db-url.txt");
  process.exit(2);
}

const args = process.argv.slice(2);
function flag(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }
const commit = args.includes("--commit");
const sql = flag("--sql") || (flag("--file") ? readFileSync(flag("--file"), "utf8") : null);
if (!sql) { console.error("Provide --sql \"...\" or --file path.sql"); process.exit(2); }

const client = new pg.Client({ connectionString: connString(), ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query("begin");
  const res = await client.query(sql);
  const sets = Array.isArray(res) ? res : [res];
  for (const r of sets) {
    if (r.command) console.log(`-- ${r.command}${r.rowCount != null ? ` (${r.rowCount})` : ""}`);
    if (r.rows?.length) console.table(r.rows);
  }
  if (commit) { await client.query("commit"); console.log("\n✅ COMMITTED"); }
  else { await client.query("rollback"); console.log("\n↩️  ROLLED BACK (dry run — re-run with --commit to persist)"); }
} catch (e) {
  await client.query("rollback").catch(() => {});
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
} finally {
  await client.end();
}
