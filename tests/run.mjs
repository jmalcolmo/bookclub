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
let r30, r200;            // reaction ids (page 30 visible to B early; page 200 gated)
let replyId, lateReplyId; // reaction reply ids
let avatarPath, coverPath;
const tag = Date.now();

// A real (tiny 1×1) JPEG. The cropper bakes an image/jpeg blob and uploads it, so
// the test uploads genuine JPEG bytes — the buckets restrict allowed_mime_types.
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////" +
  "////////////////////////////////////////////////8AAEQgAAQABAwEiAAIR" +
  "AQMRAf/EABQAAQAAAAAAAAAAAAAAAAAAAAD/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QA" +
  "FAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhED" +
  "EQA/AL+AAf/Z", "base64");
const blobJ = () => new Blob([TINY_JPEG], { type: "image/jpeg" });

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

await step("PROFILE GATE: B cannot read A's profile before sharing a club (RLS)", async () => {
  // profiles_select_self_or_comember: with no club in common, A's profile is invisible.
  const { data } = await cB.from("profiles").select("id").eq("id", A.id);
  assert((data || []).length === 0, "PROFILE LEAK: a non-co-member read another user's profile");
});

await step("B joins the club", async () => {
  // Mirror the app exactly: joinClub() inserts WITH RETURNING (.select()). This is
  // load-bearing — a plain insert hides the members_select_same_club RLS bug where
  // RETURNING can't see your own just-inserted membership row. Keep the .select().
  const { error } = await cB.from("club_members")
    .insert({ club_id: club.id, user_id: B.id, role: "member" })
    .select().single();
  if (error) throw error;
});

await step("B can now read the club", async () => {
  const { data, error } = await cB.from("clubs").select("*").eq("id", club.id).single();
  if (error) throw error;
  assert(data.id === club.id, "member cannot read club");
});

await step("B can read A's profile once they share a club", async () => {
  // Positive side of PROFILE GATE: now co-members, B sees A's profile (powers rosters/avatars).
  const { data, error } = await cB.from("profiles").select("id").eq("id", A.id).single();
  if (error) throw error;
  assert(data.id === A.id, "co-member should be able to read a fellow member's profile");
});

await step("MY CLUBS: a 2-member club appears exactly once (no dupes)", async () => {
  // Mirror api.js myClubs() exactly. The membership SELECT policy returns the FULL
  // roster of clubs you belong to, so this MUST filter to your own user_id — without
  // it a club comes back once per member and shows up duplicated in "my clubs".
  // The club now has 2 members (A creator + B), which previously triggered the dupe.
  const { data: memberships, error } = await cB.from("club_members")
    .select("club_id, role").eq("user_id", B.id).order("joined_at");
  if (error) throw error;
  const ids = memberships.map((m) => m.club_id);
  const { data: clubs } = await cB.from("clubs").select("*").in("id", ids);
  const byId = Object.fromEntries((clubs || []).map((c) => [c.id, c]));
  const myClubs = memberships.map((m) => byId[m.club_id]).filter(Boolean);
  const occurrences = myClubs.filter((c) => c.id === club.id).length;
  assert(occurrences === 1, `DUPLICATE CLUB: club appeared ${occurrences}× in my clubs (expected 1)`);
});

await step("A (creator) edits club settings (updateClub)", async () => {
  const { data, error } = await cA.from("clubs")
    .update({ description: "renamed by creator", accent: "yarn-rust" })
    .eq("id", club.id).select().single();
  if (error) throw error;
  assert(data.description === "renamed by creator" && data.accent === "yarn-rust", "club settings did not update");
});

await step("CLUB UPDATE GATE: B (member, not creator) cannot edit club settings (RLS)", async () => {
  // clubs_update_owner: a non-owner UPDATE matches 0 rows silently (no error).
  await cB.from("clubs").update({ description: "hijacked" }).eq("id", club.id);
  const { data } = await cA.from("clubs").select("description").eq("id", club.id).single();
  assert(data.description !== "hijacked", "CLUB UPDATE LEAK: a non-creator member edited club settings");
});

await step("A adds the current book", async () => {
  const { data, error } = await cA.from("books").insert({
    club_id: club.id, title: `Test Book ${tag}`, author: "Tester", page_count: 300, picked_by: A.id, status: "current",
  }).select().single();
  if (error) throw error;
  book = data;
});

await step("A (creator) edits the book deadline (updateBook)", async () => {
  const dl = new Date(Date.now() + 7 * 86400000).toISOString();
  const { data, error } = await cA.from("books").update({ deadline: dl }).eq("id", book.id).select().single();
  if (error) throw error;
  assert(data.deadline, "deadline was not saved on the book");
});

await step("A reads the club's current book + books list (currentBook / clubBooks)", async () => {
  const { data: cur } = await cA.from("books").select("*").eq("club_id", club.id)
    .eq("status", "current").order("created_at", { ascending: false }).limit(1);
  assert((cur || [])[0]?.id === book.id, "current-book read did not return the book");
  const { data: all } = await cA.from("books").select("id").eq("club_id", club.id);
  assert((all || []).some((b) => b.id === book.id), "books-list read did not include the book");
});

await step("A logs reading progress (page 50)", async () => {
  const { error } = await cA.from("reading_progress").upsert(
    { book_id: book.id, user_id: A.id, current_page: 50, status: "reading" }, { onConflict: "book_id,user_id" });
  if (error) throw error;
});

await step("A posts a reaction at page 30", async () => {
  const { data, error } = await cA.from("reactions")
    .insert({ book_id: book.id, user_id: A.id, page: 30, body: "early thought" }).select().single();
  if (error) throw error;
  r30 = data.id;
});
await step("A posts a reaction at page 200", async () => {
  const { data, error } = await cA.from("reactions")
    .insert({ book_id: book.id, user_id: A.id, page: 200, body: "late twist!" }).select().single();
  if (error) throw error;
  r200 = data.id;
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

await step("DELETE REACTION: A posts then deletes a throwaway reaction", async () => {
  const { data: tmp, error } = await cA.from("reactions")
    .insert({ book_id: book.id, user_id: A.id, page: 5, body: "oops, delete me" }).select().single();
  if (error) throw error;
  const { error: delErr } = await cA.from("reactions").delete().eq("id", tmp.id);
  if (delErr) throw delErr;
  const { data } = await cA.from("reactions").select("id").eq("id", tmp.id);
  assert((data || []).length === 0, "author could not delete their own reaction");
});

await step("REACTION DELETE GATE: B cannot delete A's reaction (RLS)", async () => {
  // reactions_delete_own: only the author may delete; a non-author affects 0 rows.
  await cB.from("reactions").delete().eq("id", r30);
  const { data } = await cA.from("reactions").select("id").eq("id", r30);
  assert((data || []).length === 1, "REACTION DELETE LEAK: a non-author deleted someone else's reaction");
});

// ---- reaction replies (threads) + engagements (likes / emoji) -------------
// B is still at p.40 here: sees the p.30 reaction, NOT the p.200 one. Replies and
// engagements INHERIT the reaction's spoiler gate, so the same boundary applies.

await step("REPLY: B replies to A's visible (p.30) reaction", async () => {
  const { data, error } = await cB.from("reaction_replies")
    .insert({ reaction_id: r30, user_id: B.id, body: "ha, same" }).select().single();
  if (error) throw error;
  replyId = data.id;
});

await step("REPLY: A can read B's reply on the p.30 reaction", async () => {
  const { data } = await cA.from("reaction_replies").select("id").eq("id", replyId);
  assert((data || []).length === 1, "author of the reaction couldn't see a reply on it");
});

await step("REPLY DELETE GATE: A cannot delete B's reply (RLS)", async () => {
  // replies_delete_own: only the reply's author may delete it; others affect 0 rows.
  await cA.from("reaction_replies").delete().eq("id", replyId);
  const { data } = await cA.from("reaction_replies").select("id").eq("id", replyId);
  assert((data || []).length === 1, "REPLY DELETE LEAK: a non-author deleted someone else's reply");
});

await step("A replies to its own (p.200) gated reaction", async () => {
  const { data, error } = await cA.from("reaction_replies")
    .insert({ reaction_id: r200, user_id: A.id, body: "spoiler-y reply" }).select().single();
  if (error) throw error;
  lateReplyId = data.id;
});

await step("REPLY SPOILER GATE: B (p.40) cannot see a reply on the p.200 reaction", async () => {
  const { data } = await cB.from("reaction_replies").select("id").eq("id", lateReplyId);
  assert((data || []).length === 0, "REPLY LEAK: B saw a reply on a reaction past their progress");
});

await step("REPLY SPOILER GATE: B (p.40) cannot post a reply on the p.200 reaction", async () => {
  const { data, error } = await cB.from("reaction_replies")
    .insert({ reaction_id: r200, user_id: B.id, body: "should be blocked" }).select().single();
  assert(error && !data, "REPLY LEAK: B replied to a reaction it can't see");
});

await step("LIKE: B likes A's visible (p.30) reaction", async () => {
  const { error } = await cB.from("engagements")
    .insert({ target_type: "reaction", target_id: r30, user_id: B.id, kind: "like" });
  if (error) throw error;
  const { data } = await cA.from("engagements").select("id").eq("target_id", r30).eq("kind", "like");
  assert((data || []).length === 1, "like on a visible reaction wasn't recorded/visible");
});

await step("EMOJI: B adds an emoji tapback to the p.30 reaction", async () => {
  const { error } = await cB.from("engagements")
    .insert({ target_type: "reaction", target_id: r30, user_id: B.id, kind: "❤️" });
  if (error) throw error;
});

await step("ENGAGE GATE: B (p.40) cannot like the gated p.200 reaction", async () => {
  const { data, error } = await cB.from("engagements")
    .insert({ target_type: "reaction", target_id: r200, user_id: B.id, kind: "like" }).select().single();
  assert(error && !data, "ENGAGE LEAK: B liked a reaction it can't see");
});

await step("LIKE: B likes the book (a club-activity item any member can like)", async () => {
  const { error } = await cB.from("engagements")
    .insert({ target_type: "book", target_id: book.id, user_id: B.id, kind: "like" });
  if (error) throw error;
});

await step("ENGAGE: B un-likes the p.30 reaction (toggle off)", async () => {
  const { error } = await cB.from("engagements").delete()
    .eq("target_type", "reaction").eq("target_id", r30).eq("user_id", B.id).eq("kind", "like");
  if (error) throw error;
  const { data } = await cB.from("engagements").select("id")
    .eq("target_id", r30).eq("kind", "like").eq("user_id", B.id);
  assert((data || []).length === 0, "un-like did not remove the engagement");
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

await step("A's personal reading history includes the finished book (myReadingHistory)", async () => {
  // Mirror api.myReadingHistory(): my finished progress rows -> their books.
  const { data: prog } = await cA.from("reading_progress").select("book_id")
    .eq("user_id", A.id).eq("status", "finished");
  const ids = (prog || []).map((p) => p.book_id);
  assert(ids.includes(book.id), "finished book missing from A's reading_progress");
  const { data: books } = await cA.from("books").select("id").in("id", ids);
  assert((books || []).some((b) => b.id === book.id), "reading history did not resolve the finished book");
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

await step("REPLY GATE OPENS: B (now past p.200) sees the previously-hidden reply", async () => {
  const { data } = await cB.from("reaction_replies").select("id").eq("id", lateReplyId);
  assert((data || []).length === 1, "B should see the p.200 reply once read past it");
});

await step("ENGAGE GATE OPENS: B can now like the p.200 reaction", async () => {
  const { error } = await cB.from("engagements")
    .insert({ target_type: "reaction", target_id: r200, user_id: B.id, kind: "like" });
  if (error) throw error;
});

await step("DELETE REPLY: B deletes their own reply", async () => {
  const { error } = await cB.from("reaction_replies").delete().eq("id", replyId);
  if (error) throw error;
  const { data } = await cA.from("reaction_replies").select("id").eq("id", replyId);
  assert((data || []).length === 0, "author's own reply was not deleted");
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

await step("picker — creator finalizes a selection (decideSelection)", async () => {
  const { data: sel, error } = await cA.from("selections")
    .insert({ club_id: club.id, method: "vote", created_by: A.id, status: "open" }).select().single();
  if (error) throw error;
  const { data: decided, error: decErr } = await cA.from("selections")
    .update({ result_user: B.id, status: "decided", decided_at: new Date().toISOString() })
    .eq("id", sel.id).select().single();
  if (decErr) throw decErr;
  assert(decided.status === "decided" && decided.result_user === B.id, "creator could not finalize the selection");
});

await step("SELECTION GATE: B (not creator) cannot finalize A's selection (RLS)", async () => {
  // selections_update_owner_or_creator: a non-creator's UPDATE matches 0 rows silently.
  const { data: sel, error } = await cA.from("selections").insert(
    { club_id: club.id, method: "vote", created_by: A.id, status: "open" }).select().single();
  if (error) throw error;
  await cB.from("selections").update({ status: "decided", result_user: B.id }).eq("id", sel.id);
  const { data } = await cA.from("selections").select("status, result_user").eq("id", sel.id).single();
  assert(data.status === "open" && !data.result_user,
    "SELECTION LEAK: a non-creator member crowned the winner / closed the selection");
});

await step("BOOK GATE: B (member, not creator) cannot finish the book for the club (RLS)", async () => {
  // books_update_owner: a non-owner's UPDATE matches 0 rows silently (no error).
  await cB.from("books").update({ status: "finished", finished_at: new Date().toISOString() }).eq("id", book.id);
  const { data } = await cA.from("books").select("status").eq("id", book.id).single();
  assert(data.status !== "finished", "BOOK GATE LEAK: a non-creator member finished the book for the club");
});

await step("mark book finished → appears in history (creator)", async () => {
  await cA.from("books").update({ status: "finished", finished_at: new Date().toISOString() }).eq("id", book.id);
  const { data } = await cA.from("books").select("id").eq("club_id", club.id).eq("status", "finished");
  assert((data || []).some((b) => b.id === book.id), "finished book not in history");
});

await step("profile update", async () => {
  const { error } = await cA.from("profiles").update({ display_name: `Tester A ${tag}` }).eq("id", A.id);
  if (error) throw error;
});

// --- avatar / club-icon uploads (the cropper bakes a square JPEG, then this path runs) ---
await step("AVATAR UPLOAD: A uploads a cropped icon to own folder and sets avatar_url", async () => {
  // Mirror profile.js: upload the baked jpeg under `${user.id}/...`, then save the URL.
  avatarPath = `${A.id}/${tag}.jpg`;
  const { error: upErr } = await cA.storage.from("avatars")
    .upload(avatarPath, blobJ(), { upsert: true, contentType: "image/jpeg" });
  if (upErr) throw upErr;
  const { data: pub } = cA.storage.from("avatars").getPublicUrl(avatarPath);
  const { data, error } = await cA.from("profiles")
    .update({ avatar_url: pub.publicUrl }).eq("id", A.id).select().single();
  if (error) throw error;
  assert(data.avatar_url === pub.publicUrl, "avatar_url was not saved on the profile");
});

await step("AVATAR GATE: A cannot upload into B's avatar folder (storage RLS)", async () => {
  // avatars_insert_own scopes writes to the uploader's own uid folder.
  const { data, error } = await cA.storage.from("avatars")
    .upload(`${B.id}/${tag}.jpg`, blobJ(), { upsert: false, contentType: "image/jpeg" });
  assert(error && !data?.path, "AVATAR LEAK: a user wrote into someone else's avatar folder");
});

await step("CLUB ICON: A (creator) uploads a cropped cover and sets photo_url", async () => {
  // Mirror club.js: upload under `${club.id}/...`, then save photo_url (creator only).
  coverPath = `${club.id}/${tag}.jpg`;
  const { error: upErr } = await cA.storage.from("club-images")
    .upload(coverPath, blobJ(), { upsert: true, contentType: "image/jpeg" });
  if (upErr) throw upErr;
  const { data: pub } = cA.storage.from("club-images").getPublicUrl(coverPath);
  const { data, error } = await cA.from("clubs")
    .update({ photo_url: pub.publicUrl }).eq("id", club.id).select().single();
  if (error) throw error;
  assert(data.photo_url === pub.publicUrl, "photo_url was not saved on the club");
});

await step("CLUB ICON GATE: B (member, not creator) cannot upload the club's cover (storage RLS)", async () => {
  // clubimg_insert_owner: only the club owner may write under that club's folder.
  const { data, error } = await cB.storage.from("club-images")
    .upload(`${club.id}/evil-${tag}.jpg`, blobJ(), { upsert: false, contentType: "image/jpeg" });
  assert(error && !data?.path, "CLUB ICON LEAK: a non-creator member uploaded the club's cover");
});

await step("DELETE GATE: B (member, not creator) cannot delete the club (RLS)", async () => {
  // RLS (clubs_delete_owner) silently affects 0 rows for a non-owner — no error.
  await cB.from("clubs").delete().eq("id", club.id);
  const { data } = await cA.from("clubs").select("id").eq("id", club.id);
  assert((data || []).length === 1, "DELETE LEAK: a non-creator member deleted the club");
});

// ---- book deletion (owner / picker), while B is still a member -------------
let book2;
await step("A adds a throwaway book (to exercise deletion)", async () => {
  const { data, error } = await cA.from("books").insert({
    club_id: club.id, title: `Throwaway ${tag}`, author: "x", page_count: 10, picked_by: A.id, status: "current",
  }).select().single();
  if (error) throw error;
  book2 = data;
});

await step("BOOK DELETE GATE: B (member, not owner/picker) cannot delete a book (RLS)", async () => {
  // books_delete_owner_or_picker: B is a member but neither owner nor picker → 0 rows.
  await cB.from("books").delete().eq("id", book2.id);
  const { data } = await cA.from("books").select("id").eq("id", book2.id);
  assert((data || []).length === 1, "BOOK DELETE LEAK: a non-owner/non-picker deleted a book");
});

await step("A (creator/picker) deletes the throwaway book (deleteBook)", async () => {
  const { error } = await cA.from("books").delete().eq("id", book2.id);
  if (error) throw error;
  const { data } = await cA.from("books").select("id").eq("id", book2.id);
  assert((data || []).length === 0, "book was not deleted by its owner/picker");
});

await step("B can leave the club", async () => {
  const { error } = await cB.from("club_members").delete().eq("club_id", club.id).eq("user_id", B.id);
  if (error) throw error;
});

// ---- global announcements (admin broadcast) --------------------------------
await step("ANNOUNCEMENT GATE: a non-admin cannot broadcast (RLS)", async () => {
  // announcements_insert_admin: with check is_admin() — A is not an admin.
  const { data, error } = await cA.from("announcements")
    .insert({ body: `should be blocked ${tag}`, created_by: A.id }).select().single();
  assert(error && !data, "ANNOUNCEMENT LEAK: a non-admin user broadcast to everyone");
});

if (SERVICE_ROLE) {
  const admin = createClient(URL, SERVICE_ROLE, { auth: { persistSession: false } });
  let annId;
  await step("ADMIN: an admin can broadcast; everyone sees it; a user can dismiss it", async () => {
    // Temporarily make A an admin (service role bypasses RLS), then drive the real
    // admin flow through A's normal publishable-key client.
    await admin.from("profiles").update({ is_admin: true }).eq("id", A.id);
    try {
      const { data: ann, error: insErr } = await cA.from("announcements")
        .insert({ body: `You can now respond to reactions! ${tag}`, created_by: A.id }).select().single();
      if (insErr) throw new Error("admin INSERT failed: " + insErr.message);
      annId = ann.id;

      // Everyone signed in sees it (announcements_select_all).
      const { data: seen } = await cB.from("announcements").select("id").eq("id", annId);
      assert((seen || []).length === 1, "a member could not see a global announcement");

      // B dismisses it server-side; the dismissal is recorded for B only.
      const { error: rdErr } = await cB.from("announcement_reads")
        .upsert({ announcement_id: annId, user_id: B.id }, { onConflict: "announcement_id,user_id" });
      if (rdErr) throw new Error("dismiss failed: " + rdErr.message);
      const { data: reads } = await cB.from("announcement_reads").select("user_id").eq("announcement_id", annId);
      assert((reads || []).some((r) => r.user_id === B.id), "dismissal was not recorded for the user");
    } finally {
      // Always undo the temporary admin grant and remove the test announcement.
      await admin.from("profiles").update({ is_admin: false }).eq("id", A.id);
      if (annId) await admin.from("announcements").delete().eq("id", annId);
    }
  });
} else {
  results.push([true, "ADMIN broadcast path (skipped — no SERVICE_ROLE)"]);
  console.log("  ⚠ ADMIN broadcast path skipped (set SUPABASE_SERVICE_ROLE to exercise it)");
}

// ---- cleanup ----------------------------------------------------------------
await step("cleanup: remove uploaded storage objects", async () => {
  // Storage objects aren't cascade-deleted with the club, so clean them up here —
  // the club cover MUST be removed before the club (clubimg_delete_owner needs the
  // club to still exist for is_club_owner()).
  if (avatarPath) await cA.storage.from("avatars").remove([avatarPath]);
  if (coverPath) await cA.storage.from("club-images").remove([coverPath]);
});

await step("cleanup: A (creator) deletes the club (cascades)", async () => {
  const { error } = await cA.from("clubs").delete().eq("id", club.id);
  if (error) throw error;
  const { data } = await cA.from("clubs").select("id").eq("id", club.id);
  assert((data || []).length === 0, "creator delete did not remove the club");
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
