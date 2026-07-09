// "My Progress" — the logging hub: every current book across my clubs, each
// with my position AND inline entry forms (update progress / post a reaction)
// so logging never requires a trip through the club → book pages. The book
// cover/title still taps through to the full book page. Reads come from
// existing api.js calls; the reaction→progress gate mirrors book.js: reacting
// past your logged page prompts you to bump your progress (dismissing still
// bumps to the reaction page, so you never sit below a reaction you posted).
import { render, navigate, onCleanup } from "../router.js";
import { esc, daysUntil, toast } from "../ui.js";
import * as api from "../api.js";
import { openModal, closeModal } from "./clubs.js";
import { unlockToast } from "./unlocked.js";

export async function renderProgress() {
  render(`
    <div class="screen-pad progress-screen">
      <div class="screen-header"><span></span>
        <h2 class="stamp-title small">MY PROGRESS</h2><span></span></div>
      <div data-progress><p class="faint">loading your books…</p></div>
    </div>
  `, (root) => boot(root));
}

async function boot(root) {
  const host = root.querySelector("[data-progress]");

  async function load() {
    const clubs = await api.myClubs();
    const rows = await Promise.all(clubs.map(async (club) => {
      const book = await api.currentBook(club.id);
      if (!book) return null;
      const mine = await api.myProgress(book.id);
      return { club, book, mine };
    }));
    paint(host, rows.filter(Boolean), load);
  }

  await load();

  // Live refresh: when my progress changes (e.g. I logged pages on a book page),
  // re-derive in place. Cleaned up by the router before the next render.
  let timer;
  const refresh = () => { clearTimeout(timer); timer = setTimeout(load, 400); };
  const sub = api.subscribe("progress-tab", "reading_progress", undefined, refresh);
  onCleanup(() => { clearTimeout(timer); sub(); });
}

function paint(host, reading, reload) {
  if (!reading.length) {
    host.innerHTML = `
      <div class="empty-state patch">
        <p>you're not reading anything yet.</p>
        <p class="faint">join a club and set a book — your reading progress shows up here.</p>
      </div>`;
    return;
  }
  host.innerHTML = `<div class="progress-list">${reading.map(card).join("")}</div>`;
  host.querySelectorAll("[data-go]").forEach((el) =>
    el.addEventListener("click", () => navigate(el.dataset.go)));
  reading.forEach((row) => wireCard(host, row, reload));
}

function card({ club, book, mine }) {
  const pct = (book.page_count && mine)
    ? Math.min(100, Math.round((mine.current_page / book.page_count) * 100)) : 0;
  const dl = daysUntil(book.deadline);
  const dlChip = book.deadline
    ? `<span class="deadline-badge ${dl < 0 ? "overdue" : dl <= 3 ? "soon" : ""}">${dl < 0 ? `${-dl}d overdue` : `${dl}d left`}</span>`
    : "";
  const finished = mine?.status === "finished";
  const myPage = mine?.current_page || 0;
  const status = finished ? "finished ✓"
    : mine ? `page ${myPage}${book.page_count ? ` / ${book.page_count}` : ""}`
    : "not started";
  // Finished books stay listed but lock editing: no page input / "Update
  // progress" button. We show a clear ✓ Finished state, keep a tap-through to
  // the book page (to add reactions), and offer a reversible "still reading".
  const actions = finished
    ? `
      <div class="progress-card-actions progress-actions-finished">
        <div class="finished-state" role="status">
          <span class="finished-badge">✓ Finished</span>
          <button type="button" class="btn-ghost small" data-act="unfinish">Mark as still reading</button>
        </div>
        <button type="button" class="btn-ghost small progress-add-reaction"
          data-go="/club/${club.id}/book/${book.id}">💬 add a reaction</button>
      </div>`
    : `
      <div class="progress-card-actions">
        <form class="progress-form progress-inline-form" data-update aria-label="Update my progress on ${esc(book.title)}">
          <label class="inline-field">page
            <input name="page" type="number" min="0" max="${book.page_count || 100000}" value="${myPage}"
              aria-label="Current page${book.page_count ? ` of ${book.page_count}` : ""}"></label>
          ${book.page_count ? `<span class="faint" aria-hidden="true">/ ${book.page_count}</span>` : ""}
          <button type="submit" class="btn-primary small">Update progress</button>
          <button type="button" class="btn-ghost small" data-act="finished">finished ✓</button>
          <button type="button" class="btn-ghost small" data-act="react-toggle" aria-expanded="false">💬 react</button>
        </form>
        <form class="react-form progress-react-form" data-react hidden aria-label="Post a reaction on ${esc(book.title)}">
          <div class="react-page">at page
            <input name="page" type="number" min="0" max="${book.page_count || 100000}" value="${myPage}" required></div>
          <textarea name="body" rows="2" maxlength="600" required
            placeholder="what happened? how'd it hit you? (only visible to people who've read this far)"></textarea>
          <button type="submit" class="btn-primary small">post reaction</button>
        </form>
      </div>`;
  return `
    <article class="progress-card patch ${finished ? "progress-card-finished" : ""}" data-card="${book.id}">
      <button class="progress-card-top" data-go="/club/${club.id}/book/${book.id}"
        aria-label="Open ${esc(book.title)} — ${esc(club.name)} — ${status}">
        ${book.cover_url
          ? `<img class="book-cover" src="${esc(book.cover_url)}" alt="${esc(book.title)} cover">`
          : `<div class="book-cover book-cover-blank" role="img" aria-label="${esc(book.title)} cover">📖</div>`}
        <div class="progress-card-info">
          <strong class="book-title">${esc(book.title)}</strong>
          <span class="book-author faint">${esc(book.author || "")}</span>
          <span class="progress-club faint">${esc(club.name)}</span>
          <span class="progress-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${pct}% read"><span class="progress-fill" style="width:${pct}%"></span></span>
          <span class="progress-foot">
            <span class="progress-label faint">${status}</span>${dlChip}
            <span class="progress-pct">${pct}%</span>
          </span>
        </div>
      </button>
      ${actions}
    </article>`;
}

function wireCard(host, { club, book, mine }, reload) {
  const card = host.querySelector(`[data-card="${book.id}"]`);
  if (!card) return;

  const applyProgress = async (page, status, { silent } = {}) => {
    const st = status || (page > 0 ? "reading" : "not_started");
    const saved = await api.setProgress(book.id, page, st, { prevPage: mine?.current_page ?? 0 });
    mine = { current_page: page, status: st };
    if (!silent) toast("Progress saved", "success");
    if (saved?.unlocked?.length) unlockToast(saved.unlocked.length);
    reload();
  };

  // Finished card: editing is locked. Only wire the reversible "still reading"
  // control (keeps current_page, flips status back to reading) — the "add a
  // reaction" button rides the shared [data-go] handler to the book page.
  if (mine?.status === "finished") {
    card.querySelector("[data-act='unfinish']")?.addEventListener("click", async () => {
      try {
        await applyProgress(mine?.current_page || 0, "reading");
        toast("Marked as still reading", "success");
      } catch (err) { toast(err.message, "error"); }
    });
    return;
  }

  const pForm = card.querySelector("[data-update]");
  const rForm = card.querySelector("[data-react]");

  pForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const page = Number(pForm.page.value) || 0;
    try {
      // Reached (or passed) the last page? Offer to mark the book complete.
      if (book.page_count && page >= book.page_count && mine?.status !== "finished") {
        promptComplete(page);
      } else {
        await applyProgress(page);
      }
    } catch (err) { toast(err.message, "error"); }
  });

  pForm.querySelector("[data-act='finished']")?.addEventListener("click", async () => {
    try { await applyProgress(book.page_count || Number(pForm.page.value) || 0, "finished"); }
    catch (err) { toast(err.message, "error"); }
  });

  pForm.querySelector("[data-act='react-toggle']").addEventListener("click", (e) => {
    rForm.hidden = !rForm.hidden;
    e.currentTarget.setAttribute("aria-expanded", String(!rForm.hidden));
    if (!rForm.hidden) rForm.body.focus();
  });

  // Same gate as the book page: reacting past your logged page offers to bump
  // your progress; any dismissal still sets you to the reaction's page.
  rForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const page = Number(rForm.page.value);
    const body = rForm.body.value.trim();
    if (!body) return;
    try {
      await api.addReaction(book.id, page, body);
      rForm.body.value = "";
      toast("Reaction posted", "success");
      if (page > (mine?.current_page || 0)) promptProgress(page);
      else reload();
    } catch (err) { toast(err.message, "error"); }
  });

  function promptProgress(reactionPage) {
    let handled = false;
    const done = async (page) => {
      if (handled) return;
      handled = true;
      try { await applyProgress(page, "reading", { silent: true }); }
      catch (err) { toast(err.message, "error"); }
    };
    const loggedNow = mine?.current_page || 0;
    const modal = openModal(`
      <h3>My progress</h3>
      <form data-form class="modal-body">
        <p class="faint">You reacted at page ${reactionPage}, but you're logged at page ${loggedNow}. Update how far you've read?</p>
        <label class="field"><span class="field-label">page read to</span>
          <input name="page" type="number" min="${reactionPage}" max="${book.page_count || 100000}" value="${reactionPage}" /></label>
        <div class="modal-actions">
          <button type="button" class="btn-ghost" data-dismiss>not now</button>
          <button type="submit" class="btn-primary">Save progress</button>
        </div>
      </form>
    `, (m) => {
      m.querySelector("[data-form]").addEventListener("submit", async (e) => {
        e.preventDefault();
        const val = Math.max(reactionPage, Number(e.target.page.value) || reactionPage);
        await done(val);
        closeModal();
      });
      m.querySelector("[data-dismiss]").addEventListener("click", async () => {
        await done(reactionPage);
        closeModal();
      });
    });
    modal.addEventListener("click", (e) => { if (e.target === modal) done(reactionPage); });
  }

  // Entered a page at/past the last page: ask whether the book is complete.
  // Yes → finished at page_count. Dismiss → just save the reading progress.
  function promptComplete(page) {
    let handled = false;
    const done = async (status) => {
      if (handled) return;
      handled = true;
      try {
        if (status === "finished") await applyProgress(book.page_count, "finished");
        else await applyProgress(page);
      } catch (err) { toast(err.message, "error"); }
    };
    const modal = openModal(`
      <h3>Did you complete this book?</h3>
      <form data-form class="modal-body">
        <p class="faint">You're at page ${page} of ${book.page_count}. Mark <strong>${esc(book.title)}</strong> as finished?</p>
        <div class="modal-actions">
          <button type="button" class="btn-ghost" data-dismiss>Not yet</button>
          <button type="submit" class="btn-primary">Yes, finished ✓</button>
        </div>
      </form>
    `, (m) => {
      m.querySelector("[data-form]").addEventListener("submit", async (e) => {
        e.preventDefault();
        await done("finished");
        closeModal();
      });
      m.querySelector("[data-dismiss]").addEventListener("click", async () => {
        await done("reading");
        closeModal();
      });
    });
    // Backdrop click = "not yet": still save the entered reading progress.
    modal.addEventListener("click", (e) => { if (e.target === modal) done("reading"); });
  }
}
