// "My Progress" — a full-screen view of MY book reading progress across every
// club I'm in. On mobile this is a primary tab; on desktop it's reachable from
// the bottom tab bar too. Display-only and derived entirely from existing api.js
// reads (myClubs + currentBook + myProgress) — no new DB access, no gating logic.
import { render, navigate, onCleanup } from "../router.js";
import { esc, daysUntil } from "../ui.js";
import * as api from "../api.js";

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
    paint(host, rows.filter(Boolean));
  }

  await load();

  // Live refresh: when my progress changes (e.g. I logged pages on a book page),
  // re-derive in place. Cleaned up by the router before the next render.
  let timer;
  const refresh = () => { clearTimeout(timer); timer = setTimeout(load, 400); };
  const sub = api.subscribe("progress-tab", "reading_progress", undefined, refresh);
  onCleanup(() => { clearTimeout(timer); sub(); });
}

function paint(host, reading) {
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
}

function card({ club, book, mine }) {
  const pct = (book.page_count && mine)
    ? Math.min(100, Math.round((mine.current_page / book.page_count) * 100)) : 0;
  const dl = daysUntil(book.deadline);
  const dlChip = book.deadline
    ? `<span class="deadline-badge ${dl < 0 ? "overdue" : dl <= 3 ? "soon" : ""}">${dl < 0 ? `${-dl}d overdue` : `${dl}d left`}</span>`
    : "";
  const status = mine?.status === "finished" ? "finished ✓"
    : mine ? `page ${mine.current_page}${book.page_count ? ` / ${book.page_count}` : ""}`
    : "not started";
  return `
    <button class="progress-card patch" data-go="/club/${club.id}/book/${book.id}">
      ${book.cover_url
        ? `<img class="book-cover" src="${esc(book.cover_url)}" alt="">`
        : `<div class="book-cover book-cover-blank">📖</div>`}
      <div class="progress-card-info">
        <strong class="book-title">${esc(book.title)}</strong>
        <span class="book-author faint">${esc(book.author || "")}</span>
        <span class="progress-club faint">${esc(club.name)}</span>
        <span class="progress-bar"><span class="progress-fill" style="width:${pct}%"></span></span>
        <span class="progress-foot">
          <span class="progress-label faint">${status}</span>${dlChip}
          <span class="progress-pct">${pct}%</span>
        </span>
      </div>
    </button>`;
}
