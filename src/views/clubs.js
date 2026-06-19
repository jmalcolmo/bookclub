import { render, navigate } from "../router.js";
import { esc, toast } from "../ui.js";
import * as api from "../api.js";

const ACCENTS = [
  ["yarn-sage", "#7a9068"], ["yarn-rust", "#a05838"], ["yarn-slate", "#587888"],
  ["yarn-mauve", "#886878"], ["yarn-ochre", "#b8a058"], ["yarn-moss", "#607050"],
  ["yarn-clay", "#987860"], ["yarn-bark", "#483828"],
];

export async function renderClubs() {
  render(`<div class="screen-pad"><h2 class="stamp-title small">MY CLUBS</h2><p class="faint">loading…</p></div>`);
  const clubs = await api.myClubs();

  const cards = clubs.map((c) => {
    const color = (ACCENTS.find((a) => a[0] === c.accent) || ACCENTS[0])[1];
    return `
      <button class="club-card patch" data-club="${c.id}" style="--accent:${color}">
        <span class="club-card-name">${esc(c.name)}</span>
        <span class="club-card-desc">${esc(c.description || "")}</span>
        <span class="club-card-meta">${c.member_count || 1} member${(c.member_count||1) === 1 ? "" : "s"}${c.my_role === "owner" ? " · owner" : ""}</span>
      </button>`;
  }).join("");

  render(`
    <div class="screen-pad">
      <div class="screen-header">
        <h2 class="stamp-title small">MY CLUBS</h2>
        <div class="header-actions">
          <button class="btn-ghost" data-action="join">+ Join with code</button>
          <button class="btn-primary" data-action="create">+ New Club</button>
        </div>
      </div>
      ${clubs.length ? `<div class="club-grid">${cards}</div>` : `
        <div class="empty-state">
          <p>you're not in any clubs yet.</p>
          <p class="faint">create one, or join with a 6-character code.</p>
        </div>`}
    </div>
  `, (root) => {
    root.querySelectorAll("[data-club]").forEach((b) =>
      b.addEventListener("click", () => navigate(`/club/${b.dataset.club}`)));
    root.querySelector("[data-action='create']").addEventListener("click", createClubModal);
    root.querySelector("[data-action='join']").addEventListener("click", joinClubModal);
  });
}

function createClubModal() {
  const accentBtns = ACCENTS.map(([name, color], i) =>
    `<button type="button" class="accent-dot ${i === 0 ? "active" : ""}" data-accent="${name}" style="background:${color}"></button>`).join("");

  openModal(`
    <h3>New Club</h3>
    <form data-form class="modal-body">
      <label class="field"><span class="field-label">club name</span>
        <input name="name" required maxlength="60" placeholder="e.g. The Tuesday Pages" /></label>
      <label class="field"><span class="field-label">description <span class="faint">(optional)</span></span>
        <textarea name="description" maxlength="200" rows="2" placeholder="what's this club about?"></textarea></label>
      <div class="field"><span class="field-label">color</span>
        <div class="accent-row">${accentBtns}</div></div>
      <label class="field check-field">
        <input type="checkbox" name="deadlines" />
        <span>use reading deadlines by default</span></label>
      <label class="field deadline-days" hidden><span class="field-label">default days to finish a book</span>
        <input name="days" type="number" min="1" max="365" value="30" /></label>
      <div class="modal-actions">
        <button type="button" class="btn-ghost" data-close>cancel</button>
        <button type="submit" class="btn-primary">Create</button>
      </div>
    </form>
  `, (modal) => {
    let accent = ACCENTS[0][0];
    modal.querySelectorAll("[data-accent]").forEach((d) => d.addEventListener("click", () => {
      modal.querySelectorAll("[data-accent]").forEach((x) => x.classList.remove("active"));
      d.classList.add("active"); accent = d.dataset.accent;
    }));
    const days = modal.querySelector(".deadline-days");
    modal.querySelector("[name='deadlines']").addEventListener("change", (e) => {
      days.hidden = !e.target.checked;
    });
    modal.querySelector("[data-form]").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      const btn = f.querySelector("[type='submit']"); btn.disabled = true;
      try {
        const club = await api.createClub({
          name: f.name.value.trim(),
          description: f.description.value.trim(),
          accent,
          deadlines_enabled: f.deadlines.checked,
          default_deadline_days: f.deadlines.checked ? Number(f.days.value) : null,
        });
        closeModal();
        toast("Club created", "success");
        navigate(`/club/${club.id}`);
      } catch (err) { toast(err.message, "error"); btn.disabled = false; }
    });
  });
}

function joinClubModal() {
  openModal(`
    <h3>Join a Club</h3>
    <form data-form class="modal-body">
      <label class="field"><span class="field-label">join code</span>
        <input name="code" required maxlength="6" placeholder="ABC123"
          style="text-transform:uppercase;letter-spacing:.2em;font-family:'DM Mono',monospace" /></label>
      <div data-preview class="join-preview" hidden></div>
      <div class="modal-actions">
        <button type="button" class="btn-ghost" data-close>cancel</button>
        <button type="submit" class="btn-primary">Find & Join</button>
      </div>
    </form>
  `, (modal) => {
    modal.querySelector("[data-form]").addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = e.target.code.value.trim().toUpperCase();
      const btn = e.target.querySelector("[type='submit']"); btn.disabled = true;
      try {
        const club = await api.findClubByCode(code);
        if (!club) { toast("No club with that code", "error"); btn.disabled = false; return; }
        await api.joinClub(club.id);
        closeModal();
        toast(`Joined ${club.name}`, "success");
        navigate(`/club/${club.id}`);
      } catch (err) {
        // Already a member?
        if (String(err.message).includes("duplicate")) { closeModal(); navigate(`/clubs`); }
        else { toast(err.message, "error"); btn.disabled = false; }
      }
    });
  });
}

// ---- shared modal helpers (kept here; reused by other views via import) ----
export function openModal(innerHTML, after) {
  closeModal();
  const back = document.createElement("div");
  back.className = "modal-backdrop";
  back.dataset.modal = "true";
  back.innerHTML = `<div class="modal">${innerHTML}</div>`;
  document.body.appendChild(back);
  back.addEventListener("click", (e) => { if (e.target === back) closeModal(); });
  back.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
  if (after) after(back.querySelector(".modal"));
  return back;
}
export function closeModal() {
  document.querySelectorAll("[data-modal='true']").forEach((m) => m.remove());
}
