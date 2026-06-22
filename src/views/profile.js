import { render, navigate } from "../router.js";
import { esc, toast, avatarHTML, fmtDate } from "../ui.js";
import { store } from "../store.js";
import * as api from "../api.js";
import { supabase } from "../supabaseClient.js";
import { signOut } from "../auth.js";
import { cropImage } from "../imageCropper.js";

export async function renderProfile() {
  const p = store.profile || (await api.getProfile(store.user.id));
  store.profile = p;

  let history = [];
  try { history = await api.myReadingHistory(); } catch { /* show empty shelf */ }

  const historyRows = history.map((b) => `
    <button class="history-row patch" data-book="${b.id}" data-club="${b.club_id}">
      ${b.cover_url ? `<img class="book-cover sm" src="${esc(b.cover_url)}" alt="">`
                    : `<div class="book-cover sm book-cover-blank">📖</div>`}
      <div class="history-info">
        <strong class="book-title">${esc(b.title)}</strong>
        <span class="book-author faint">${esc(b.author || "")}</span>
        <span class="history-meta faint">finished ${fmtDate(b.my_finished_at)}</span>
      </div>
      <div class="history-rating">
        ${b.my_rating
          ? `<span class="rating-num">${b.my_rating}</span><span class="rating-stars">★</span>`
          : `<span class="faint">not rated</span>`}
      </div>
    </button>`).join("");

  render(`
    <div class="screen-pad profile-screen">
      <div class="screen-header"><span></span>
        <h2 class="stamp-title small">MY PROFILE</h2><span></span></div>

      <div class="profile-card patch">
        <div class="profile-avatar-wrap">
          ${avatarHTML(p, 96)}
          <label class="avatar-upload btn-ghost small">
            change photo<input type="file" accept="image/*" data-avatar hidden></label>
        </div>
        <form data-form class="profile-form">
          <label class="field"><span class="field-label">display name</span>
            <input name="display_name" value="${esc(p.display_name || "")}" maxlength="40" required></label>
          <label class="field"><span class="field-label">bio <span class="faint">(optional)</span></span>
            <textarea name="bio" rows="3" maxlength="300" placeholder="what do you like to read?">${esc(p.bio || "")}</textarea></label>
          <button type="submit" class="btn-primary">Save profile</button>
        </form>
        <p class="faint signed-as">signed in as ${esc(store.user.email || "")}</p>
        <button type="button" class="btn-ghost signout-mobile" data-signout>sign out</button>
      </div>

      <section class="profile-history">
        <h3 class="stamp-title small">MY SHELF — BOOKS I'VE READ</h3>
        ${history.length ? `<div class="history-list">${historyRows}</div>` : `
          <div class="empty-state"><p>no finished books yet.</p>
            <p class="faint">books you mark finished — in any club — land on your shelf.</p></div>`}
      </section>
    </div>
  `, (root) => {
    root.querySelector("[data-signout]").addEventListener("click", signOut);
    root.querySelectorAll("[data-book]").forEach((b) =>
      b.addEventListener("click", () => navigate(`/club/${b.dataset.club}/book/${b.dataset.book}`)));
    root.querySelector("[data-form]").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const updated = await api.updateProfile(store.user.id, {
          display_name: e.target.display_name.value.trim(),
          bio: e.target.bio.value.trim(),
        });
        store.profile = updated;
        toast("Profile saved", "success");
        document.dispatchEvent(new CustomEvent("profile-updated"));
      } catch (err) { toast(err.message, "error"); }
    });

    root.querySelector("[data-avatar]").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      e.target.value = ""; // allow re-picking the same file later
      if (!file) return;
      try {
        const blob = await cropImage(file, { shape: "circle" });
        if (!blob) return; // cancelled
        const path = `${store.user.id}/${Date.now()}.jpg`;
        const { error } = await supabase.storage.from("avatars").upload(path, blob, { upsert: true, contentType: "image/jpeg" });
        if (error) throw error;
        const { data } = supabase.storage.from("avatars").getPublicUrl(path);
        const updated = await api.updateProfile(store.user.id, { avatar_url: data.publicUrl });
        store.profile = updated;
        toast("Photo updated", "success");
        document.dispatchEvent(new CustomEvent("profile-updated"));
        renderProfile();
      } catch (err) { toast(err.message, "error"); }
    });
  });
}
