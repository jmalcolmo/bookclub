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

// ----------------------------------------------------------------- FOLLOWS ---
// A follow graph OUTSIDE of clubs: I can follow another reader and then see the
// SOLO reading they do in clubs I'm not part of (their own progress + reactions).
// RLS enforces every rule — the follows_* policies here, plus the additive
// follow paths on profiles/books/reactions/reading_progress. The club spoiler
// gate is never widened: inside a shared club it stays the sole authority.

// Everyone I currently follow (the followee_id list). Cheap check for follow state.
export async function following() {
  const user = (await supabase.auth.getUser()).data.user;
  const rows = unwrap(
    await supabase.from("follows").select("followee_id")
      .eq("follower_id", user.id).order("created_at", { ascending: false })
  );
  return rows.map((r) => r.followee_id);
}

// The people I follow, decorated with their profile (for the feed's roster).
export async function followingProfiles() {
  const ids = await following();
  if (!ids.length) return [];
  const profiles = await getProfiles(ids);
  const pById = Object.fromEntries(profiles.map((p) => [p.id, p]));
  return ids.map((id) => pById[id]).filter(Boolean);
}

// Am I following one specific user?
export async function isFollowing(userId) {
  const user = (await supabase.auth.getUser()).data.user;
  const rows = unwrap(
    await supabase.from("follows").select("followee_id")
      .eq("follower_id", user.id).eq("followee_id", userId)
  );
  return rows.length > 0;
}

export async function follow(userId) {
  const user = (await supabase.auth.getUser()).data.user;
  return unwrap(
    await supabase.from("follows")
      .insert({ follower_id: user.id, followee_id: userId })
      .select().single()
  );
}

export async function unfollow(userId) {
  const user = (await supabase.auth.getUser()).data.user;
  return unwrap(
    await supabase.from("follows").delete()
      .eq("follower_id", user.id).eq("followee_id", userId)
  );
}

// The "people you follow" feed: for each reader I follow, their SOLO reading —
// recent reactions and progress on books in clubs I'm NOT a member of. RLS only
// ever returns the follow-visible rows, so whatever comes back is safe to show.
// Rows are decorated with the author's profile and the book, and sorted newest
// first. Returns { items, followees } where items are the feed entries.
export async function followFeed({ limit = 40 } = {}) {
  const followees = await followingProfiles();
  if (!followees.length) return { items: [], followees };
  const followeeIds = followees.map((p) => p.id);
  const pById = Object.fromEntries(followees.map((p) => [p.id, p]));

  const [reactions, progress] = await Promise.all([
    supabase.from("reactions").select("*").in("user_id", followeeIds)
      .order("created_at", { ascending: false }).limit(limit).then(unwrap),
    supabase.from("reading_progress").select("*").in("user_id", followeeIds)
      .order("updated_at", { ascending: false }).limit(limit).then(unwrap),
  ]);

  const bookIds = [...new Set([...reactions, ...progress].map((r) => r.book_id))];
  const books = bookIds.length
    ? unwrap(await supabase.from("books").select("*").in("id", bookIds))
    : [];
  const bById = Object.fromEntries(books.map((b) => [b.id, b]));

  const items = [
    ...reactions.map((r) => ({
      kind: "reaction", id: r.id, at: r.created_at,
      profile: pById[r.user_id], book: bById[r.book_id] || null,
      page: r.page, body: r.body,
    })),
    ...progress.map((p) => ({
      kind: "progress", id: p.id, at: p.updated_at,
      profile: pById[p.user_id], book: bById[p.book_id] || null,
      page: p.current_page, status: p.status,
    })),
  ]
    // Only surface rows we could resolve a book for (RLS may hide the book if the
    // follow path didn't apply — defensive, keeps the feed coherent).
    .filter((i) => i.book)
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, limit);

  return { items, followees };
}

// The "following" screen roster: each reader I follow with their latest visible
// reading — the book they're on and the page they've reached out of its page
// count. RLS decides which progress rows I can see (shared clubs + the additive
// follow path), so a followee with no visible reading comes back with
// progress/book null and the screen says so instead of leaking anything.
export async function followingReading() {
  const followees = await followingProfiles();
  if (!followees.length) return [];
  const ids = followees.map((p) => p.id);

  const progress = unwrap(
    await supabase.from("reading_progress").select("*").in("user_id", ids)
      .order("updated_at", { ascending: false })
  );
  // Newest visible row per reader = what they're on right now.
  const latest = {};
  for (const p of progress) latest[p.user_id] ||= p;

  const bookIds = [...new Set(Object.values(latest).map((p) => p.book_id))];
  const books = bookIds.length
    ? unwrap(await supabase.from("books").select("*").in("id", bookIds))
    : [];
  const bById = Object.fromEntries(books.map((b) => [b.id, b]));

  return followees.map((profile) => {
    const p = latest[profile.id];
    const book = p ? bById[p.book_id] || null : null;
    return { profile, progress: book ? p : null, book };
  });
}

// ---------------------------------------------------------------- ACTIVITY ---
// Who engaged with MY content: likes/emoji on my reactions, comments (replies),
// reviews and progress milestones, plus replies posted under my reactions.
// Everything here is already reader-visible to me under RLS — I can always see
// my own rows, and engagements/replies on them route through those same gates.
// Anyone able to engage my content necessarily shares a club with me, so their
// profile resolves too. Returns items newest first:
//   { id, kind: 'like'|'emoji'|'reply', emoji?, actor, what, snippet, body?,
//     book, at, go, highlight }
// `go` is the book route where it happened; `highlight` is the reaction id to
// flash/scroll to (null when the target has no anchor, e.g. reviews).
export async function myActivity({ limit = 30 } = {}) {
  const user = (await supabase.auth.getUser()).data.user;

  const [myReactions, myReplies, myReviews, myProgress] = await Promise.all([
    supabase.from("reactions").select("*").eq("user_id", user.id).then(unwrap),
    supabase.from("reaction_replies").select("*").eq("user_id", user.id).then(unwrap),
    supabase.from("reviews").select("*").eq("user_id", user.id).then(unwrap),
    supabase.from("reading_progress").select("*").eq("user_id", user.id).then(unwrap),
  ]);

  const reactionById = Object.fromEntries(myReactions.map((r) => [r.id, r]));
  const replyById = Object.fromEntries(myReplies.map((r) => [r.id, r]));
  const reviewById = Object.fromEntries(myReviews.map((r) => [r.id, r]));
  const progressById = Object.fromEntries(myProgress.map((r) => [r.id, r]));
  const targetIds = [
    ...Object.keys(reactionById), ...Object.keys(replyById),
    ...Object.keys(reviewById), ...Object.keys(progressById),
  ];

  const [engs, replies] = await Promise.all([
    targetIds.length
      ? supabase.from("engagements").select("*").in("target_id", targetIds)
          .neq("user_id", user.id).order("created_at", { ascending: false })
          .limit(limit).then(unwrap)
      : [],
    myReactions.length
      ? supabase.from("reaction_replies").select("*")
          .in("reaction_id", myReactions.map((r) => r.id))
          .neq("user_id", user.id).order("created_at", { ascending: false })
          .limit(limit).then(unwrap)
      : [],
  ]);

  // My replies hang off OTHER people's reactions — resolve those parents for
  // their book ids (visible to me: I could see them when I replied).
  const parentIds = [...new Set(
    myReplies.map((r) => r.reaction_id).filter((id) => !reactionById[id])
  )];
  const parents = parentIds.length
    ? unwrap(await supabase.from("reactions").select("*").in("id", parentIds))
    : [];
  const parentById = Object.fromEntries(parents.map((r) => [r.id, r]));

  const bookIdOf = (e) => {
    if (e.target_type === "reaction") return reactionById[e.target_id]?.book_id;
    if (e.target_type === "reply") {
      const rep = replyById[e.target_id];
      return (reactionById[rep?.reaction_id] || parentById[rep?.reaction_id])?.book_id;
    }
    if (e.target_type === "review") return reviewById[e.target_id]?.book_id;
    if (e.target_type === "progress") return progressById[e.target_id]?.book_id;
    return null;
  };

  const bookIds = [...new Set([
    ...engs.map(bookIdOf),
    ...replies.map((r) => reactionById[r.reaction_id]?.book_id),
  ].filter(Boolean))];
  const books = bookIds.length
    ? unwrap(await supabase.from("books").select("*").in("id", bookIds))
    : [];
  const bById = Object.fromEntries(books.map((b) => [b.id, b]));

  const actorIds = [...new Set([...engs, ...replies].map((r) => r.user_id))];
  const actors = await getProfiles(actorIds);
  const aById = Object.fromEntries(actors.map((p) => [p.id, p]));

  const whatLabel = { reaction: "reaction", reply: "comment", review: "review", progress: "progress update" };
  const items = [];

  for (const e of engs) {
    const book = bById[bookIdOf(e)];
    if (!book) continue; // target no longer resolvable — nothing to link to
    let snippet = null, highlight = null;
    if (e.target_type === "reaction") {
      snippet = reactionById[e.target_id]?.body;
      highlight = e.target_id;
    } else if (e.target_type === "reply") {
      const rep = replyById[e.target_id];
      snippet = rep?.body;
      highlight = rep?.reaction_id || null;
    } else if (e.target_type === "review") {
      snippet = reviewById[e.target_id]?.body;
    }
    items.push({
      id: e.id,
      kind: e.kind === "like" ? "like" : "emoji",
      emoji: e.kind === "like" ? null : e.kind,
      actor: aById[e.user_id] || null,
      what: whatLabel[e.target_type] || e.target_type,
      snippet, book, at: e.created_at,
      go: `/club/${book.club_id}/book/${book.id}`,
      highlight,
    });
  }

  for (const r of replies) {
    const parent = reactionById[r.reaction_id];
    const book = bById[parent?.book_id];
    if (!book) continue;
    items.push({
      id: r.id, kind: "reply", emoji: null,
      actor: aById[r.user_id] || null,
      what: "reaction",
      snippet: parent.body, body: r.body, book, at: r.created_at,
      go: `/club/${book.club_id}/book/${book.id}`,
      highlight: r.reaction_id,
    });
  }

  return items
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, limit);
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

// Reset my own progress on a book (delete the row). RLS (progress_delete_own)
// restricts this to the reader themself. Removing the row re-locks any reactions
// they'd unlocked by reading past them — the spoiler gate reads live from
// reading_progress, so it stays correct.
export async function deleteProgress(bookId) {
  const user = (await supabase.auth.getUser()).data.user;
  return unwrap(
    await supabase.from("reading_progress").delete()
      .eq("book_id", bookId).eq("user_id", user.id)
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

// Edit my own reaction (body and/or page). RLS (reactions_update_own) only lets
// the author update; the spoiler gate is a SELECT concern and stays intact.
export async function updateReaction(id, changes) {
  return unwrap(
    await supabase.from("reactions").update(changes).eq("id", id).select().single()
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

// Delete my own review. RLS (reviews_delete_own) restricts this to the author.
export async function deleteReview(id) {
  return unwrap(await supabase.from("reviews").delete().eq("id", id));
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

// --------------------------------------------------------- REACTION REPLIES ---
// X-style threaded comments under a reaction. RLS makes a reply visible only when
// its parent reaction is (it inherits the spoiler gate), so whatever comes back
// is safe to show. Fetched in bulk for a set of reactions to avoid N+1.
export async function reactionReplies(reactionIds) {
  if (!reactionIds.length) return [];
  const rows = unwrap(
    await supabase.from("reaction_replies").select("*")
      .in("reaction_id", reactionIds)
      .order("created_at", { ascending: true })
  );
  const profiles = await getProfiles(rows.map((r) => r.user_id));
  const pById = Object.fromEntries(profiles.map((p) => [p.id, p]));
  return rows.map((r) => ({ ...r, profile: pById[r.user_id] }));
}

export async function addReply(reactionId, body) {
  const user = (await supabase.auth.getUser()).data.user;
  return unwrap(
    await supabase.from("reaction_replies")
      .insert({ reaction_id: reactionId, user_id: user.id, body })
      .select().single()
  );
}

// Edit my own reply. RLS (replies_update_own) only lets the author update; the
// reply keeps inheriting its parent reaction's spoiler gate.
export async function updateReply(id, body) {
  return unwrap(
    await supabase.from("reaction_replies").update({ body }).eq("id", id).select().single()
  );
}

export async function deleteReply(id) {
  return unwrap(await supabase.from("reaction_replies").delete().eq("id", id));
}

// ------------------------------------------------------------- ENGAGEMENTS ---
// Likes + emoji tapbacks on ANY feed item (reaction, reply, review, book,
// progress milestone, selection, announcement). Polymorphic (target_type,
// target_id); RLS only returns engagements on targets the reader can see.
//
// target_id values are uuids, globally unique across tables, so we can fetch all
// engagements for a screen's worth of items with a single IN query and group
// them client-side by target_id.
export async function engagementsFor(targetIds) {
  if (!targetIds.length) return [];
  return unwrap(
    await supabase.from("engagements").select("*").in("target_id", targetIds)
  );
}

// Toggle a like/emoji for the current user: remove it if present, else add it.
// Returns true if the engagement is now ON, false if it was removed.
export async function toggleEngagement(targetType, targetId, kind) {
  const user = (await supabase.auth.getUser()).data.user;
  const existing = unwrap(
    await supabase.from("engagements").select("id")
      .eq("target_type", targetType).eq("target_id", targetId)
      .eq("user_id", user.id).eq("kind", kind)
  );
  if (existing.length) {
    await supabase.from("engagements").delete().eq("id", existing[0].id);
    return false;
  }
  unwrap(
    await supabase.from("engagements")
      .insert({ target_type: targetType, target_id: targetId, user_id: user.id, kind })
  );
  return true;
}

// ------------------------------------------------------------ ANNOUNCEMENTS ---
// Global broadcasts the app admin pushes to every user. Everyone can read them;
// only an admin can post. Per-user dismissal is tracked server-side so "seen"
// persists across devices. Returns announcements I haven't dismissed, newest first.
export async function activeAnnouncements() {
  const user = (await supabase.auth.getUser()).data.user;
  const [anns, reads] = await Promise.all([
    supabase.from("announcements").select("*").order("created_at", { ascending: false }).then(unwrap),
    supabase.from("announcement_reads").select("announcement_id").eq("user_id", user.id).then(unwrap),
  ]);
  const dismissed = new Set(reads.map((r) => r.announcement_id));
  return anns.filter((a) => !dismissed.has(a.id));
}

export async function dismissAnnouncement(announcementId) {
  const user = (await supabase.auth.getUser()).data.user;
  return unwrap(
    await supabase.from("announcement_reads")
      .upsert({ announcement_id: announcementId, user_id: user.id },
              { onConflict: "announcement_id,user_id" })
  );
}

export async function postAnnouncement(body) {
  const user = (await supabase.auth.getUser()).data.user;
  return unwrap(
    await supabase.from("announcements")
      .insert({ body, created_by: user.id })
      .select().single()
  );
}

// ------------------------------------------------------------- CLUB POSTS ---
// Lightweight Twitter/X-style posts scoped to a club: a short text update OR a
// single photo. These are NOT reviews and carry NO page number, so there is NO
// spoiler gate — but they ARE club-member-scoped. RLS (posts_select_member)
// only returns posts to members of the club, so whatever comes back is safe to
// show; posts_insert_member limits writes to members, and only the author can
// edit/delete their own. Photos live in the 'post-images' bucket under
// `${clubId}/...` (member-scoped by storage RLS).
export async function clubPosts(clubId) {
  const rows = unwrap(
    await supabase.from("club_posts").select("*").eq("club_id", clubId)
      .order("created_at", { ascending: false })
  );
  const profiles = await getProfiles(rows.map((r) => r.user_id));
  const pById = Object.fromEntries(profiles.map((p) => [p.id, p]));
  return rows.map((r) => ({ ...r, profile: pById[r.user_id] }));
}

// Upload a post photo to the 'post-images' bucket under the club's folder
// (member-scoped by storage RLS) and return its public URL. Mirrors the club
// cover upload path convention: `${clubId}/${Date.now()}.jpg`.
export async function uploadPostImage(clubId, blob) {
  const path = `${clubId}/${Date.now()}.jpg`;
  const { error } = await supabase.storage.from("post-images")
    .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
  if (error) throw error;
  const { data } = supabase.storage.from("post-images").getPublicUrl(path);
  return data.publicUrl;
}

// Create a post. At least one of body / imageUrl must be non-empty (enforced by
// the table CHECK too). body is trimmed to null when blank so a photo-only post
// stores no empty string.
export async function addPost(clubId, { body, imageUrl } = {}) {
  const user = (await supabase.auth.getUser()).data.user;
  const text = (body || "").trim();
  return unwrap(
    await supabase.from("club_posts")
      .insert({ club_id: clubId, user_id: user.id, body: text || null, image_url: imageUrl || null })
      .select().single()
  );
}

// Edit my own post's text. RLS (posts_update_own) only lets the author update.
export async function updatePost(id, changes) {
  return unwrap(
    await supabase.from("club_posts").update(changes).eq("id", id).select().single()
  );
}

export async function deletePost(id) {
  return unwrap(await supabase.from("club_posts").delete().eq("id", id));
}

// ------------------------------------------------------- DEVICE TOKENS ---
// Store an APNs device token for the signed-in user so the push Edge Function
// can find who to notify. Owner-only under RLS; unique on token, so re-register
// upserts. `environment` is 'sandbox' (dev builds) or 'production'.
export async function registerDeviceToken(token, { platform = "ios", environment = "sandbox" } = {}) {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) throw new Error("not signed in");
  return unwrap(
    await supabase.from("device_tokens")
      .upsert(
        { user_id: user.id, token, platform, environment, updated_at: new Date().toISOString() },
        { onConflict: "token" }
      )
      .select().single()
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
