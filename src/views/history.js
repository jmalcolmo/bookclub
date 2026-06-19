import { render, navigate } from "../router.js";
import { esc, avatarHTML, fmtDate } from "../ui.js";
import * as api from "../api.js";

export async function renderHistory({ params }) {
  const clubId = params.id;
  render(`<div class="screen-pad"><p class="faint">loading history…</p></div>`);

  const [club, books, members] = await Promise.all([
    api.getClub(clubId), api.clubBooks(clubId), api.clubMembers(clubId),
  ]);
  const pById = Object.fromEntries(members.map((m) => [m.user_id, m.profile]));
  const finished = books.filter((b) => b.status === "finished");

  // pull review averages per finished book
  const ratings = {};
  await Promise.all(finished.map(async (b) => {
    try {
      const revs = await api.bookReviews(b.id);
      const rated = revs.filter((r) => r.rating);
      ratings[b.id] = rated.length
        ? { avg: (rated.reduce((s, r) => s + r.rating, 0) / rated.length), n: rated.length }
        : null;
    } catch { ratings[b.id] = null; }
  }));

  const rows = finished.map((b) => {
    const picker = pById[b.picked_by];
    const r = ratings[b.id];
    return `
      <button class="history-row patch" data-book="${b.id}">
        ${b.cover_url ? `<img class="book-cover sm" src="${esc(b.cover_url)}" alt="">`
                      : `<div class="book-cover sm book-cover-blank">📖</div>`}
        <div class="history-info">
          <strong class="book-title">${esc(b.title)}</strong>
          <span class="book-author faint">${esc(b.author || "")}</span>
          <span class="history-meta faint">
            picked by ${esc(picker?.display_name || "—")} · finished ${fmtDate(b.finished_at)}</span>
        </div>
        <div class="history-rating">
          ${r ? `<span class="rating-num">${r.avg.toFixed(1)}</span><span class="rating-stars">★</span>
                 <span class="faint">${r.n}</span>`
              : `<span class="faint">no ratings</span>`}
        </div>
      </button>`;
  }).join("");

  render(`
    <div class="screen-pad">
      <div class="screen-header">
        <button class="btn-back" data-nav="club">← ${esc(club.name)}</button>
        <h2 class="stamp-title small">SHELF — BOOKS READ</h2><span></span>
      </div>
      ${finished.length ? `<div class="history-list">${rows}</div>` : `
        <div class="empty-state"><p>no finished books yet.</p>
          <p class="faint">when a book is marked finished, it lands here.</p></div>`}
    </div>
  `, (root) => {
    root.querySelector("[data-nav='club']").addEventListener("click", () => navigate(`/club/${clubId}`));
    root.querySelectorAll("[data-book]").forEach((b) =>
      b.addEventListener("click", () => navigate(`/club/${clubId}/book/${b.dataset.book}`)));
  });
}
