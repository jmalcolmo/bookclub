// Personal involvement view (keyed by bookId + ownerId): ONE reader's own
// footprint on a single book - the reactions they wrote, the replies they wrote,
// and their reading-progress events - NOT the whole club's feed. Reached by
// tapping a book on a profile's "Books I've read" shelf.
//
// SPOILER GATE stays entirely server-side: every row comes back through RLS
// (api.userBookInvolvement), so whatever renders here is already safe to show -
// this view never re-implements gating. A "Show complete reactions" button is
// offered ONLY when the viewer and owner share a club that also has this work
// (api.sharedClubsForWork); it opens the existing full book history (book.js).
// With multiple shared clubs it shows a club chooser first.

import { render, navigate } from "../router.js";
import { esc, avatarHTML, timeAgo, fmtDate } from "../ui.js";
import { store } from "../store.js";
import * as api from "../api.js";

export async function renderBookInvolvement({ params } = {}) {
  const { bookId, ownerId } = params;
  render(`<div class="screen-pad"><p class="faint">loading…</p></div>`);

  let data;
  try {
    data = await api.userBookInvolvement(bookId, ownerId);
  } catch (err) {
    render(`
      <div class="screen-pad">
        <div class="screen-header"><button class="btn-back" data-back>← back</button>
          <h2 class="stamp-title small">READING</h2><span></span></div>
        <div class="empty-state"><p>couldn't load this book.</p>
          <p class="faint">${esc(err.message || "")}</p></div>
      </div>`, (root) => {
      root.querySelector("[data-back]").addEventListener("click", () => history.back());
    });
    return;
  }

  const { book, owner, reactions, replies, progress } = data;
  const isSelf = ownerId === store.user.id;
  const who = isSelf ? "you" : esc(owner?.display_name || "this reader");
  const whoTitle = isSelf ? "MY READING" : `${esc(owner?.display_name || "READER")}'S READING`;

  // Only consult sharedClubsForWork when we can correlate the same work across
  // clubs (needs an open_library_id). The button appears only if it's non-empty.
  let sharedClubs = [];
  try { sharedClubs = await api.sharedClubsForWork(book.open_library_id, ownerId); }
  catch { /* leave hidden on error */ }

  render(`
    <div class="screen-pad involvement-screen">
      <div class="screen-header"><button class="btn-back" data-back>← back</button>
        <h2 class="stamp-title small">${whoTitle}</h2><span></span></div>

      <div class="patch involvement-book">
        ${book.cover_url ? `<img class="book-cover md" src="${esc(book.cover_url)}" alt="${esc(book.title)} cover">`
                         : `<div class="book-cover md book-cover-blank" role="img" aria-label="${esc(book.title)} cover">📖</div>`}
        <div class="involvement-book-info">
          <h3 class="book-title">${esc(book.title)}</h3>
          <p class="book-author faint">${esc(book.author || "")}</p>
          ${progressLineHTML(progress, book, who)}
        </div>
      </div>

      ${sharedClubs.length ? `
        <div class="involvement-cta">
          <button type="button" class="btn-primary" data-complete>Show complete reactions</button>
          <p class="faint">${sharedClubs.length === 1
            ? "opens this book's full club history - everyone's reactions."
            : "opens a club's full book history - everyone's reactions."}</p>
        </div>` : ""}

      <section class="involvement-section">
        <h4 class="feed-head">${isSelf ? "your reactions" : `${esc(owner?.display_name || "their")} reactions`}
          <span class="faint">${reactions.length ? `(${reactions.length})` : ""}</span></h4>
        <div class="feed-stream">
          ${reactions.length
            ? reactions.map((r) => reactionCardHTML(r)).join("")
            : `<p class="faint">no reactions from ${who} on this book${isSelf ? " yet" : ""}.</p>`}
        </div>
      </section>

      <section class="involvement-section">
        <h4 class="feed-head">${isSelf ? "your replies" : "their replies"}
          <span class="faint">${replies.length ? `(${replies.length})` : ""}</span></h4>
        <div class="feed-stream">
          ${replies.length
            ? replies.map((r) => replyCardHTML(r)).join("")
            : `<p class="faint">no replies from ${who} on this book${isSelf ? " yet" : ""}.</p>`}
        </div>
      </section>
    </div>
  `, (root) => {
    root.querySelector("[data-back]").addEventListener("click", () => history.back());
    root.querySelector("[data-complete]")?.addEventListener("click", () => openComplete(sharedClubs));
  });
}

// The owner's reading-progress event line for this book, phrased for self/other.
function progressLineHTML(p, book, who) {
  if (!p) return `<p class="faint involvement-progress">no logged progress for ${who} on this book.</p>`;
  const of = book.page_count ? ` / ${book.page_count}` : "";
  if (p.status === "finished") {
    return `<p class="involvement-progress"><span class="finished-badge">✓ Finished</span>
      <span class="faint">page ${p.current_page}${of} · finished ${fmtDate(p.finished_at || p.updated_at)}</span></p>`;
  }
  if (p.status === "reading") {
    return `<p class="involvement-progress">📖 <span class="faint">reading - page ${p.current_page}${of} · updated ${timeAgo(p.updated_at)}</span></p>`;
  }
  return `<p class="involvement-progress">🔖 <span class="faint">not started yet</span></p>`;
}

function reactionCardHTML(r) {
  return `
    <div class="feed-item reaction-card">
      <div class="reaction-head">
        ${avatarHTML(r.profile, 30)}
        <span class="reaction-name">${esc(r.profile?.display_name || "Reader")}</span>
        <span class="reaction-page">p.${r.page}</span>
        <span class="reaction-time faint">${timeAgo(r.created_at)}</span>
      </div>
      <p class="reaction-body">${esc(r.body)}</p>
    </div>`;
}

function replyCardHTML(r) {
  return `
    <div class="feed-item reaction-card involvement-reply">
      <p class="involvement-reply-parent faint">↩ on a reaction at p.${r.parent?.page ?? "?"}: “${esc(truncate(r.parent?.body || "", 90))}”</p>
      <p class="reaction-body">${esc(r.body)}</p>
      <span class="reaction-time faint">${timeAgo(r.created_at)}</span>
    </div>`;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

// "Show complete reactions": one shared club → straight into its full book
// history (book.js); several → a small chooser first.
function openComplete(sharedClubs) {
  if (sharedClubs.length === 1) {
    const { club, book } = sharedClubs[0];
    navigate(`/club/${club.id}/book/${book.id}`);
    return;
  }
  showClubChooser(sharedClubs);
}

// A lightweight in-place chooser when the work exists in several shared clubs.
function showClubChooser(sharedClubs) {
  const host = document.querySelector(".involvement-cta");
  if (!host) return;
  host.innerHTML = `
    <h4 class="feed-head">pick a club</h4>
    <p class="faint">this book lives in more than one club you share. open its full history in:</p>
    <div class="involvement-club-list">
      ${sharedClubs.map(({ club, book }) => `
        <button type="button" class="btn-ghost involvement-club-pick"
          data-club="${club.id}" data-book="${book.id}">${esc(club.name)}</button>`).join("")}
    </div>`;
  host.querySelectorAll("[data-club]").forEach((b) =>
    b.addEventListener("click", () => navigate(`/club/${b.dataset.club}/book/${b.dataset.book}`)));
}
