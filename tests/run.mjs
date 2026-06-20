// ============================================================================
// The Reading Room — end-to-end action test (against the DEV Supabase project)
// ----------------------------------------------------------------------------
// Exercises every user action EXCEPT Google login (which can't be automated).
// Instead it signs two test users in by password and drives the real database
// through the same RLS the app relies on — including the spoiler gate.
//
// Run:  npm test
// Needs: two test users in the DEV project + their creds (see the `test` skill).
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

// ---- config (dev project; publishable key + URL are public-safe) ------------
const URL = process.env.SUPABASE_URL || "https://wwzvwjhohkyudytoqvfl.supabase.co";
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_oWZKSlHJFMQDSiAt-3SwOA_xslAn-_s";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || null; // optional, for auto-provision/cleanup

function loadCreds() {
  const path = ".passwords/test-users.json";
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  if (process.env.TEST_A_EMAIL && process.env.TEST_B_EMAIL) {
    return {
      a: { email: process.env.TEST_A_EMAIL, password: process.env.TEST_A_PASSWORD },
      b: { email: process.env.TEST_B_EMAIL, password: process.env.TEST_B_PASSWORD },
    };
  }
  return null;
}

// ---- tiny test harness ------------------------------------------------------
const results = [];
async function step(name, fn) {
  try { await fn(); results.push([true, name]); console.log(`  ✓ ${name}`); }
  catch (e) { results.push([false, name, e.message]); console.log(`  ✗ ${name}\n      → ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const client = () => createClient(URL, PUB, { auth: { persistSession: false, autoRefreshToken: false } });

// ---- main -------------------------------------------------------------------
const creds = loadCreds();
if (!creds) {
  console.error(`
No test users configured. The test signs in two real DEV users by password.

One-time setup:
  1. In the DEV Supabase project (wwzvwjhohkyudytoqvfl) → Authentication → Users →
     "Add user" twice (these create confirmed email/password users).
  2. Save their creds to .passwords/test-users.json (git-ignored):
     { "a": { "email": "...", "password": "..." },
       "b": { "email": "...", "password": "..." } }
  (Or set TEST_A_EMAIL/TEST_A_PASSWORD/TEST_B_EMAIL/TEST_B_PASSWORD env vars.)
`);
  process.exit(2);
}

// Optionally provision the users if a service_role key is provided.
if (SERVICE_ROLE) {
  const admin = createClient(URL, SERVICE_ROLE, { auth: { persistSession: false } });
  for (const u of [creds.a, creds.b]) {
    await admin.auth.admin.createUser({ email: u.email, password: u.password, email_confirm: true })
      .catch(() => {}); // ignore "already registered"
  }
}

const cA = client();
const cB = client();
let A, B, club, book;
const tag = Date.now();

console.log(`\nThe Reading Room — action test (dev)\n`);

await step("sign in user A (password)", async () => {
  const { data, error } = await cA.auth.signInWithPassword({ email: creds.a.email, password: creds.a.password });
  if (error) throw new Error(error.message + " — is the test user created & confirmed?");
  A = data.user;
});
await step("sign in user B (password)", async () => {
  const { data, error } = await cB.auth.signInWithPassword({ email: creds.b.email, password: creds.b.password });
  if (error) throw error;
  B = data.user;
});
if (!A || !B) { summarize(); process.exit(1); }

await step("Open Library lookup returns results", async () => {
  const res = await fetch("https://openlibrary.org/search.json?q=project+hail+mary&limit=3&fields=key,title,cover_i");
  const json = await res.json();
  assert((json.docs || []).length > 0, "no results from Open Library");
});

await step("A creates a club", async () => {
  const { data, error } = await cA.from("clubs").insert({
    name: `Test Club ${tag}`, description: "automated test", accent: "yarn-sage", created_by: A.id,
  }).select().single();
  if (error) throw error;
  club = data;
  assert(club.join_code?.length === 6, "join code not generated");
});

await step("A is auto-added as creator member (trigger)", async () => {
  const { data, error } = await cA.from("club_members").select("*").eq("club_id", club.id).eq("user_id", A.id).single();
  if (error) throw error;
  assert(data.role === "creator", `creator should have role 'creator', got '${data.role}'`);
});

await step("B finds the club by code (RPC, not enumeration)", async () => {
  const { data, error } = await cB.rpc("find_club_by_code", { _code: club.join_code });
  if (error) throw error;
  assert(data?.[0]?.id === club.id, "RPC did not return the club");
});

await step("B cannot read the club before joining (RLS)", async () => {
  const { data } = await cB.from("clubs").select("*").eq("id", club.id);
  assert((data || []).length === 0, "non-member could read club row directly");
});

await step("B joins the club", async () => {
  const { error } = await cB.from("club_members").insert({ club_id: club.id, user_id: B.id, role: "member" });
  if (error) throw error;
});

await step("B can now read the club", async () => {
  const { data, error } = await cB.from("clubs").select("*").eq("id", club.id).single();
  if (error) throw error;
  assert(data.id === club.id, "member cannot read club");
});

await step("A adds the current book", async () => {
  const { data, error } = await cA.from("books").insert({
    club_id: club.id, title: `Test Book ${tag}`, author: "Tester", page_count: 300, picked_by: A.id, status: "current",
  }).select().single();
  if (error) throw error;
  book = data;
});

await step("A logs reading progress (page 50)", async () => {
  const { error } = await cA.from("reading_progress").upsert(
    { book_id: book.id, user_id: A.id, current_page: 50, status: "reading" }, { onConflict: "book_id,user_id" });
  if (error) throw error;
});

await step("A posts a reaction at page 30", async () => {
  const { error } = await cA.from("reactions").insert({ book_id: book.id, user_id: A.id, page: 30, body: "early thought" });
  if (error) throw error;
});
await step("A posts a reaction at page 200", async () => {
  const { error } = await cA.from("reactions").insert({ book_id: book.id, user_id: A.id, page: 200, body: "late twist!" });
  if (error) throw error;
});

await step("B logs progress (page 40)", async () => {
  const { error } = await cB.from("reading_progress").upsert(
    { book_id: book.id, user_id: B.id, current_page: 40, status: "reading" }, { onConflict: "book_id,user_id" });
  if (error) throw error;
});

await step("SPOILER GATE: B sees p.30 but NOT p.200", async () => {
  const { data, error } = await cB.from("reactions").select("page").eq("book_id", book.id);
  if (error) throw error;
  const pages = (data || []).map((r) => r.page).sort((x, y) => x - y);
  assert(pages.includes(30), "B should see the page-30 reaction (read past it)");
  assert(!pages.includes(200), "SPOILER LEAK: B saw the page-200 reaction past their progress");
});

await step("author sees all own reactions (A sees p.30 and p.200)", async () => {
  const { data } = await cA.from("reactions").select("page").eq("book_id", book.id);
  const pages = (data || []).map((r) => r.page);
  assert(pages.includes(30) && pages.includes(200), "author cannot see own reactions");
});

await step("B advances to p.250 and now sees p.200", async () => {
  await cB.from("reading_progress").upsert(
    { book_id: book.id, user_id: B.id, current_page: 250, status: "reading" }, { onConflict: "book_id,user_id" });
  const { data } = await cB.from("reactions").select("page").eq("book_id", book.id);
  assert((data || []).map((r) => r.page).includes(200), "B should see p.200 after reading past it");
});

await step("A finishes the book and writes a review", async () => {
  await cA.from("reading_progress").upsert(
    { book_id: book.id, user_id: A.id, current_page: 300, status: "finished" }, { onConflict: "book_id,user_id" });
  const { error } = await cA.from("reviews").upsert(
    { book_id: book.id, user_id: A.id, rating: 4, body: "solid read" }, { onConflict: "book_id,user_id" });
  if (error) throw error;
});

await step("REVIEW GATE: B (not finished) cannot see A's review", async () => {
  await cB.from("reading_progress").upsert(
    { book_id: book.id, user_id: B.id, current_page: 250, status: "reading" }, { onConflict: "book_id,user_id" });
  const { data } = await cB.from("reviews").select("id").eq("book_id", book.id);
  assert((data || []).length === 0, "REVIEW LEAK: B saw a review before finishing");
});

await step("B finishes and now sees A's review", async () => {
  await cB.from("reading_progress").upsert(
    { book_id: book.id, user_id: B.id, current_page: 300, status: "finished" }, { onConflict: "book_id,user_id" });
  const { data } = await cB.from("reviews").select("id").eq("book_id", book.id);
  assert((data || []).length >= 1, "B should see reviews after finishing");
});

await step("picker — wheel selection records a result", async () => {
  const { data: sel, error } = await cA.from("selections").insert(
    { club_id: club.id, method: "wheel", created_by: A.id, status: "decided", result_user: B.id, decided_at: new Date().toISOString() }
  ).select().single();
  if (error) throw error;
  assert(sel.result_user === B.id, "selection result not stored");
});

await step("picker — vote: open, both cast, tally = 2", async () => {
  const { data: vote, error } = await cA.from("selections").insert(
    { club_id: club.id, method: "vote", created_by: A.id, status: "open" }).select().single();
  if (error) throw error;
  await cA.from("selection_votes").upsert({ selection_id: vote.id, voter_id: A.id, candidate_id: B.id }, { onConflict: "selection_id,voter_id" });
  await cB.from("selection_votes").upsert({ selection_id: vote.id, voter_id: B.id, candidate_id: B.id }, { onConflict: "selection_id,voter_id" });
  const { data: votes } = await cA.from("selection_votes").select("*").eq("selection_id", vote.id);
  assert((votes || []).length === 2, "expected 2 votes");
});

await step("mark book finished → appears in history", async () => {
  await cA.from("books").update({ status: "finished", finished_at: new Date().toISOString() }).eq("id", book.id);
  const { data } = await cA.from("books").select("id").eq("club_id", club.id).eq("status", "finished");
  assert((data || []).some((b) => b.id === book.id), "finished book not in history");
});

await step("profile update", async () => {
  const { error } = await cA.from("profiles").update({ display_name: `Tester A ${tag}` }).eq("id", A.id);
  if (error) throw error;
});

await step("B can leave the club", async () => {
  const { error } = await cB.from("club_members").delete().eq("club_id", club.id).eq("user_id", B.id);
  if (error) throw error;
});

// ---- cleanup ----------------------------------------------------------------
await step("cleanup: A deletes the club (cascades)", async () => {
  const { error } = await cA.from("clubs").delete().eq("id", club.id);
  if (error) throw error;
});

summarize();

function summarize() {
  const passed = results.filter((r) => r[0]).length;
  const failed = results.length - passed;
  console.log(`\n──────────────────────────────────────`);
  console.log(`  ${passed} passed, ${failed} failed, ${results.length} total`);
  if (failed) {
    console.log(`\nFailures:`);
    results.filter((r) => !r[0]).forEach((r) => console.log(`  ✗ ${r[1]}\n      ${r[2]}`));
  }
  console.log(``);
  process.exit(failed ? 1 : 0);
}
