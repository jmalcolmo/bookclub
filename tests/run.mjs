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
import { spinRotation, winnerIndex } from "../src/wheel.js";

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
let postId;               // a club post id (non-spoiler-gated, member-scoped)
let avatarPath, coverPath, postImagePath;
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

// ---- CLUB POSTS: member-scoped, NON-spoiler-gated lightweight feed -----------
await step("A creates a club post (text + photo)", async () => {
  // Upload the photo under the club folder (member-scoped storage RLS), then
  // insert the post row — mirrors api.js uploadPostImage() + addPost().
  postImagePath = `${club.id}/${tag}.jpg`;
  const { error: upErr } = await cA.storage.from("post-images")
    .upload(postImagePath, blobJ(), { upsert: true, contentType: "image/jpeg" });
  if (upErr) throw upErr;
  const { data: pub } = cA.storage.from("post-images").getPublicUrl(postImagePath);
  const { data, error } = await cA.from("club_posts")
    .insert({ club_id: club.id, user_id: A.id, body: `hello club ${tag}`, image_url: pub.publicUrl })
    .select().single();
  if (error) throw error;
  postId = data.id;
  assert(data.image_url === pub.publicUrl, "post image_url was not saved");
});

await step("B (co-member) can read the club's posts (no spoiler gate)", async () => {
  // Posts carry no page number and no gate beyond membership: B sees A's post
  // regardless of reading progress.
  const { data, error } = await cB.from("club_posts").select("*").eq("club_id", club.id);
  if (error) throw error;
  assert((data || []).some((p) => p.id === postId), "co-member could not read a club post");
});

await step("A edits their own post text (updatePost)", async () => {
  const { data, error } = await cA.from("club_posts")
    .update({ body: "edited post" }).eq("id", postId).select().single();
  if (error) throw error;
  assert(data.body === "edited post", "own post edit did not persist");
});

await step("POST UPDATE GATE: B cannot edit A's post (RLS)", async () => {
  await cB.from("club_posts").update({ body: "hijacked post" }).eq("id", postId);
  const { data } = await cA.from("club_posts").select("body").eq("id", postId).single();
  assert(data.body !== "hijacked post", "POST UPDATE LEAK: a non-author edited someone else's post");
});

await step("POST DELETE GATE: B cannot delete A's post (RLS)", async () => {
  await cB.from("club_posts").delete().eq("id", postId);
  const { data } = await cA.from("club_posts").select("id").eq("id", postId);
  assert((data || []).length === 1, "POST DELETE LEAK: a non-author deleted someone else's post");
});

await step("POST IMAGE GATE: a non-member cannot upload into a club's post folder (storage RLS)", async () => {
  // Use a fresh signed-out client as a stand-in for a non-member: the write must
  // be denied because post-images writes require club membership on the folder's
  // first path segment. (cB is a member, so it would succeed — the point of the
  // gate is that NON-members can't. We prove it with the anon client which has no
  // membership at all.)
  const anon = client();
  const { error } = await anon.storage.from("post-images")
    .upload(`${club.id}/evil-${tag}.jpg`, blobJ(), { upsert: false, contentType: "image/jpeg" });
  assert(error, "POST IMAGE LEAK: a non-member uploaded into a club's post folder");
});

await step("A deletes their own post (deletePost)", async () => {
  const { error } = await cA.from("club_posts").delete().eq("id", postId);
  if (error) throw error;
  const { data } = await cA.from("club_posts").select("id").eq("id", postId);
  assert((data || []).length === 0, "author could not delete their own post");
  postId = null;
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

await step("REACTION→PROGRESS SYNC: A's logged page can't stay below a reaction A posted", async () => {
  // New client behavior (book.js): posting a reaction past your logged page opens the
  // "My progress" popup; saving OR dismissing it bumps current_page to at least the
  // reaction's page. Mirror that sync here and assert the end-goal invariant holds.
  const { data: reacts } = await cA.from("reactions").select("page").eq("book_id", book.id).eq("user_id", A.id);
  const maxReaction = Math.max(...(reacts || []).map((r) => r.page));
  const { data: before } = await cA.from("reading_progress").select("current_page")
    .eq("book_id", book.id).eq("user_id", A.id).single();
  // A is logged at p.50 but posted a p.200 reaction — the popup (or its dismissal) syncs.
  if (maxReaction > before.current_page) {
    const { error } = await cA.from("reading_progress").upsert(
      { book_id: book.id, user_id: A.id, current_page: maxReaction, status: "reading" },
      { onConflict: "book_id,user_id" });
    if (error) throw error;
  }
  const { data: after } = await cA.from("reading_progress").select("current_page")
    .eq("book_id", book.id).eq("user_id", A.id).single();
  assert(after.current_page >= maxReaction,
    `PROGRESS BEHIND REACTION: logged p.${after.current_page} but posted a reaction at p.${maxReaction}`);
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

await step("UPDATE REACTION: A edits its own reaction body + page (updateReaction)", async () => {
  const { data, error } = await cA.from("reactions")
    .update({ page: 35, body: "edited early thought" }).eq("id", r30).select().single();
  if (error) throw error;
  assert(data.body === "edited early thought" && data.page === 35, "own reaction edit did not persist");
});

await step("REACTION UPDATE GATE: B cannot edit A's reaction (RLS)", async () => {
  // reactions_update_own: only the author may update; a non-author affects 0 rows.
  await cB.from("reactions").update({ body: "hijacked reaction" }).eq("id", r30);
  const { data } = await cA.from("reactions").select("body").eq("id", r30).single();
  assert(data.body === "edited early thought", "REACTION UPDATE LEAK: a non-author edited someone else's reaction");
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

let aReplyId;
await step("UPDATE REPLY: A edits its own reply (updateReply)", async () => {
  const { data: mk, error: mkErr } = await cA.from("reaction_replies")
    .insert({ reaction_id: r30, user_id: A.id, body: "my own reply" }).select().single();
  if (mkErr) throw mkErr;
  aReplyId = mk.id;
  const { data, error } = await cA.from("reaction_replies")
    .update({ body: "my edited reply" }).eq("id", aReplyId).select().single();
  if (error) throw error;
  assert(data.body === "my edited reply", "own reply edit did not persist");
});

await step("REPLY UPDATE GATE: B cannot edit A's reply (RLS)", async () => {
  // replies_update_own: only the author may update; a non-author affects 0 rows.
  await cB.from("reaction_replies").update({ body: "hijacked reply" }).eq("id", aReplyId);
  const { data } = await cA.from("reaction_replies").select("body").eq("id", aReplyId).single();
  assert(data.body === "my edited reply", "REPLY UPDATE LEAK: a non-author edited someone else's reply");
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

await step("ACTIVITY: A sees who liked/replied on their reaction (profile Activity feed)", async () => {
  // Mirrors api.js myActivity(): engagements + replies targeting MY content,
  // excluding my own, with the actor's profile resolvable for display. Runs
  // while B's like + emoji + reply on A's p.30 reaction all exist.
  const { data: myRx } = await cA.from("reactions").select("id").eq("user_id", A.id);
  const ids = (myRx || []).map((r) => r.id);
  const { data: engs } = await cA.from("engagements").select("*")
    .in("target_id", ids).neq("user_id", A.id);
  assert((engs || []).some((e) => e.target_id === r30 && e.kind === "like" && e.user_id === B.id),
    "activity missed B's like on my reaction");
  assert((engs || []).some((e) => e.target_id === r30 && e.kind === "❤️" && e.user_id === B.id),
    "activity missed B's emoji on my reaction");
  const { data: reps } = await cA.from("reaction_replies").select("*")
    .in("reaction_id", ids).neq("user_id", A.id);
  assert((reps || []).some((r) => r.id === replyId && r.user_id === B.id),
    "activity missed B's reply on my reaction");
  const { data: actor } = await cA.from("profiles").select("display_name").eq("id", B.id);
  assert((actor || []).length === 1, "activity actor profile did not resolve");
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

await step("COMPLETE-VIA-MAX-PAGE: entering page >= page_count + confirming finishes at page_count", async () => {
  // New client behavior (progress.js / book.js promptComplete + iOS confirmComplete):
  // when a reader enters a page at/past book.page_count, we prompt "Did you
  // complete this book?" and on Yes call setProgress(finished, page=page_count).
  // Model that end state: A types page 305 (past 300), confirms, lands at 300/finished.
  const { data: b } = await cA.from("books").select("page_count").eq("id", book.id).single();
  const enteredPage = b.page_count + 5;              // reader typed past the last page
  assert(enteredPage >= b.page_count, "test setup: entered page should be >= page_count");
  const { error } = await cA.from("reading_progress").upsert(
    { book_id: book.id, user_id: A.id, current_page: b.page_count, status: "finished" },
    { onConflict: "book_id,user_id" });
  if (error) throw error;
  const { data: after } = await cA.from("reading_progress").select("current_page,status")
    .eq("book_id", book.id).eq("user_id", A.id).single();
  assert(after.status === "finished", "complete-via-max-page did not set status finished");
  assert(after.current_page === b.page_count,
    `complete-via-max-page should clamp to page_count (${b.page_count}), got ${after.current_page}`);
});

await step("A writes a review (unlocked by finishing)", async () => {
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

await step("UN-FINISH: B marks 'still reading' → status reading, current_page kept", async () => {
  // New client behavior (progress.js/book.js unfinish + iOS unfinish): flip
  // status back to reading without touching current_page. Reversible; the
  // review gate re-locks. Round-trip so downstream (B finished) stays valid.
  const { data: before } = await cB.from("reading_progress").select("current_page")
    .eq("book_id", book.id).eq("user_id", B.id).single();
  const { error } = await cB.from("reading_progress").upsert(
    { book_id: book.id, user_id: B.id, current_page: before.current_page, status: "reading" },
    { onConflict: "book_id,user_id" });
  if (error) throw error;
  const { data: after } = await cB.from("reading_progress").select("current_page,status")
    .eq("book_id", book.id).eq("user_id", B.id).single();
  assert(after.status === "reading", "un-finish did not revert status to reading");
  assert(after.current_page === before.current_page,
    `un-finish must keep current_page (${before.current_page}), got ${after.current_page}`);
  // Reviews re-lock while reading.
  const { data: revs } = await cB.from("reviews").select("id").eq("book_id", book.id);
  assert((revs || []).length === 0, "REVIEW LEAK: reviews still visible after un-finishing");
  // Re-finish B so later steps that assume B finished still hold.
  await cB.from("reading_progress").upsert(
    { book_id: book.id, user_id: B.id, current_page: 300, status: "finished" },
    { onConflict: "book_id,user_id" });
});

await step("REVIEW DELETE GATE: B cannot delete A's review (RLS)", async () => {
  // reviews_delete_own: only the author may delete; a non-author affects 0 rows.
  const { data: rev } = await cA.from("reviews").select("id").eq("book_id", book.id).eq("user_id", A.id).single();
  await cB.from("reviews").delete().eq("id", rev.id);
  const { data } = await cA.from("reviews").select("id").eq("id", rev.id);
  assert((data || []).length === 1, "REVIEW DELETE LEAK: a non-author deleted someone else's review");
});

await step("DELETE REVIEW: A deletes its own review, then restores it (deleteReview)", async () => {
  const { data: rev } = await cA.from("reviews").select("id").eq("book_id", book.id).eq("user_id", A.id).single();
  const { error: delErr } = await cA.from("reviews").delete().eq("id", rev.id);
  if (delErr) throw delErr;
  const { data: gone } = await cA.from("reviews").select("id").eq("id", rev.id);
  assert((gone || []).length === 0, "own review delete did not remove the row");
  // restore so downstream history / gate steps still have a review to read
  const { error: reErr } = await cA.from("reviews").upsert(
    { book_id: book.id, user_id: A.id, rating: 4, body: "solid read" }, { onConflict: "book_id,user_id" });
  if (reErr) throw reErr;
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

await step("PROGRESS DELETE GATE: A cannot delete B's progress row (RLS)", async () => {
  // progress_delete_own: only the reader may remove their own row; others affect 0 rows.
  await cA.from("reading_progress").delete().eq("book_id", book.id).eq("user_id", B.id);
  const { data } = await cB.from("reading_progress").select("id").eq("book_id", book.id).eq("user_id", B.id);
  assert((data || []).length === 1, "PROGRESS DELETE LEAK: a non-owner wiped another reader's progress");
});

await step("RESET PROGRESS: B deletes own progress → the spoiler gate re-locks p.200 (deleteProgress)", async () => {
  const { error } = await cB.from("reading_progress").delete().eq("book_id", book.id).eq("user_id", B.id);
  if (error) throw error;
  const { data: gone } = await cB.from("reading_progress").select("id").eq("book_id", book.id).eq("user_id", B.id);
  assert((gone || []).length === 0, "own progress delete did not remove the row");
  // Gate reads live from reading_progress: with no row, B is back to page 0 and
  // must no longer receive the gated p.200 reaction.
  const { data: seen } = await cB.from("reactions").select("page").eq("book_id", book.id);
  assert(!(seen || []).some((r) => r.page === 200), "SPOILER LEAK: p.200 still visible after B reset progress");
});

await step("picker — wheel geometry: marker always matches the winner", async () => {
  // Pure-math invariant, exercised through the SAME src/wheel.js the view imports:
  // whatever slice CENTER we spin under the top pointer is exactly the slice
  // winnerIndex() reads back. This is the guarantee the picker redesign makes, so
  // it must be covered against the shared code, not a hardcoded row.
  for (let n = 2; n <= 12; n++) {
    for (let target = 0; target < n; target++) {
      for (const turns of [5, 6, 7]) {
        const rot = spinRotation(target, n, turns);
        assert(winnerIndex(rot, n) === target,
          `n=${n} target=${target} turns=${turns} → winnerIndex=${winnerIndex(rot, n)}`);
      }
    }
  }
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

// --- push: device-token registration (device_tokens is owner-only; real APNs delivery
//     is device-only and out of scope here — this covers the RLS registerDeviceToken uses) ---
await step("PUSH: A registers a device token (registerDeviceToken upsert as self)", async () => {
  // Mirror api.js registerDeviceToken: upsert on the unique token, owned by the caller.
  const { data, error } = await cA.from("device_tokens")
    .upsert(
      { user_id: A.id, token: `tok-${tag}`, platform: "ios", environment: "sandbox", updated_at: new Date().toISOString() },
      { onConflict: "token" }
    )
    .select().single();
  if (error) throw error;
  assert(data.user_id === A.id && data.token === `tok-${tag}`, "device token was not stored for the caller");
});

await step("PUSH GATE: B cannot read A's device token (device_tokens_select_own)", async () => {
  const { data } = await cB.from("device_tokens").select("*").eq("user_id", A.id);
  assert((data || []).length === 0, "DEVICE TOKEN LEAK: another user read A's device token");
});

await step("PUSH GATE: B cannot register a token as A (device_tokens_insert_own with-check)", async () => {
  // The insert with-check requires user_id = auth.uid(); forging A's id must be rejected.
  const { error } = await cB.from("device_tokens")
    .insert({ user_id: A.id, token: `forged-${tag}`, platform: "ios", environment: "sandbox" });
  assert(error, "FORGERY: B inserted a device token owned by A");
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

// ---- FOLLOWS + the SOLO follow feed (A and B now share NO club) -------------
// B owns a private club A never joins, with a book, a reaction and progress.
// A follows B and then sees B's SOLO reading via the ADDITIVE follow RLS path —
// without joining. This must never be a club-gate bypass: A isn't a member, and
// only B's OWN authored reading is surfaced. Mirrors src/api.js follows + feed.
let bClub, bBook, bReaction, bPost;
await step("FOLLOW SETUP: B owns a solo club A never joins", async () => {
  const { data: c, error: ce } = await cB.from("clubs")
    .insert({ name: `B Solo Club ${tag}`, accent: "yarn-mauve", created_by: B.id }).select().single();
  if (ce) throw ce;
  bClub = c;
  const { data: bk, error: be } = await cB.from("books")
    .insert({ club_id: bClub.id, title: `B Solo Book ${tag}`, page_count: 400, picked_by: B.id, status: "current" })
    .select().single();
  if (be) throw be;
  bBook = bk;
  const { error: pe } = await cB.from("reading_progress")
    .upsert({ book_id: bBook.id, user_id: B.id, current_page: 120, status: "reading" }, { onConflict: "book_id,user_id" });
  if (pe) throw pe;
  const { data: rx, error: re } = await cB.from("reactions")
    .insert({ book_id: bBook.id, user_id: B.id, page: 90, body: `solo thought ${tag}` }).select().single();
  if (re) throw re;
  bReaction = rx;
  const { data: po, error: poe } = await cB.from("club_posts")
    .insert({ club_id: bClub.id, user_id: B.id, body: `solo post ${tag}` }).select().single();
  if (poe) throw poe;
  bPost = po;
});

await step("FOLLOW GATE: before following, A can't see B's solo profile/reaction (RLS)", async () => {
  const { data: profs } = await cA.from("profiles").select("id").eq("id", B.id);
  assert((profs || []).length === 0, "FOLLOW LEAK: saw a non-co-member profile before following");
  const { data: rxs } = await cA.from("reactions").select("id").eq("book_id", bBook.id);
  assert((rxs || []).length === 0, "FOLLOW LEAK: saw a non-member's reaction before following");
});

await step("POST MEMBERSHIP GATE: a non-member cannot read a club's posts (RLS)", async () => {
  // Posts are strictly club-member-scoped and NOT part of the additive follow
  // path — A (not a member of B's solo club) sees nothing.
  const { data } = await cA.from("club_posts").select("id").eq("club_id", bClub.id);
  assert((data || []).length === 0, "POST LEAK: a non-member read a club's posts");
});

await step("POST INSERT GATE: a non-member cannot post to a club (RLS)", async () => {
  const { error } = await cA.from("club_posts")
    .insert({ club_id: bClub.id, user_id: A.id, body: `intruder ${tag}` });
  assert(error, "POST LEAK: a non-member inserted a post into a club they're not in");
});

await step("A follows B (RLS: only from self)", async () => {
  const { error } = await cA.from("follows").insert({ follower_id: A.id, followee_id: B.id });
  if (error) throw error;
  const { data } = await cA.from("follows").select("followee_id").eq("follower_id", A.id).eq("followee_id", B.id);
  assert((data || []).length === 1, "follow did not register");
});

await step("FOLLOW PATH: A now sees B's SOLO reaction + progress (additive RLS)", async () => {
  const { data: rxs } = await cA.from("reactions").select("id,page").eq("book_id", bBook.id);
  assert((rxs || []).some((r) => r.id === bReaction.id), "follow path did not expose the followee's solo reaction");
  const { data: prog } = await cA.from("reading_progress").select("current_page").eq("book_id", bBook.id).eq("user_id", B.id);
  assert((prog || []).length === 1, "follow path did not expose the followee's solo progress");
  const { data: prof } = await cA.from("profiles").select("id").eq("id", B.id);
  assert((prof || []).length === 1, "follow path did not expose the followee's profile");
  const { data: bk } = await cA.from("books").select("id").eq("id", bBook.id);
  assert((bk || []).length === 1, "follow path did not expose the followee's book row for the feed");
  // Posts are NOT part of the follow path — following B must never expose the
  // posts of a club A isn't a member of.
  const { data: posts } = await cA.from("club_posts").select("id").eq("club_id", bClub.id);
  assert((posts || []).length === 0, "POST LEAK: following exposed a non-member club's posts");
});

await step("FOLLOWING ROSTER: A resolves B's current book + page (followingReading)", async () => {
  // Mirrors api.js followingReading(): the newest visible progress row per
  // followee, decorated with its book — "Book Title  p.X / Y" on Following.
  const { data: prog } = await cA.from("reading_progress").select("*")
    .eq("user_id", B.id).order("updated_at", { ascending: false });
  assert((prog || []).length >= 1, "no visible progress for the followee");
  const latest = prog[0];
  assert(latest.current_page === 120, "followee's current page did not resolve");
  const { data: bks } = await cA.from("books").select("title,page_count").eq("id", latest.book_id);
  assert(bks?.[0]?.page_count === 400, "followee's book (for 'p.X / Y') did not resolve");
});

await step("FOLLOW GATE: A can't forge a follow edge on B's behalf (RLS)", async () => {
  const { data, error } = await cA.from("follows").insert({ follower_id: B.id, followee_id: A.id }).select().single();
  assert(error && !data, "FOLLOW LEAK: forged a follow edge on someone else's behalf");
});

await step("A unfollows B → the solo view re-locks live", async () => {
  const { error } = await cA.from("follows").delete().eq("follower_id", A.id).eq("followee_id", B.id);
  if (error) throw error;
  const { data: rxs } = await cA.from("reactions").select("id").eq("book_id", bBook.id);
  assert((rxs || []).length === 0, "FOLLOW LEAK: solo reaction still visible after unfollowing");
});

await step("cleanup: B removes the solo club (cascades)", async () => {
  const { error } = await cB.from("clubs").delete().eq("id", bClub.id);
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
  // Post photo lives in post-images under the club folder; remove it while the
  // club (and A's membership) still exists so postimg_delete_member applies.
  if (postImagePath) await cA.storage.from("post-images").remove([postImagePath]);
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
