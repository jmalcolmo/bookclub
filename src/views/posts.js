// Club posts (views/posts.js): a lightweight Twitter/X-style feed of short text
// updates and single-photo posts, scoped to one club. These are NOT reviews and
// carry NO page number, so there is NO spoiler gate - but they ARE club-member-
// scoped: RLS only ever returns/accepts posts for members of the club, so the
// view relies entirely on the server for access control (never re-implements it).
import { render, navigate, onCleanup } from "../router.js";
import { esc, toast, avatarHTML, clubAvatarHTML, timeAgo, userLinkHTML, wireUserLinks } from "../ui.js";
import { store } from "../store.js";
import * as api from "../api.js";
import { cropImage } from "../imageCropper.js";
import { confirmDialog } from "./clubs.js";

export async function renderPosts({ params }) {
  const clubId = params.id;
  render(`<div class="screen-pad"><p class="faint">loading posts…</p></div>`);

  // Membership is enforced by RLS; getClub() throws for non-members, so a
  // non-member hitting this route lands on the router's error page rather than
  // seeing any club content.
  const [club, membership] = await Promise.all([
    api.getClub(clubId),
    api.myMembership(clubId),
  ]);

  // A photo chosen but not yet uploaded (held until the post is submitted).
  let pendingImageBlob = null;

  render(`
    <div class="screen-pad posts-screen" style="--accent:var(--${club.accent || "yarn-sage"})">
      <div class="screen-header">
        <button class="btn-back" data-nav="club">← ${esc(club.name)}</button>
        <h2 class="stamp-title small">posts</h2>
        <span></span>
      </div>

      <p class="posts-blurb faint">Share a quick thought or a photo with the club.
        No page numbers, no spoilers gate - everyone in ${esc(club.name)} sees these.</p>

      ${membership ? `
      <div class="post-compose patch">
        <form data-post class="post-form">
          <textarea name="body" rows="3" maxlength="800"
            placeholder="what's on your mind? (a book haul, a meetup pic, a hot take…)"></textarea>
          <div class="post-photo-row">
            <div data-photo-preview class="post-photo-preview" hidden></div>
            <label class="btn-ghost small post-photo-btn">📷 add photo
              <input type="file" accept="image/*" data-photo hidden></label>
            <button type="button" class="btn-ghost small post-photo-clear" data-photo-clear hidden>remove photo</button>
            <button type="submit" class="btn-primary small post-submit">post</button>
          </div>
        </form>
      </div>` : `<p class="faint locked-note">Join this club to post.</p>`}

      <div class="posts-stream" data-posts><p class="faint">loading…</p></div>
    </div>
  `, (root) => {
    root.querySelector("[data-nav='club']").addEventListener("click", () => navigate(`/club/${clubId}`));

    const form = root.querySelector("[data-post]");
    if (form) {
      const preview = root.querySelector("[data-photo-preview]");
      const clearBtn = root.querySelector("[data-photo-clear]");
      const fileInput = root.querySelector("[data-photo]");

      const clearPhoto = () => {
        pendingImageBlob = null;
        preview.hidden = true;
        preview.style.backgroundImage = "";
        clearBtn.hidden = true;
        fileInput.value = "";
      };

      fileInput.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        e.target.value = ""; // allow re-picking the same file later
        if (!file) return;
        try {
          // Reuse the shared cropper (bakes an image/jpeg blob) - 'square' keeps
          // post photos consistent and small, matching the storage size cap.
          const blob = await cropImage(file, { shape: "square" });
          if (!blob) return; // cancelled
          pendingImageBlob = blob;
          preview.style.backgroundImage = `url('${URL.createObjectURL(blob)}')`;
          preview.hidden = false;
          clearBtn.hidden = false;
        } catch (err) { toast(err.message, "error"); }
      });

      clearBtn.addEventListener("click", clearPhoto);

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const body = e.target.body.value.trim();
        if (!body && !pendingImageBlob) {
          toast("Add some text or a photo", "error");
          return;
        }
        const submitBtn = form.querySelector(".post-submit");
        submitBtn.disabled = true;
        try {
          let imageUrl = null;
          if (pendingImageBlob) imageUrl = await api.uploadPostImage(clubId, pendingImageBlob);
          await api.addPost(clubId, { body, imageUrl });
          e.target.body.value = "";
          clearPhoto();
          toast("Posted", "success");
          loadPosts(root, clubId);
        } catch (err) { toast(err.message, "error"); }
        finally { submitBtn.disabled = false; }
      });
    }

    loadPosts(root, clubId);

    // Live updates: club_posts is club-scoped, so filter the subscription to this
    // club. Router tears the subscription down before the next (re)render.
    const sub = api.subscribe(
      `club-posts-${clubId}`, "club_posts", `club_id=eq.${clubId}`,
      () => loadPosts(root, clubId));
    onCleanup(sub);
  });
}

async function loadPosts(root, clubId) {
  const host = root.querySelector("[data-posts]");
  if (!host) return;
  const posts = await api.clubPosts(clubId);
  const myId = store.user.id;

  host.innerHTML = posts.length
    ? posts.map((p) => postCardHTML(p, myId)).join("")
    : `<p class="faint">no posts yet - be the first to share something.</p>`;

  wireUserLinks(host);

  // Delete my own post (RLS posts_delete_own restricts this to the author).
  host.querySelectorAll("[data-del-post]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!(await confirmDialog("This permanently deletes your post. This cannot be undone.", {
        title: "Delete post", confirmLabel: "Delete", danger: true,
      }))) return;
      try { await api.deletePost(b.dataset.delPost); loadPosts(root, clubId); }
      catch (err) { toast(err.message, "error"); }
    }));

  // Edit my own post's text: ✎ swaps the body for an inline form; save patches
  // body (author-only per RLS), cancel restores.
  host.querySelectorAll("[data-edit-post]").forEach((b) => {
    const id = b.dataset.editPost;
    const card = b.closest(".post-card");
    const body = card.querySelector(`[data-post-body="${id}"]`);
    const editForm = card.querySelector(`[data-post-edit-form="${id}"]`);
    b.addEventListener("click", () => { if (body) body.hidden = true; editForm.hidden = false; editForm.body.focus(); });
    editForm.querySelector("[data-cancel-edit]").addEventListener("click", () => {
      editForm.hidden = true; if (body) body.hidden = false;
    });
    editForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = editForm.body.value.trim();
      if (!text) { toast("Post text can't be empty", "error"); return; }
      try {
        await api.updatePost(id, { body: text });
        toast("Post updated", "success");
        loadPosts(root, clubId);
      } catch (err) { toast(err.message, "error"); }
    });
  });
}

function postCardHTML(p, myId) {
  const mine = p.user_id === myId;
  return `
    <div class="feed-item post-card" data-id="${p.id}">
      <div class="post-head">
        ${userLinkHTML(p.user_id, `${avatarHTML(p.profile, 30)}
          <span class="post-name">${esc(p.profile?.display_name || "Reader")}</span>`,
          p.profile?.display_name)}
        <span class="post-time faint">${timeAgo(p.created_at)}</span>
        ${mine ? `<span class="post-controls" role="group" aria-label="Post actions">
          ${p.body ? `<button class="post-edit" data-edit-post="${p.id}" title="Edit post" aria-label="Edit post">✎</button>` : ""}
          <button class="post-del" data-del-post="${p.id}" title="Delete post" aria-label="Delete post">×</button>
        </span>` : ""}
      </div>
      ${p.body ? `<p class="post-body" data-post-body="${p.id}">${esc(p.body)}</p>` : ""}
      ${p.image_url ? `<img class="post-image" src="${esc(p.image_url)}" alt="Post photo by ${esc(p.profile?.display_name || "Reader")}" loading="lazy">` : ""}
      ${mine && p.body ? `<form class="post-edit-form" data-post-edit-form="${p.id}" hidden>
        <textarea name="body" rows="3" maxlength="800" required>${esc(p.body)}</textarea>
        <div class="edit-actions">
          <button type="submit" class="btn-primary small">save</button>
          <button type="button" class="btn-ghost small" data-cancel-edit>cancel</button>
        </div>
      </form>` : ""}
    </div>`;
}

// The "+" compose hub's "Create post" action: the same text + single-photo
// composer as renderPosts (no page numbers, no spoiler gate) but with a CLUB
// MULTI-SELECT. On submit it uploads the photo ONCE (if any) and fans the post
// out to every selected club via api.addPostToClubs (one club_posts row per
// club; RLS still authorizes each insert). This is an OVERLAY, not a route, so
// it uses the post-compose backdrop styling. Resolves true if a post went
// out (so the feed can refresh), false if the user cancelled or posted nothing.
//
// `clubs` is the caller's already-loaded club list (api.myClubs()); passing it in
// avoids a second round-trip. A member of zero clubs sees a gentle empty state.
export async function composePostToClubs(clubs = []) {
  return new Promise((resolve) => {
    let pendingBlob = null;
    const selected = new Set(clubs.length === 1 ? [clubs[0].id] : []);

    const back = document.createElement("div");
    back.className = "post-compose-backdrop";
    const clubChips = clubs.map((c) => `
      <button type="button" class="post-club-chip ${selected.has(c.id) ? "selected" : ""}"
        data-club="${esc(c.id)}" aria-pressed="${selected.has(c.id)}">
        ${clubAvatarHTML(c, 24)}<span class="post-club-chip-name">${esc(c.name)}</span>
      </button>`).join("");

    back.innerHTML = `
      <div class="post-compose patch">
        <h3 class="post-compose-title stamp-title small">✎ New post</h3>
        <p class="faint post-compose-blurb">Share a thought or a photo. Pick which clubs see it.</p>
        ${clubs.length
          ? `<div class="post-club-select" data-clubs>${clubChips}</div>`
          : `<p class="faint">Join or create a club first - posts go to a club.</p>`}
        <div data-preview class="post-compose-preview" hidden></div>
        <label class="btn-ghost small post-compose-photo">📷 add photo
          <input type="file" accept="image/*" data-photo hidden></label>
        <textarea data-body rows="3" maxlength="800"
          placeholder="what's on your mind? (a book haul, a meetup pic, a hot take…)"></textarea>
        <div class="post-compose-actions">
          <button class="btn-ghost small" data-cancel>cancel</button>
          <button class="btn-primary small" data-post>post</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    document.body.classList.add("post-compose-open");

    const preview = back.querySelector("[data-preview]");
    const fileInput = back.querySelector("[data-photo]");
    const bodyEl = back.querySelector("[data-body]");
    const postBtn = back.querySelector("[data-post]");

    const done = (posted) => {
      back.remove();
      document.body.classList.remove("post-compose-open");
      resolve(posted);
    };

    back.querySelectorAll("[data-club]").forEach((chip) =>
      chip.addEventListener("click", () => {
        const id = chip.dataset.club;
        if (selected.has(id)) selected.delete(id); else selected.add(id);
        chip.classList.toggle("selected", selected.has(id));
        chip.setAttribute("aria-pressed", selected.has(id));
      }));

    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        // Reuse the shared square cropper, matching renderPosts' post photos.
        const blob = await cropImage(file, { shape: "square" });
        if (!blob) return; // cancelled
        pendingBlob = blob;
        preview.style.backgroundImage = `url('${URL.createObjectURL(blob)}')`;
        preview.hidden = false;
      } catch (err) { toast(err.message, "error"); }
    });

    back.querySelector("[data-cancel]").addEventListener("click", () => done(false));
    back.addEventListener("click", (e) => { if (e.target === back) done(false); });

    postBtn.addEventListener("click", async () => {
      const body = bodyEl.value.trim();
      const clubIds = [...selected];
      if (!clubIds.length) { toast("Pick at least one club", "error"); return; }
      if (!body && !pendingBlob) { toast("Add some text or a photo", "error"); return; }
      postBtn.disabled = true;
      try {
        // Upload the photo once, then reuse its public URL across every club.
        let imageUrl = null;
        if (pendingBlob) imageUrl = await api.uploadPostImage(clubIds[0], pendingBlob);
        await api.addPostToClubs(clubIds, { body, imageUrl });
        toast(clubIds.length > 1 ? `Posted to ${clubIds.length} clubs` : "Posted", "success");
        done(true);
      } catch (err) { toast(err.message, "error"); postBtn.disabled = false; }
    });
  });
}
