import { render } from "../router.js";
import { esc, toast, avatarHTML } from "../ui.js";
import { store } from "../store.js";
import * as api from "../api.js";
import { supabase } from "../supabaseClient.js";

export async function renderProfile() {
  const p = store.profile || (await api.getProfile(store.user.id));
  store.profile = p;

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
      </div>
    </div>
  `, (root) => {
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
      if (!file) return;
      try {
        const path = `${store.user.id}/${Date.now()}-${file.name.replace(/[^\w.]/g, "_")}`;
        const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
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
