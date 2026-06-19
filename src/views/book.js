import { render, navigate } from "../router.js";
import { esc, toast, avatarHTML, timeAgo, fmtDate, daysUntil } from "../ui.js";
import { store } from "../store.js";
import * as api from "../api.js";

export async function renderBook({ params }) {
  const { id: clubId, bookId } = params;
  render(`<div class="screen-pad"><p class="faint">loading book…</p></div>`);

  const book = await api.getBook(bookId);
  const [mine, reviews, myRev] = await Promise.all([
    api.myProgress(bookId),
    book.status === "finished" ? api.bookReviews(bookId) : Promise.resolve([]),
    api.myReview(bookId),
  ]);

  const myPage = mine?.current_page || 0;
  const finished = mine?.status === "finished";

  render(`
    <div class="screen-pad book-detail">
      <div class="screen-header">
        <button class="btn-back" data-nav="club">← ${esc(book.title).slice(0, 24)}</button>
        <span></span><span></span>
      </div>

      <div class="book-hero patch">
        ${book.cover_url ? `<img class="book-cover lg" src="${esc(book.cover_url)}" alt="">`
                         : `<div class="book-cover lg book-cover-blank">📖</div>`}
        <div class="book-hero-info">
          <h2 class="book-title">${esc(book.title)}</h2>
          <p class="book-author">${esc(book.author || "")}</p>
          <p class="faint">${book.page_count ? `${book.page_count} pages · ` : ""}status: ${esc(book.status)}</p>
          ${book.deadline ? `<p class="faint">deadline: ${fmtDate(book.deadline)} ${deadlineNote(book.deadline)}</p>` : ""}
        </div>
      </div>

      <!-- MY PROGRESS -->
      <div class="progress-panel patch">
        <h4>my progress</h4>
        <form data-progress class="progress-form">
          <label class="inline-field">page
            <input name="page" type="number" min="0" max="${book.page_count || 100000}"
              value="${myPage}" ${book.page_count ? `` : ``} /></label>
          ${book.page_count ? `<span class="faint">/ ${book.page_count}</span>` : ""}
          <button type="button" class="btn-ghost small" data-act="started">mark started</button>
          <button type="button" class="btn-ghost small" data-act="finished">mark finished ✓</button>
          <button type="submit" class="btn-primary small">save</button>
        </form>
        <p class="faint progress-hint">reactions unlock for you up to the page you've logged. log honestly to avoid spoilers.</p>
        ${book.status !== "finished" ? `
          <div class="book-admin">
            <button class="btn-ghost small" data-act="extend">＋ extend deadline 7d</button>
            <button class="btn-ghost small" data-act="finish-book">mark book finished for club</button>
          </div>` : ""}
      </div>

      <!-- POST REACTION -->
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

      <!-- REACTIONS FEED (already spoiler-filtered by the server) -->
      <div class="reactions-feed">
        <h4 class="feed-head">reactions <span class="faint" data-react-count></span></h4>
        <div data-reactions><p class="faint">loading…</p></div>
      </div>

      <!-- REVIEWS (finished only) -->
      <div class="reviews-section patch">
        <h4>reviews</h4>
        ${finished ? reviewFormHTML(myRev) : `
          <p class="faint locked-note">🔒 reviews unlock once you've marked the book finished.</p>`}
        <div data-reviews class="reviews-list">
          ${finished ? renderReviews(reviews) : ""}
        </div>
      </div>
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
    <div class="reaction-card" data-id="${r.id}">
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

async function loadReactions(root, bookId) {
  const host = root.querySelector("[data-reactions]");
  const reactions = await api.bookReactions(bookId);
  root.querySelector("[data-react-count]").textContent =
    reactions.length ? `(${reactions.length} unlocked)` : "";
  host.innerHTML = reactions.length
    ? reactions.map((r) => reactionCardHTML(r, store.user.id)).join("")
    : `<p class="faint">no reactions you can see yet — log more pages to unlock them.</p>`;
  host.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
    try { await api.deleteReaction(b.dataset.del); loadReactions(root, bookId); }
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
      loadReactions(root, book.id); // newly unlocked reactions appear
    } catch (err) { toast(err.message, "error"); }
  };
  pForm.addEventListener("submit", (e) => { e.preventDefault(); save(); });
  pForm.querySelector("[data-act='started']").addEventListener("click", () => save("reading"));
  pForm.querySelector("[data-act='finished']").addEventListener("click", () => {
    if (book.page_count) pForm.page.value = book.page_count;
    save("finished").then(() => navigate(`/club/${clubId}/book/${book.id}`));
  });

  root.querySelector("[data-act='extend']")?.addEventListener("click", async () => {
    const base = book.deadline ? new Date(book.deadline).getTime() : Date.now();
    try {
      await api.updateBook(book.id, {
        deadline: new Date(base + 7 * 86400000).toISOString(),
        deadline_extensions: (book.deadline_extensions || 0) + 1,
      });
      toast("Deadline extended 7 days", "success");
      navigate(`/club/${clubId}/book/${book.id}`);
    } catch (err) { toast(err.message, "error"); }
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
      loadReactions(root, book.id);
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

  // initial reactions load + live updates
  loadReactions(root, book.id);
  const unsub = api.subscribe(`reactions-${book.id}`, "reactions", `book_id=eq.${book.id}`,
    () => loadReactions(root, book.id));
  // tidy up the subscription when navigating away
  window.addEventListener("hashchange", function off() {
    unsub(); window.removeEventListener("hashchange", off);
  });
}
