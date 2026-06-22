import { render, navigate, onCleanup } from "../router.js";
import { esc, toast, avatarHTML, timeAgo, fmtDate, daysUntil } from "../ui.js";
import { store } from "../store.js";
import * as api from "../api.js";
import { openModal, closeModal } from "./clubs.js";

export async function renderBook({ params }) {
  const { id: clubId, bookId } = params;
  render(`<div class="screen-pad"><p class="faint">loading book…</p></div>`);

  const book = await api.getBook(bookId);
  const [mine, reviews, myRev, membership] = await Promise.all([
    api.myProgress(bookId),
    book.status === "finished" ? api.bookReviews(bookId) : Promise.resolve([]),
    api.myReview(bookId),
    api.myMembership(clubId),
  ]);

  const myPage = mine?.current_page || 0;
  const finished = mine?.status === "finished";
  const isCreator = membership?.role === "creator" || membership?.role === "owner";

  render(`
    <div class="book-feed">
      <!-- LEFT RAIL · the book (fixed) -->
      <aside class="feed-rail feed-rail-left book-rail">
        <button class="btn-back" data-nav="club">← back to club</button>
        <div class="patch book-rail-card">
          ${book.cover_url ? `<img class="book-cover lg" src="${esc(book.cover_url)}" alt="">`
                           : `<div class="book-cover lg book-cover-blank">📖</div>`}
          <div class="book-rail-info">
            <h2 class="book-title">${esc(book.title)}</h2>
            <p class="book-author">${esc(book.author || "")}</p>
            <p class="faint">${book.page_count ? `${book.page_count} pages` : ""}</p>
            <p class="faint">status: ${esc(book.status)}</p>
            ${book.deadline ? `<p class="faint">deadline: ${fmtDate(book.deadline)}<br>${deadlineNote(book.deadline)}</p>` : ""}
            ${isCreator && book.status !== "finished" ? `
              <div class="book-admin">
                <button class="btn-ghost small" data-act="edit-deadline">✎ edit deadline</button>
                <button class="btn-ghost small" data-act="finish-book">mark book finished for club</button>
              </div>` : ""}
          </div>
        </div>
      </aside>

      <!-- CENTER · the feed (scrolls) -->
      <main class="feed-column">
        <div class="reaction-compose patch">
          <h4>post a reaction</h4>
          <form data-react class="react-form">
            <div class="react-page">at page
              <input name="page" type="number" min="0" max="${book.page_count || 100000}" value="${myPage}" required></div>
            <textarea name="body" rows="2" maxlength="600" required
              placeholder="what happened? how'd it hit you? (only visible to people who've read this far)"></textarea>
            <button type="submit" class="btn-primary small">post reaction</button>
          </form>
        </div>

        <h4 class="feed-head">the feed <span class="faint" data-feed-count></span></h4>
        <div class="feed-stream" data-feed><p class="faint">loading…</p></div>

        <!-- REVIEWS (finished only) -->
        <div class="reviews-section patch">
          <h4>reviews</h4>
          ${finished ? reviewFormHTML(myRev) : `
            <p class="faint locked-note">🔒 reviews unlock once you've marked the book finished.</p>`}
          <div data-reviews class="reviews-list">
            ${finished ? renderReviews(reviews) : ""}
          </div>
        </div>
      </main>

      <!-- RIGHT RAIL · my progress (fixed, mirrors the book) -->
      <aside class="feed-rail feed-rail-right">
        <div class="progress-panel patch">
          <h4>my progress</h4>
          <form data-progress class="progress-form">
            <label class="inline-field">page
              <input name="page" type="number" min="0" max="${book.page_count || 100000}"
                value="${myPage}" /></label>
            ${book.page_count ? `<span class="faint">/ ${book.page_count}</span>` : ""}
            <button type="button" class="btn-ghost small" data-act="started">mark started</button>
            <button type="button" class="btn-ghost small" data-act="finished">mark finished ✓</button>
            <button type="submit" class="btn-primary small">save</button>
          </form>
          <p class="faint progress-hint">reactions unlock for you up to the page you've logged. log honestly to avoid spoilers.</p>
        </div>
      </aside>
    </div>
  `, (root) => wire(root, { clubId, book, mine }));
}

function deadlineNote(dl) {
  const d = daysUntil(dl);
  if (d == null) return "";
  return d < 0 ? `<span class="deadline-badge overdue">${-d}d overdue</span>`
       : `<span class="deadline-badge ${d <= 3 ? "soon" : ""}">${d}d left</span>`;
}

function reviewFormHTML(rev) {
  const r = rev?.rating || 0;
  const stars = [1,2,3,4,5].map((n) =>
    `<button type="button" class="star ${n <= r ? "on" : ""}" data-star="${n}">★</button>`).join("");
  return `
    <form data-review class="review-form">
      <div class="star-row" data-stars>${stars}<input type="hidden" name="rating" value="${r}"></div>
      <textarea name="body" rows="3" maxlength="1200" placeholder="your overall take on the book…">${esc(rev?.body || "")}</textarea>
      <button type="submit" class="btn-primary small">${rev ? "update review" : "post review"}</button>
    </form>`;
}

function renderReviews(reviews) {
  if (!reviews.length) return `<p class="faint">no reviews yet.</p>`;
  return reviews.map((rv) => `
    <div class="review-card">
      <div class="review-head">${avatarHTML(rv.profile, 30)}
        <span class="review-name">${esc(rv.profile?.display_name || "Reader")}</span>
        <span class="review-stars">${"★".repeat(rv.rating || 0)}${"☆".repeat(5 - (rv.rating || 0))}</span></div>
      ${rv.body ? `<p class="review-body">${esc(rv.body)}</p>` : ""}
    </div>`).join("");
}

function reactionCardHTML(r, mineId) {
  return `
    <div class="feed-item reaction-card" data-id="${r.id}">
      <div class="reaction-head">
        ${avatarHTML(r.profile, 30)}
        <span class="reaction-name">${esc(r.profile?.display_name || "Reader")}</span>
        <span class="reaction-page">p.${r.page}</span>
        <span class="reaction-time faint">${timeAgo(r.created_at)}</span>
        ${r.user_id === mineId ? `<button class="reaction-del" data-del="${r.id}" title="delete">×</button>` : ""}
      </div>
      <p class="reaction-body">${esc(r.body)}</p>
    </div>`;
}

function notifCardHTML(n) {
  return `
    <div class="feed-item notif-card ${n.highlight ? "notif-highlight" : ""}">
      <span class="notif-icon" aria-hidden="true">${n.icon}</span>
      <div class="notif-main">
        <p class="notif-text">${esc(n.text)}</p>
        <span class="notif-time faint">${timeAgo(n.ts)}</span>
      </div>
    </div>`;
}

// Derive "activity" notifications from each member's latest reading_progress row.
// These are computed client-side from progress (no notifications table yet), so
// each member contributes one card reflecting their current state.
function buildNotifications(progress, memberCount, book) {
  const items = [];
  const me = store.user?.id;
  for (const p of progress) {
    const name = (p.user_id === me ? "You" : (p.profile?.display_name || "A reader"));
    if (p.status === "finished") {
      items.push({ ts: p.finished_at || p.updated_at, icon: "🎉",
        text: `${name} finished the book` });
    } else if (p.status === "reading" && p.current_page > 0) {
      const of = book.page_count ? ` of ${book.page_count}` : "";
      items.push({ ts: p.updated_at, icon: "📖",
        text: `${name} read to page ${p.current_page}${of}` });
    } else if (p.status === "reading" || p.started_at) {
      items.push({ ts: p.started_at || p.updated_at, icon: "🔖",
        text: `${name} started reading` });
    }
  }
  const finishedRows = progress.filter((p) => p.status === "finished");
  if (memberCount > 0 && finishedRows.length >= memberCount) {
    const lastTs = finishedRows.reduce(
      (m, p) => Math.max(m, new Date(p.finished_at || p.updated_at).getTime()), 0);
    items.push({ ts: new Date(lastTs).toISOString(), icon: "🏆", highlight: true,
      text: "Everyone has finished the book!" });
  }
  return items;
}

// Build the merged, newest-first feed: spoiler-safe reactions (RLS already
// filtered them) interleaved with activity notifications.
async function loadFeed(root, clubId, book) {
  const host = root.querySelector("[data-feed]");
  const [reactions, progress, members] = await Promise.all([
    api.bookReactions(book.id),
    api.bookProgress(book.id),
    api.clubMembers(clubId),
  ]);

  const notifs = buildNotifications(progress, members.length, book);
  const feed = [
    ...reactions.map((r) => ({ kind: "reaction", ts: r.created_at, data: r })),
    ...notifs.map((n) => ({ kind: "notif", ts: n.ts, data: n })),
  ].sort((a, b) => new Date(b.ts) - new Date(a.ts));

  const countEl = root.querySelector("[data-feed-count]");
  if (countEl) countEl.textContent =
    reactions.length ? `(${reactions.length} reaction${reactions.length === 1 ? "" : "s"} unlocked)` : "";

  host.innerHTML = feed.length
    ? feed.map((item) => item.kind === "reaction"
        ? reactionCardHTML(item.data, store.user.id)
        : notifCardHTML(item.data)).join("")
    : `<p class="faint">nothing here yet — be the first to post a reaction. log more pages to unlock reactions from others.</p>`;

  host.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
    try { await api.deleteReaction(b.dataset.del); loadFeed(root, clubId, book); }
    catch (err) { toast(err.message, "error"); }
  }));
}

function wire(root, { clubId, book, mine }) {
  root.querySelector("[data-nav='club']").addEventListener("click", () => navigate(`/club/${clubId}`));

  // progress save
  const pForm = root.querySelector("[data-progress]");
  const save = async (status) => {
    const page = Number(pForm.page.value) || 0;
    const st = status || (page > 0 ? "reading" : "not_started");
    try {
      await api.setProgress(book.id, page, st);
      mine = { current_page: page, status: st };
      toast("Progress saved", "success");
      loadFeed(root, clubId, book); // newly unlocked reactions + updated activity
    } catch (err) { toast(err.message, "error"); }
  };
  pForm.addEventListener("submit", (e) => { e.preventDefault(); save(); });
  pForm.querySelector("[data-act='started']").addEventListener("click", () => save("reading"));
  pForm.querySelector("[data-act='finished']").addEventListener("click", () => {
    if (book.page_count) pForm.page.value = book.page_count;
    save("finished").then(() => navigate(`/club/${clubId}/book/${book.id}`));
  });

  root.querySelector("[data-act='edit-deadline']")?.addEventListener("click", () => {
    const current = book.deadline ? new Date(book.deadline).toISOString().slice(0, 10) : "";
    openModal(`
      <h3>Edit deadline</h3>
      <form data-form class="modal-body">
        <label class="field"><span class="field-label">finish-by date</span>
          <input name="date" type="date" value="${current}" /></label>
        <p class="faint">leave blank and save to remove the deadline.</p>
        <div class="modal-actions">
          <button type="button" class="btn-ghost" data-close>cancel</button>
          <button type="submit" class="btn-primary">Save deadline</button>
        </div>
      </form>
    `, (modal) => {
      modal.querySelector("[data-form]").addEventListener("submit", async (e) => {
        e.preventDefault();
        const val = e.target.date.value;
        // Anchor to local noon so the saved UTC date doesn't drift across day boundaries.
        const deadline = val ? new Date(`${val}T12:00:00`).toISOString() : null;
        try {
          await api.updateBook(book.id, { deadline });
          closeModal();
          toast(deadline ? "Deadline updated" : "Deadline removed", "success");
          navigate(`/club/${clubId}/book/${book.id}`);
        } catch (err) { toast(err.message, "error"); }
      });
    });
  });
  root.querySelector("[data-act='finish-book']")?.addEventListener("click", async () => {
    if (!confirm("Mark this book finished for the whole club? It moves to history.")) return;
    try { await api.finishBook(book.id); toast("Book finished", "success"); navigate(`/club/${clubId}`); }
    catch (err) { toast(err.message, "error"); }
  });

  // post reaction
  root.querySelector("[data-react]").addEventListener("submit", async (e) => {
    e.preventDefault();
    const page = Number(e.target.page.value);
    const body = e.target.body.value.trim();
    if (!body) return;
    try {
      await api.addReaction(book.id, page, body);
      e.target.body.value = "";
      toast("Reaction posted", "success");
      loadFeed(root, clubId, book);
    } catch (err) { toast(err.message, "error"); }
  });

  // review form (only present when finished)
  const stars = root.querySelector("[data-stars]");
  if (stars) {
    stars.querySelectorAll("[data-star]").forEach((s) => s.addEventListener("click", () => {
      const v = Number(s.dataset.star);
      stars.querySelector("[name='rating']").value = v;
      stars.querySelectorAll("[data-star]").forEach((x) =>
        x.classList.toggle("on", Number(x.dataset.star) <= v));
    }));
  }
  root.querySelector("[data-review]")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const rating = Number(e.target.rating.value) || null;
    const body = e.target.body.value.trim();
    try {
      await api.saveReview(book.id, rating, body);
      toast("Review saved", "success");
      root.querySelector("[data-reviews]").innerHTML = renderReviews(await api.bookReviews(book.id));
    } catch (err) { toast(err.message, "error"); }
  });

  // initial feed load + live updates (reactions AND member progress feed activity)
  loadFeed(root, clubId, book);
  const unsubReactions = api.subscribe(`reactions-${book.id}`, "reactions", `book_id=eq.${book.id}`,
    () => loadFeed(root, clubId, book));
  const unsubProgress = api.subscribe(`progress-${book.id}`, "reading_progress", `book_id=eq.${book.id}`,
    () => loadFeed(root, clubId, book));
  onCleanup(unsubReactions); // router tears these down before the next (re)render
  onCleanup(unsubProgress);
}
