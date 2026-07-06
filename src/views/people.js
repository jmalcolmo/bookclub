// "People you follow" — the follow feed. A social screen OUTSIDE of clubs: the
// readers you follow and their SOLO reading (reactions + progress on books in
// clubs you're not part of). Every row shown here comes back already filtered by
// RLS's additive follow paths; the client never re-implements gating.
import { render, navigate } from "../router.js";
import { esc, avatarHTML, timeAgo, toast } from "../ui.js";
import * as api from "../api.js";

export async function renderPeople() {
  render(`
    <div class="screen-pad people-screen">
      <div class="screen-header"><span></span>
        <h2 class="stamp-title small">PEOPLE YOU FOLLOW</h2><span></span></div>

      <section class="people-following" data-following>
        <p class="faint">loading…</p>
      </section>

      <section class="people-feed">
        <h3 class="stamp-title small">THEIR SOLO READING</h3>
        <div class="people-stream" data-stream><p class="faint">loading…</p></div>
      </section>
    </div>
  `, (root) => boot(root));
}

async function boot(root) {
  const followingEl = root.querySelector("[data-following]");
  const streamEl = root.querySelector("[data-stream]");

  let feed;
  try {
    feed = await api.followFeed();
  } catch (err) {
    followingEl.innerHTML = "";
    streamEl.innerHTML = `<p class="faint">couldn't load your follows: ${esc(err.message)}</p>`;
    return;
  }

  paintFollowing(followingEl, feed.followees, streamEl);
  paintStream(streamEl, feed.items);
}

function paintFollowing(el, followees, streamEl) {
  if (!followees.length) {
    el.innerHTML = `
      <div class="empty-state"><p>you're not following anyone yet.</p>
        <p class="faint">open a fellow reader's profile and tap “follow” to see their
          solo reading here.</p></div>`;
    return;
  }
  el.innerHTML = `
    <h3 class="stamp-title small">FOLLOWING (${followees.length})</h3>
    <div class="people-chips">
      ${followees.map((p) => `
        <div class="people-chip patch" data-user="${esc(p.id)}" role="button" tabindex="0" aria-label="View ${esc(p.display_name || "Reader")}'s profile">
          ${avatarHTML(p, 40)}
          <span class="people-chip-name">${esc(p.display_name || "Reader")}</span>
          <button type="button" class="btn-ghost small" data-unfollow="${esc(p.id)}" aria-label="Unfollow ${esc(p.display_name || "Reader")}">unfollow</button>
        </div>`).join("")}
    </div>`;

  el.querySelectorAll("[data-user]").forEach((chip) => {
    chip.addEventListener("click", (e) => {
      // Don't navigate when the unfollow button inside the chip was clicked.
      if (e.target.closest("[data-unfollow]")) return;
      navigate(`/user/${chip.dataset.user}`);
    });
    chip.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        navigate(`/user/${chip.dataset.user}`);
      }
    });
  });

  el.querySelectorAll("[data-unfollow]").forEach((b) =>
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = b.dataset.unfollow;
      b.disabled = true;
      try {
        await api.unfollow(id);
        toast("Unfollowed", "success");
        // Repaint from a fresh snapshot so the feed drops their rows too.
        const feed = await api.followFeed();
        paintFollowing(el, feed.followees, streamEl);
        paintStream(streamEl, feed.items);
      } catch (err) { toast(err.message, "error"); b.disabled = false; }
    }));
}

function paintStream(el, items) {
  if (!items.length) {
    el.innerHTML = `
      <div class="empty-state"><p>nothing to show yet.</p>
        <p class="faint">as the people you follow read on their own, their reactions and
          progress land here.</p></div>`;
    return;
  }
  el.innerHTML = items.map(rowHTML).join("");
  el.querySelectorAll("[data-user]").forEach((head) => {
    head.addEventListener("click", () => navigate(`/user/${head.dataset.user}`));
    head.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        navigate(`/user/${head.dataset.user}`);
      }
    });
  });
}

function rowHTML(i) {
  const who = esc(i.profile?.display_name || "Reader");
  const book = i.book
    ? `<span class="people-book">${esc(i.book.title)}</span>`
    : `<span class="faint">a book</span>`;
  const line = i.kind === "reaction"
    ? `reacted on p.${esc(i.page)} of ${book}`
    : i.status === "finished"
      ? `finished ${book}`
      : `reached p.${esc(i.page)} of ${book}`;
  const body = i.kind === "reaction" && i.body
    ? `<p class="people-body">${esc(i.body)}</p>` : "";
  return `
    <article class="people-row patch">
      <div class="people-row-head"${i.profile ? ` data-user="${esc(i.profile.id)}" role="button" tabindex="0" aria-label="View ${esc(i.profile.display_name || "Reader")}'s profile"` : ""}>
        ${avatarHTML(i.profile, 36)}
        <div class="people-row-meta">
          <span class="people-who">${who}</span>
          <span class="people-what faint">${line}</span>
        </div>
        <span class="people-when faint">${esc(timeAgo(i.at))}</span>
      </div>
      ${body}
    </article>`;
}
