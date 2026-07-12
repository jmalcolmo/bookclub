import { render, navigate } from "../router.js";
import { esc, toast, avatarHTML, fmtDate, timeAgo } from "../ui.js";
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

  const historyRows = history.map(shelfRowHTML);

  render(`
    <div class="screen-pad profile-screen">
      <div class="screen-header"><span></span>
        <h2 class="stamp-title small">MY PROFILE</h2><span></span></div>

      <div class="profile-card patch" data-profile-card></div>

      <section class="profile-activity">
        <h3 class="stamp-title small">ACTIVITY</h3>
        <div class="patch section-box" data-activity><p class="faint">loading…</p></div>
      </section>

      <section class="profile-history">
        <h3 class="stamp-title small">MY SHELF - BOOKS I'VE READ</h3>
        ${history.length ? `<div class="patch section-box" data-shelf></div>` : `
          <div class="empty-state"><p>no finished books yet.</p>
            <p class="faint">books you mark finished - in any club - land on your shelf.</p></div>`}
      </section>
    </div>
  `, (root) => {
    loadActivity(root); // async - don't block the profile paint
    const shelf = root.querySelector("[data-shelf]");
    if (shelf) paintCollapsible(shelf, historyRows, "books", (box) => {
      // Tapping a shelf book opens MY personal involvement view for it (my own
      // reactions/replies/progress), not the whole club feed - keyed by my id.
      box.querySelectorAll("[data-book]").forEach((b) =>
        b.addEventListener("click", () => navigate(`/reader/${store.user.id}/book/${b.dataset.book}`)));
    });
    paintProfileCard(root.querySelector("[data-profile-card]"));
  });
}

// One shelf row (a finished book from readingHistoryFor / myReadingHistory).
// Shared by my own shelf and the shelf on another reader's profile - tapping a
// row opens the owner's PERSONAL involvement view (wired by the caller).
function shelfRowHTML(b) {
  return `
    <button class="history-row" data-book="${b.id}">
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
    </button>`;
}

// A boxed, collapsed list: at most three rows show, with a toggle that expands
// the rest in place (and collapses back). `wire` re-attaches row handlers after
// every (re)paint. Used by both Activity and the Shelf so the profile never
// turns into one giant scroll.
function paintCollapsible(host, rows, label, wire) {
  let expanded = false;
  const paint = () => {
    const shown = expanded ? rows : rows.slice(0, 3);
    host.innerHTML = `
      <div class="section-rows">${shown.join("")}</div>
      ${rows.length > 3 ? `
        <button type="button" class="btn-ghost small section-toggle" aria-expanded="${expanded}">
          ${expanded ? "show less" : `show all ${rows.length} ${label} ↓`}
        </button>` : ""}`;
    host.querySelector(".section-toggle")?.addEventListener("click", () => {
      expanded = !expanded;
      paint();
    });
    wire(host);
  };
  paint();
}

// The profile card has two modes: a clean read-only VIEW (default) and the
// EDIT form (change photo / name / bio), reached via the "Edit profile" button.
function paintProfileCard(host, editing = false) {
  const p = store.profile || {};
  if (!editing) {
    host.innerHTML = `
      <div class="profile-avatar-wrap">${avatarHTML(p, 96)}</div>
      <h3 class="stamp-title small profile-name">${esc(p.display_name || "Reader")}</h3>
      ${p.bio ? `<p class="profile-bio">${esc(p.bio)}</p>` : `<p class="faint">no bio yet.</p>`}
      <p class="faint signed-as">signed in as ${esc(store.user.email || "")}</p>
      <div class="profile-actions">
        <button type="button" class="btn-primary" data-edit>✎ Edit profile</button>
        <button type="button" class="btn-ghost" data-signout>sign out</button>
      </div>`;
    host.querySelector("[data-edit]").addEventListener("click", () => paintProfileCard(host, true));
    host.querySelector("[data-signout]").addEventListener("click", signOut);
    return;
  }

  host.innerHTML = `
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
      <div class="profile-actions">
        <button type="submit" class="btn-primary">Save profile</button>
        <button type="button" class="btn-ghost" data-cancel>cancel</button>
      </div>
    </form>`;

  host.querySelector("[data-cancel]").addEventListener("click", () => paintProfileCard(host));
  host.querySelector("[data-form]").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const updated = await api.updateProfile(store.user.id, {
        display_name: e.target.display_name.value.trim(),
        bio: e.target.bio.value.trim(),
      });
      store.profile = updated;
      toast("Profile saved", "success");
      document.dispatchEvent(new CustomEvent("profile-updated"));
      paintProfileCard(host); // back to the clean view
    } catch (err) { toast(err.message, "error"); }
  });

  host.querySelector("[data-avatar]").addEventListener("change", async (e) => {
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
      paintProfileCard(host, true); // stay in edit mode with the new photo
    } catch (err) { toast(err.message, "error"); }
  });
}

// The activity feed: who liked / emoji-reacted / commented on my stuff.
// Clicking a row jumps to the book page where it happened; the reaction id (if
// any) is stashed in sessionStorage so the book view can scroll to + flash it.
async function loadActivity(root) {
  const host = root.querySelector("[data-activity]");
  if (!host) return;

  let items = [];
  try { items = await api.myActivity(); }
  catch (err) {
    host.innerHTML = `<p class="faint">couldn't load activity: ${esc(err.message)}</p>`;
    return;
  }

  if (!items.length) {
    host.innerHTML = `
      <div class="empty-state"><p>no activity yet.</p>
        <p class="faint">when someone likes or comments on your reactions, it shows up here.</p></div>`;
    return;
  }

  paintCollapsible(host, items.map(activityRowHTML), "activity", (box) => {
    box.querySelectorAll("[data-go]").forEach((row) =>
      row.addEventListener("click", () => {
        if (row.dataset.hl) sessionStorage.setItem("rr-highlight", row.dataset.hl);
        navigate(row.dataset.go);
      }));
  });
}

function activityRowHTML(item) {
  const who = esc(item.actor?.display_name || "Someone");
  const verb = item.kind === "reply" ? `commented on your ${esc(item.what)}`
    : item.kind === "emoji" ? `reacted ${esc(item.emoji)} to your ${esc(item.what)}`
    : `liked your ${esc(item.what)}`;
  const icon = item.kind === "reply" ? "💬" : item.kind === "emoji" ? item.emoji : "👍";
  const snippet = item.kind === "reply"
    ? `<p class="activity-snippet faint">“${esc(item.body)}”</p>`
    : item.snippet
      ? `<p class="activity-snippet faint">“${esc(truncate(item.snippet, 90))}”</p>`
      : "";
  return `
    <button type="button" class="activity-row" data-go="${esc(item.go)}"
      ${item.highlight ? `data-hl="${esc(item.highlight)}"` : ""}>
      ${avatarHTML(item.actor, 32)}
      <div class="activity-main">
        <p class="activity-text"><strong>${who}</strong> ${verb}
          · <span class="activity-book">${esc(item.book.title)}</span></p>
        ${snippet}
        <span class="activity-time faint">${esc(timeAgo(item.at))}</span>
      </div>
      <span class="activity-icon" aria-hidden="true">${icon}</span>
    </button>`;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
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

  // Their shelf: only the rows RLS lets ME see (their finished progress in
  // clubs we share, or via the follow path). An empty result just hides the
  // section - no client-side gating is ever added here. (Named shelfBooks, not
  // `history`, so window.history.back() below isn't shadowed.)
  let shelfBooks = [];
  try { shelfBooks = await api.readingHistoryFor(userId); } catch { /* hide shelf */ }

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
      root.querySelector("[data-back]").addEventListener("click", () => window.history.back());
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
        <p class="faint follow-hint">following surfaces their solo reading on your feed.</p>
      </div>

      ${shelfBooks.length ? `
        <section class="profile-history">
          <h3 class="stamp-title small">THEIR SHELF - BOOKS THEY'VE READ</h3>
          <div class="patch section-box" data-shelf></div>
        </section>` : ""}
    </div>
  `, (root) => {
    root.querySelector("[data-back]").addEventListener("click", () => window.history.back());
    const shelf = root.querySelector("[data-shelf]");
    if (shelf) paintCollapsible(shelf, shelfBooks.map(shelfRowHTML), "books", (box) => {
      // Tapping a shelf book opens THEIR personal involvement view for it (their
      // own reactions/replies/progress) - keyed by this reader's id. What shows
      // inside is still spoiler-gated to ME by RLS.
      box.querySelectorAll("[data-book]").forEach((b) =>
        b.addEventListener("click", () => navigate(`/reader/${userId}/book/${b.dataset.book}`)));
    });
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
