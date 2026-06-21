// All Supabase data access lives here. Views call these; nobody else touches
// the DB directly. RLS enforces every rule server-side (esp. spoiler-gating).
import { supabase } from "./supabaseClient.js";

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------- PROFILES ---
export async function getProfile(userId) {
  return unwrap(
    await supabase.from("profiles").select("*").eq("id", userId).single()
  );
}

export async function getProfiles(ids) {
  if (!ids.length) return [];
  return unwrap(
    await supabase.from("profiles").select("*").in("id", ids)
  );
}

export async function updateProfile(userId, changes) {
  return unwrap(
    await supabase.from("profiles").update(changes).eq("id", userId).select().single()
  );
}

// ------------------------------------------------------------------- CLUBS ---
export async function myClubs() {
  // Clubs I'm a member of, with member counts.
  // Must filter to MY membership rows: the RLS SELECT policy returns the full
  // roster of every club I belong to, so without this filter a club would come
  // back once per member and appear duplicated in "my clubs".
  const user = (await supabase.auth.getUser()).data.user;
  const memberships = unwrap(
    await supabase.from("club_members").select("club_id, role")
      .eq("user_id", user.id).order("joined_at")
  );
  const ids = memberships.map((m) => m.club_id);
  if (!ids.length) return [];
  const clubs = unwrap(
    await supabase.from("clubs").select("*").in("id", ids)
  );
  const counts = unwrap(
    await supabase.from("club_members").select("club_id").in("club_id", ids)
  );
  const byId = Object.fromEntries(clubs.map((c) => [c.id, c]));
  const roleById = Object.fromEntries(memberships.map((m) => [m.club_id, m.role]));
  for (const c of clubs) {
    c.member_count = counts.filter((x) => x.club_id === c.id).length;
    c.my_role = roleById[c.id];
  }
  return memberships.map((m) => byId[m.club_id]).filter(Boolean);
}

export async function getClub(clubId) {
  return unwrap(await supabase.from("clubs").select("*").eq("id", clubId).single());
}

export async function findClubByCode(code) {
  // Uses a SECURITY DEFINER RPC so non-members can find exactly one club by its
  // code without being able to read/enumerate other clubs.
  const rows = unwrap(await supabase.rpc("find_club_by_code", { _code: code }));
  return rows?.[0] || null;
}

export async function createClub({ name, description, accent, deadlines_enabled, default_deadline_days }) {
  const user = (await supabase.auth.getUser()).data.user;
  return unwrap(
    await supabase.from("clubs").insert({
      name, description, accent,
      deadlines_enabled: !!deadlines_enabled,
      default_deadline_days: default_deadline_days || null,
      created_by: user.id,
    }).select().single()
  );
}

export async function updateClub(clubId, changes) {
  return unwrap(
    await supabase.from("clubs").update(changes).eq("id", clubId).select().single()
  );
}

export async function deleteClub(clubId) {
  // RLS (clubs_delete_owner) only lets a creator/owner do this; the FK cascades
  // wipe the club's members, books, reactions, reviews, progress and selections.
  return unwrap(await supabase.from("clubs").delete().eq("id", clubId));
}

// The current user's membership row for one club (or null). Lets a view know my
// role (creator/owner/member) without pulling the whole roster.
export async function myMembership(clubId) {
  const user = (await supabase.auth.getUser()).data.user;
  const rows = unwrap(
    await supabase.from("club_members").select("*")
      .eq("club_id", clubId).eq("user_id", user.id)
  );
  return rows[0] || null;
}

export async function joinClub(clubId) {
  const user = (await supabase.auth.getUser()).data.user;
  return unwrap(
    await supabase.from("club_members")
      .insert({ club_id: clubId, user_id: user.id, role: "member" })
      .select().single()
  );
}

export async function leaveClub(clubId) {
  const user = (await supabase.auth.getUser()).data.user;
  return unwrap(
    await supabase.from("club_members").delete()
      .eq("club_id", clubId).eq("user_id", user.id)
  );
}

export async function clubMembers(clubId) {
  const members = unwrap(
    await supabase.from("club_members").select("*").eq("club_id", clubId)
  );
  const profiles = await getProfiles(members.map((m) => m.user_id));
  const pById = Object.fromEntries(profiles.map((p) => [p.id, p]));
  return members.map((m) => ({ ...m, profile: pById[m.user_id] }));
}

// ------------------------------------------------------------------- BOOKS ---
export async function clubBooks(clubId) {
  return unwrap(
    await supabase.from("books").select("*").eq("club_id", clubId)
      .order("created_at", { ascending: false })
  );
}

export async function currentBook(clubId) {
  const rows = unwrap(
    await supabase.from("books").select("*").eq("club_id", clubId)
      .eq("status", "current").order("created_at", { ascending: false }).limit(1)
  );
  return rows[0] || null;
}

export async function getBook(bookId) {
  return unwrap(await supabase.from("books").select("*").eq("id", bookId).single());
}

export async function addBook(clubId, book) {
  const user = (await supabase.auth.getUser()).data.user;
  return unwrap(
    await supabase.from("books").insert({
      club_id: clubId,
      title: book.title,
      author: book.author,
      cover_url: book.cover_url,
      open_library_id: book.open_library_id,
      page_count: book.page_count,
      picked_by: book.picked_by || user.id,
      deadline: book.deadline || null,
      status: "current",
    }).select().single()
  );
}

export async function updateBook(bookId, changes) {
  return unwrap(
    await supabase.from("books").update(changes).eq("id", bookId).select().single()
  );
}

export async function finishBook(bookId) {
  return updateBook(bookId, { status: "finished", finished_at: new Date().toISOString() });
}

export async function deleteBook(bookId) {
  return unwrap(await supabase.from("books").delete().eq("id", bookId));
}

// -------------------------------------------------------------- PROGRESS ---
export async function bookProgress(bookId) {
  const rows = unwrap(
    await supabase.from("reading_progress").select("*").eq("book_id", bookId)
  );
  const profiles = await getProfiles(rows.map((r) => r.user_id));
  const pById = Object.fromEntries(profiles.map((p) => [p.id, p]));
  return rows.map((r) => ({ ...r, profile: pById[r.user_id] }));
}

export async function myProgress(bookId) {
  const user = (await supabase.auth.getUser()).data.user;
  const rows = unwrap(
    await supabase.from("reading_progress").select("*")
      .eq("book_id", bookId).eq("user_id", user.id)
  );
  return rows[0] || null;
}

export async function setProgress(bookId, currentPage, status) {
  const user = (await supabase.auth.getUser()).data.user;
  const now = new Date().toISOString();
  const row = {
    book_id: bookId,
    user_id: user.id,
    current_page: currentPage,
    status,
    updated_at: now,
  };
  if (status === "reading") row.started_at = now;
  if (status === "finished") row.finished_at = now;
  return unwrap(
    await supabase.from("reading_progress")
      .upsert(row, { onConflict: "book_id,user_id" })
      .select().single()
  );
}

// My personal reading history: every book I've marked finished, across all my
// clubs, newest first — with my own rating if I reviewed it. Mirrors a club's
// "books read" shelf but scoped to me. RLS still applies (I only see books in
// clubs I belong to, and only my own progress/reviews).
export async function myReadingHistory() {
  const user = (await supabase.auth.getUser()).data.user;
  const progress = unwrap(
    await supabase.from("reading_progress").select("*")
      .eq("user_id", user.id).eq("status", "finished")
      .order("finished_at", { ascending: false })
  );
  const bookIds = progress.map((p) => p.book_id);
  if (!bookIds.length) return [];
  const [books, reviews] = await Promise.all([
    supabase.from("books").select("*").in("id", bookIds).then(unwrap),
    supabase.from("reviews").select("*").in("book_id", bookIds).eq("user_id", user.id).then(unwrap),
  ]);
  const bById = Object.fromEntries(books.map((b) => [b.id, b]));
  const rById = Object.fromEntries(reviews.map((r) => [r.book_id, r]));
  return progress.map((p) => {
    const b = bById[p.book_id];
    if (!b) return null; // book deleted or no longer visible
    return { ...b, my_finished_at: p.finished_at || p.updated_at, my_rating: rById[p.book_id]?.rating || null };
  }).filter(Boolean);
}

// ------------------------------------------------------------- REACTIONS ---
// SELECT here only returns rows RLS lets us see (spoiler gate). So whatever
// comes back is already safe to display.
export async function bookReactions(bookId) {
  const rows = unwrap(
    await supabase.from("reactions").select("*").eq("book_id", bookId)
      .order("page", { ascending: true }).order("created_at", { ascending: true })
  );
  const profiles = await getProfiles(rows.map((r) => r.user_id));
  const pById = Object.fromEntries(profiles.map((p) => [p.id, p]));
  return rows.map((r) => ({ ...r, profile: pById[r.user_id] }));
}

export async function addReaction(bookId, page, body) {
  const user = (await supabase.auth.getUser()).data.user;
  return unwrap(
    await supabase.from("reactions")
      .insert({ book_id: bookId, user_id: user.id, page, body })
      .select().single()
  );
}

export async function deleteReaction(id) {
  return unwrap(await supabase.from("reactions").delete().eq("id", id));
}

// --------------------------------------------------------------- REVIEWS ---
export async function bookReviews(bookId) {
  const rows = unwrap(
    await supabase.from("reviews").select("*").eq("book_id", bookId)
      .order("created_at", { ascending: false })
  );
  const profiles = await getProfiles(rows.map((r) => r.user_id));
  const pById = Object.fromEntries(profiles.map((p) => [p.id, p]));
  return rows.map((r) => ({ ...r, profile: pById[r.user_id] }));
}

export async function myReview(bookId) {
  const user = (await supabase.auth.getUser()).data.user;
  const rows = unwrap(
    await supabase.from("reviews").select("*").eq("book_id", bookId).eq("user_id", user.id)
  );
  return rows[0] || null;
}

export async function saveReview(bookId, rating, body) {
  const user = (await supabase.auth.getUser()).data.user;
  return unwrap(
    await supabase.from("reviews")
      .upsert({ book_id: bookId, user_id: user.id, rating, body }, { onConflict: "book_id,user_id" })
      .select().single()
  );
}

// ------------------------------------------------------------ SELECTIONS ---
export async function createSelection(clubId, method) {
  const user = (await supabase.auth.getUser()).data.user;
  const status = method === "vote" ? "open" : "decided";
  return unwrap(
    await supabase.from("selections")
      .insert({ club_id: clubId, method, created_by: user.id, status })
      .select().single()
  );
}

export async function decideSelection(selectionId, resultUserId) {
  return unwrap(
    await supabase.from("selections").update({
      result_user: resultUserId,
      status: "decided",
      decided_at: new Date().toISOString(),
    }).eq("id", selectionId).select().single()
  );
}

export async function openVote(clubId) {
  return createSelection(clubId, "vote");
}

export async function castVote(selectionId, candidateId) {
  const user = (await supabase.auth.getUser()).data.user;
  return unwrap(
    await supabase.from("selection_votes")
      .upsert({ selection_id: selectionId, voter_id: user.id, candidate_id: candidateId },
              { onConflict: "selection_id,voter_id" })
      .select().single()
  );
}

export async function selectionVotes(selectionId) {
  return unwrap(
    await supabase.from("selection_votes").select("*").eq("selection_id", selectionId)
  );
}

export async function openSelections(clubId) {
  return unwrap(
    await supabase.from("selections").select("*")
      .eq("club_id", clubId).eq("status", "open")
      .order("created_at", { ascending: false })
  );
}

export async function clubSelections(clubId) {
  return unwrap(
    await supabase.from("selections").select("*")
      .eq("club_id", clubId).order("created_at", { ascending: false })
  );
}

// ------------------------------------------------------------- REALTIME ---
export function subscribe(channelName, table, filter, onChange) {
  const ch = supabase
    .channel(channelName)
    .on("postgres_changes",
        { event: "*", schema: "public", table, filter },
        onChange)
    .subscribe();
  return () => supabase.removeChannel(ch);
}
