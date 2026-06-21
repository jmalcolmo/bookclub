import { render, navigate } from "../router.js";
import { esc, toast, avatarHTML, clubAvatarHTML, accentHex, fmtDate, daysUntil } from "../ui.js";
import { store } from "../store.js";
import * as api from "../api.js";
import { supabase } from "../supabaseClient.js";
import { openModal, closeModal } from "./clubs.js";
import { searchBooks } from "../openlibrary.js";

export async function renderClub({ params }) {
  const clubId = params.id;
  render(`<div class="screen-pad"><p class="faint">loading club…</p></div>`);

  const [club, members, book] = await Promise.all([
    api.getClub(clubId),
    api.clubMembers(clubId),
    api.currentBook(clubId),
  ]);

  let progress = [];
  if (book) progress = await api.bookProgress(book.id);
  const progById = Object.fromEntries(progress.map((p) => [p.user_id, p]));

  const myRole = members.find((m) => m.user_id === store.user.id)?.role;
  const isOwner = myRole === "creator" || myRole === "owner";

  // ---- current book panel ----
  let bookPanel;
  if (book) {
    const dl = daysUntil(book.deadline);
    const dlBadge = book.deadline
      ? `<span class="deadline-badge ${dl < 0 ? "overdue" : dl <= 3 ? "soon" : ""}">
           ${dl < 0 ? `${-dl}d overdue` : `${dl}d left`}</span>`
      : "";
    const picker = members.find((m) => m.user_id === book.picked_by)?.profile;
    bookPanel = `
      <div class="book-panel patch" data-open-book="${book.id}">
        ${book.cover_url
          ? `<img class="book-cover" src="${esc(book.cover_url)}" alt="" />`
          : `<div class="book-cover book-cover-blank">📖</div>`}
        <div class="book-panel-info">
          <span class="now-reading-tag">now reading</span>
          <h3 class="book-title">${esc(book.title)}</h3>
          <p class="book-author">${esc(book.author || "")}</p>
          <p class="book-sub faint">
            ${book.page_count ? `${book.page_count} pages · ` : ""}
            picked by ${esc(picker?.display_name || "—")}</p>
          ${dlBadge}
        </div>
        <span class="book-panel-go">open →</span>
      </div>`;
  } else {
    bookPanel = `
      <div class="book-panel patch book-panel-empty">
        <p>no book in progress.</p>
        <button class="btn-primary" data-action="add-book">+ Set the current book</button>
      </div>`;
  }

  // ---- members + progress list ----
  const memberRows = members.map((m) => {
    const p = progById[m.user_id];
    const pct = (book && book.page_count && p)
      ? Math.min(100, Math.round((p.current_page / book.page_count) * 100)) : 0;
    const statusLabel = !p ? "not started"
      : p.status === "finished" ? "finished ✓"
      : p.status === "reading" ? `p.${p.current_page}${book?.page_count ? ` / ${book.page_count}` : ""}`
      : "not started";
    return `
      <li class="member-row">
        ${avatarHTML(m.profile, 34)}
        <span class="member-name">${esc(m.profile?.display_name || "Reader")}
          ${m.role === "creator" || m.role === "owner" ? `<span class="owner-pip">${esc(m.role)}</span>` : ""}</span>
        <span class="member-progress">
          <span class="progress-bar"><span class="progress-fill" style="width:${pct}%"></span></span>
          <span class="progress-label faint">${statusLabel}</span>
        </span>
      </li>`;
  }).join("");

  render(`
    <div class="screen-pad club-detail" style="--accent:var(--${accentVar(club.accent)})">
      <div class="screen-header">
        <button class="btn-back" data-nav="clubs">← clubs</button>
        <h2 class="stamp-title small">${esc(club.name)}</h2>
        <button class="btn-icon" data-action="club-menu" title="club settings">⚙</button>
      </div>

      ${club.description ? `<p class="club-blurb">${esc(club.description)}</p>` : ""}

      <div class="club-toolbar">
        <span class="join-code-chip">code: <strong>${esc(club.join_code)}</strong>
          <button class="copy-code" data-copy="${esc(club.join_code)}" title="copy">⧉</button></span>
        <div class="toolbar-actions">
          <button class="btn-ghost" data-nav="picker">🎡 Pick next reader</button>
          <button class="btn-ghost" data-nav="history">📜 History</button>
        </div>
      </div>

      ${bookPanel}

      <div class="members-panel patch">
        <div class="panel-head">
          <h4>members &amp; progress</h4>
          ${book ? `<button class="btn-ghost small" data-open-book="${book.id}">update mine →</button>` : ""}
        </div>
        <ul class="member-list">${memberRows}</ul>
      </div>
    </div>
  `, (root) => {
    root.querySelector("[data-nav='clubs']").addEventListener("click", () => navigate("/clubs"));
    root.querySelector("[data-nav='picker']").addEventListener("click", () => navigate(`/club/${clubId}/picker`));
    root.querySelector("[data-nav='history']").addEventListener("click", () => navigate(`/club/${clubId}/history`));
    root.querySelectorAll("[data-open-book]").forEach((b) =>
      b.addEventListener("click", () => navigate(`/club/${clubId}/book/${b.dataset.openBook}`)));
    root.querySelector("[data-action='add-book']")?.addEventListener("click", () => addBookModal(club));
    root.querySelector("[data-copy]")?.addEventListener("click", (e) => {
      navigator.clipboard?.writeText(e.currentTarget.dataset.copy);
      toast("Code copied", "success");
    });
    root.querySelector("[data-action='club-menu']").addEventListener("click", () => clubMenu(club, isOwner));
  });
}

function accentVar(accent) { return accent || "yarn-sage"; }

// ---- add / change current book (Open Library lookup) ----
export function addBookModal(club, onDone) {
  openModal(`
    <h3>Set the current book</h3>
    <div class="modal-body">
      <label class="field"><span class="field-label">search a title or author</span>
        <input data-q placeholder="e.g. The Left Hand of Darkness" autocomplete="off" /></label>
      <div data-results class="ol-results"></div>
      <div class="modal-actions"><button class="btn-ghost" data-close>cancel</button></div>
    </div>
  `, (modal) => {
    const q = modal.querySelector("[data-q]");
    const results = modal.querySelector("[data-results]");
    let timer, deadlineDefault = club.deadlines_enabled && club.default_deadline_days
      ? new Date(Date.now() + club.default_deadline_days * 86400000).toISOString() : null;

    q.addEventListener("input", () => {
      clearTimeout(timer);
      const term = q.value.trim();
      if (term.length < 2) { results.innerHTML = ""; return; }
      results.innerHTML = `<p class="faint">searching…</p>`;
      timer = setTimeout(async () => {
        try {
          const books = await searchBooks(term);
          results.innerHTML = books.length ? books.map((b, i) => `
            <button class="ol-row" data-i="${i}">
              ${b.cover_url ? `<img src="${esc(b.cover_url)}" alt="">` : `<span class="ol-noimg">📖</span>`}
              <span class="ol-meta"><strong>${esc(b.title)}</strong>
                <span class="faint">${esc(b.author || "")}${b.year ? ` · ${b.year}` : ""}${b.page_count ? ` · ${b.page_count}p` : ""}</span></span>
            </button>`).join("") : `<p class="faint">no matches.</p>`;
          results.querySelectorAll(".ol-row").forEach((row) =>
            row.addEventListener("click", async () => {
              const chosen = books[Number(row.dataset.i)];
              try {
                const created = await api.addBook(club.id, { ...chosen, deadline: deadlineDefault });
                closeModal(); toast("Book set", "success");
                if (onDone) onDone(created); else navigate(`/club/${club.id}/book/${created.id}`);
              } catch (err) { toast(err.message, "error"); }
            }));
        } catch (err) { results.innerHTML = `<p class="faint">lookup failed: ${esc(err.message)}</p>`; }
      }, 350);
    });
    q.focus();
  });
}

function clubMenu(club, isOwner) {
  openModal(`
    <h3>${esc(club.name)}</h3>
    <div class="modal-body">
      ${isOwner ? `
        <div class="club-photo-edit">
          <div data-club-avatar>${clubAvatarHTML(club, 72, accentHex(club.accent))}</div>
          <label class="avatar-upload btn-ghost small">
            change club photo<input type="file" accept="image/*" data-club-photo hidden></label>
        </div>` : ""}
      <p class="faint">join code: <strong>${esc(club.join_code)}</strong></p>
      <div class="menu-actions">
        ${isOwner ? `<button class="btn-ghost" data-action="change-book">Change current book</button>` : ""}
        <button class="btn-ghost danger" data-action="leave">Leave club</button>
      </div>
      <div class="modal-actions"><button class="btn-ghost" data-close>close</button></div>
    </div>
  `, (modal) => {
    modal.querySelector("[data-club-photo]")?.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const path = `${club.id}/${Date.now()}-${file.name.replace(/[^\w.]/g, "_")}`;
        const { error } = await supabase.storage.from("club-images").upload(path, file, { upsert: true });
        if (error) throw error;
        const { data } = supabase.storage.from("club-images").getPublicUrl(path);
        await api.updateClub(club.id, { photo_url: data.publicUrl });
        club.photo_url = data.publicUrl;
        modal.querySelector("[data-club-avatar]").innerHTML = clubAvatarHTML(club, 72, accentHex(club.accent));
        toast("Club photo updated", "success");
      } catch (err) { toast(err.message, "error"); }
    });
    modal.querySelector("[data-action='change-book']")?.addEventListener("click", () => {
      closeModal(); addBookModal(club);
    });
    modal.querySelector("[data-action='leave']").addEventListener("click", async () => {
      if (!confirm(`Leave ${club.name}?`)) return;
      try { await api.leaveClub(club.id); closeModal(); toast("Left club", "info"); navigate("/clubs"); }
      catch (err) { toast(err.message, "error"); }
    });
  });
}
