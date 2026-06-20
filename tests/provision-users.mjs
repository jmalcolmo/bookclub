// ============================================================================
// One-time helper: provision two test users in the DEV Supabase project and
// write their creds to .passwords/test-users.json (git-ignored).
//
// Run:  node tests/provision-users.mjs
//
// Works when the dev project allows email sign-ups. If "Confirm email" is ON in
// the dev project, the users are created but must be confirmed before sign-in —
// the script tells you which case you're in.
// If a service_role key is provided (SUPABASE_SERVICE_ROLE), it creates them
// pre-confirmed via the admin API (best path).
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const URL = process.env.SUPABASE_URL || "https://wwzvwjhohkyudytoqvfl.supabase.co";
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_oWZKSlHJFMQDSiAt-3SwOA_xslAn-_s";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || null;

const users = {
  a: { email: process.env.TEST_A_EMAIL || "reading-room-test-a@example.com", password: process.env.TEST_A_PASSWORD || `T-${randomUUID()}` },
  b: { email: process.env.TEST_B_EMAIL || "reading-room-test-b@example.com", password: process.env.TEST_B_PASSWORD || `T-${randomUUID()}` },
};

const outPath = ".passwords/test-users.json";
// Preserve existing passwords if the file already exists (so reruns are stable).
if (existsSync(outPath)) {
  try {
    const prev = JSON.parse(readFileSync(outPath, "utf8"));
    if (prev.a?.email) users.a = prev.a;
    if (prev.b?.email) users.b = prev.b;
  } catch {}
}

let mode = "anon sign-up";
let needsConfirm = false;

if (SERVICE_ROLE) {
  mode = "admin (pre-confirmed)";
  const admin = createClient(URL, SERVICE_ROLE, { auth: { persistSession: false } });
  for (const key of ["a", "b"]) {
    const u = users[key];
    const { error } = await admin.auth.admin.createUser({ email: u.email, password: u.password, email_confirm: true });
    if (error && !/already/i.test(error.message)) { console.error(`  ✗ create ${u.email}: ${error.message}`); }
    else console.log(`  ✓ ${u.email} ready (admin)`);
  }
} else {
  const c = createClient(URL, PUB, { auth: { persistSession: false } });
  for (const key of ["a", "b"]) {
    const u = users[key];
    const { data, error } = await c.auth.signUp({ email: u.email, password: u.password });
    if (error && /already registered/i.test(error.message)) {
      console.log(`  • ${u.email} already exists (keeping stored password if any)`);
    } else if (error) {
      console.error(`  ✗ ${u.email}: ${error.message}`);
    } else if (data.session) {
      console.log(`  ✓ ${u.email} created and ready (sign-ups are open / confirmation off)`);
    } else {
      needsConfirm = true;
      console.log(`  • ${u.email} created but needs email confirmation`);
    }
  }
}

mkdirSync(".passwords", { recursive: true });
writeFileSync(outPath, JSON.stringify(users, null, 2) + "\n");
console.log(`\nWrote ${outPath} (git-ignored). Mode: ${mode}.`);
if (needsConfirm) {
  console.log(`\n⚠ Email confirmation is ON in this project. Either:`);
  console.log(`   - confirm both users in the dashboard (Authentication → Users → ... → Confirm), or`);
  console.log(`   - turn off "Confirm email" for the dev project (Authentication → Sign In / Providers → Email), or`);
  console.log(`   - rerun with SUPABASE_SERVICE_ROLE set to create them pre-confirmed.`);
} else {
  console.log(`\nNext: npm test`);
}
