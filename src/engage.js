// Shared UI for engagements (likes + iMessage-style emoji tapbacks) and reaction
// reply threads (X-style). Both the book feed and the home feed compose their
// cards from these pieces, so the look + behavior stay identical everywhere.
//
// All DB access still goes through api.js — this module only builds markup and
// wires DOM events, then calls api.toggle/add/delete. It never touches supabase
// directly (per the repo's api.js boundary rule).
import { esc, avatarHTML, timeAgo, toast } from "./ui.js";
import * as api from "./api.js";

// The fixed tapback palette (Like is separate, rendered as its own button).
export const EMOJI_PALETTE = ["❤️", "😂", "😮", "😢", "🔥"];

// Which reaction threads are currently expanded, by reaction id. Kept in module
// scope so a feed reload (realtime/debounced) doesn't collapse an open thread.
const openThreads = new Set();

// Build a fast (id -> display name) resolver from any arrays of {id|user_id, profile/display_name}.
export function makeNameResolver(profileMap) {
  return (userId) => profileMap[userId]?.display_name || "Someone";
}

function namesLabel(names, emptyText) {
  if (!names.length) return emptyText;
  if (names.length <= 4) return names.join(", ");
  return `${names.slice(0, 4).join(", ")} +${names.length - 4} more`;
}

// The like + emoji-tapback bar for ONE target (reaction/reply/review/book/…).
//   engs   - engagement rows for THIS target ({ kind, user_id })
//   nameOf - (userId) => display name (for hover tooltips)
//   myId   - current user id (to show what I've already tapped)
export function engagementBarHTML(targetType, targetId, engs = [], nameOf = () => "Someone", myId) {
  const byKind = {};
  for (const e of engs) (byKind[e.kind] ||= []).push(e.user_id);

  const likeUsers = byKind["like"] || [];
  const iLiked = likeUsers.includes(myId);

  // Existing emoji tapbacks shown as iMessage-style chips (only those with a count).
  const chips = EMOJI_PALETTE
    .filter((em) => (byKind[em] || []).length)
    .map((em) => {
      const users = byKind[em];
      const mine = users.includes(myId);
      return `<button type="button" class="engage-chip ${mine ? "on" : ""}" data-kind="${esc(em)}"
        title="${esc(namesLabel(users.map(nameOf), ""))}">${em}<span class="engage-n">${users.length}</span></button>`;
    }).join("");

  // The "add reaction" popover offers the full palette; an already-tapped one is marked.
  const palette = EMOJI_PALETTE.map((em) => {
    const mine = (byKind[em] || []).includes(myId);
    return `<button type="button" class="palette-emoji ${mine ? "on" : ""}" data-kind="${esc(em)}">${em}</button>`;
  }).join("");

  return `
    <div class="engage-bar" data-engage="${esc(targetType)}" data-target="${esc(targetId)}">
      <button type="button" class="engage-like ${iLiked ? "on" : ""}" data-kind="like"
        title="${esc(namesLabel(likeUsers.map(nameOf), "Be the first to like"))}">
        <span class="engage-thumb">👍</span><span class="engage-label">Like</span>${likeUsers.length ? `<span class="engage-n">${likeUsers.length}</span>` : ""}
      </button>
      ${chips}
      <span class="engage-react">
        <button type="button" class="engage-add" title="react">＋</button>
        <span class="engage-palette" hidden>${palette}</span>
      </span>
    </div>`;
}

// A single reply inside a thread, with its own (small) engagement bar.
function replyHTML(reply, engForReply, nameOf, myId) {
  return `
    <div class="reply-item" data-reply="${reply.id}">
      ${avatarHTML(reply.profile, 22)}
      <div class="reply-main">
        <div class="reply-head">
          <span class="reply-name">${esc(reply.profile?.display_name || "Reader")}</span>
          <span class="reply-time faint">${timeAgo(reply.created_at)}</span>
          ${reply.user_id === myId ? `<button type="button" class="reply-del" data-del-reply="${reply.id}" title="delete">×</button>` : ""}
        </div>
        <p class="reply-body">${esc(reply.body)}</p>
        ${engagementBarHTML("reply", reply.id, engForReply, nameOf, myId)}
      </div>
    </div>`;
}

// The collapsible thread under a reaction: a toggle, the replies, and a composer.
//   replies      - reply rows for this reaction (with .profile)
//   engByTarget  - (targetId) => engagement rows, for replies' own bars
export function replyThreadHTML(reactionId, replies, engByTarget, nameOf, myId) {
  const open = openThreads.has(reactionId);
  const count = replies.length;
  const label = count ? `${count} repl${count === 1 ? "y" : "ies"}` : "reply";
  return `
    <div class="reaction-thread" data-thread="${reactionId}">
      <button type="button" class="thread-toggle" data-thread-toggle="${reactionId}">💬 ${label}</button>
      <div class="thread-body" ${open ? "" : "hidden"}>
        ${replies.map((r) => replyHTML(r, engByTarget(r.id), nameOf, myId)).join("")}
        <form class="reply-form" data-reply-form="${reactionId}">
          <input class="reply-input" name="body" maxlength="500" placeholder="write a reply…" autocomplete="off" required>
          <button type="submit" class="btn-ghost small">reply</button>
        </form>
      </div>
    </div>`;
}

// Wire every engagement bar in `scope`. onChange() is called after a successful
// toggle so the caller can refresh. stopPropagation keeps clicks from triggering
// a card's data-go navigation.
export function wireEngagements(scope, onChange) {
  scope.querySelectorAll(".engage-bar").forEach((bar) => {
    if (bar.dataset.wired) return;
    bar.dataset.wired = "1";
    const type = bar.dataset.engage, id = bar.dataset.target;

    bar.querySelectorAll("[data-kind]").forEach((btn) =>
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try { await api.toggleEngagement(type, id, btn.dataset.kind); onChange?.(); }
        catch (err) { toast(err.message, "error"); }
      }));

    const add = bar.querySelector(".engage-add");
    const pal = bar.querySelector(".engage-palette");
    if (add && pal) add.addEventListener("click", (e) => { e.stopPropagation(); pal.hidden = !pal.hidden; });
  });
}

// Wire reaction reply threads in `scope` (toggle, compose, delete).
export function wireReplies(scope, onChange) {
  scope.querySelectorAll("[data-thread-toggle]").forEach((btn) => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.threadToggle;
      const body = btn.parentElement.querySelector(".thread-body");
      const show = body.hidden;
      body.hidden = !show;
      if (show) openThreads.add(id); else openThreads.delete(id);
    });
  });

  scope.querySelectorAll("[data-reply-form]").forEach((form) => {
    if (form.dataset.wired) return;
    form.dataset.wired = "1";
    form.addEventListener("click", (e) => e.stopPropagation()); // don't navigate while typing
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const body = form.body.value.trim();
      if (!body) return;
      openThreads.add(form.dataset.replyForm); // keep it open through the reload
      try { await api.addReply(form.dataset.replyForm, body); form.body.value = ""; onChange?.(); }
      catch (err) { toast(err.message, "error"); }
    });
  });

  scope.querySelectorAll("[data-del-reply]").forEach((b) => {
    if (b.dataset.wired) return;
    b.dataset.wired = "1";
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      try { await api.deleteReply(b.dataset.delReply); onChange?.(); }
      catch (err) { toast(err.message, "error"); }
    });
  });
}

// Convenience: wire both engagement bars and reply threads at once. Also stops
// clicks inside a card's footer (likes/emoji/thread) from bubbling up to a
// card-level data-go navigation handler.
export function wireEngagementUI(scope, onChange) {
  scope.querySelectorAll(".card-foot").forEach((foot) => {
    if (foot.dataset.wired) return;
    foot.dataset.wired = "1";
    foot.addEventListener("click", (e) => e.stopPropagation());
  });
  wireEngagements(scope, onChange);
  wireReplies(scope, onChange);
}
