import { render, navigate } from "../router.js";
import { esc, toast, avatarHTML, fmtDate } from "../ui.js";
import { store } from "../store.js";
import * as api from "../api.js";
import { supabase } from "../supabaseClient.js";
import { signOut } from "../auth.js";
import { cropImage } from "../imageCropper.js";

export async function renderProfile({ params } = {}) {
  // A profile can be MINE (the editable self view) or SOMEONE ELSE'S (read-only,
  // with a follow/unfollow control). params.id present -> another reader.
  const viewingId = params?.id;
  if (viewingId && viewingId !== store.user.id) {
    return renderOtherProfile(viewingId);
  }

  const p = store.profile || (await api.getProfile(store.user.id));
  store.profile = p;

  let history = [];
  try { history = await api.myReadingHistory(); } catch { /* show empty shelf */ }

  const historyRows = history.map((b) => `
    <button class="history-row patch" data-book="${b.id}" data-club="${b.club_id}">
      ${b.cover_url ? `<img class="book-cover sm" src="${esc(b.cover_url)}" alt="${esc(b.title)} cover">`
                    : `<div class="book-cover sm book-cover-blank" role="img" aria-label="${esc(b.title)} cover">📖</div>`}
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

// Another reader's profile: read-only, with a follow/unfollow control. The
// follow graph lives OUTSIDE clubs; following them surfaces their solo reading
// in your "people you follow" feed. RLS returns their profile only if you share
// a club OR already follow them, so a brittle load is expected for strangers.
async function renderOtherProfile(userId) {
  let p = null;
  try { p = await api.getProfile(userId); } catch { /* not visible under RLS */ }
  let followed = false;
  try { followed = await api.isFollowing(userId); } catch { /* default false */ }

  if (!p) {
    render(`
      <div class="screen-pad profile-screen">
        <div class="screen-header">
          <button class="btn-back" data-back>← back</button>
          <h2 class="stamp-title small">READER</h2><span></span></div>
        <div class="empty-state"><p>this reader isn't visible to you.</p>
          <p class="faint">you can see a reader once you share a club or follow them.</p></div>
      </div>
    `, (root) => {
      root.querySelector("[data-back]").addEventListener("click", () => history.back());
    });
    return;
  }

  render(`
    <div class="screen-pad profile-screen">
      <div class="screen-header">
        <button class="btn-back" data-back>← back</button>
        <h2 class="stamp-title small">READER</h2><span></span></div>

      <div class="profile-card patch">
        <div class="profile-avatar-wrap">${avatarHTML(p, 96)}</div>
        <h3 class="stamp-title small other-name">${esc(p.display_name || "Reader")}</h3>
        ${p.bio ? `<p class="other-bio">${esc(p.bio)}</p>` : `<p class="faint">no bio yet.</p>`}
        <button type="button" class="${followed ? "btn-ghost" : "btn-primary"}" data-follow>
          ${followed ? "Following ✓" : "Follow"}
        </button>
        <p class="faint follow-hint">following surfaces their solo reading on your
          “following” feed.</p>
      </div>
    </div>
  `, (root) => {
    root.querySelector("[data-back]").addEventListener("click", () => history.back());
    const btn = root.querySelector("[data-follow]");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        if (followed) { await api.unfollow(userId); followed = false; toast("Unfollowed", "success"); }
        else { await api.follow(userId); followed = true; toast("Following", "success"); }
        btn.className = followed ? "btn-ghost" : "btn-primary";
        btn.textContent = followed ? "Following ✓" : "Follow";
      } catch (err) { toast(err.message, "error"); }
      finally { btn.disabled = false; }
    });
  });
}
