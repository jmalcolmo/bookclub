// "Following" — the readers you follow, each with what they're reading right
// now: the book and the page they've reached out of how many. Every progress
// row shown here comes back already filtered by RLS (shared clubs + the
// additive follow paths); the client never re-implements gating. Tapping a
// reader opens their profile (where follow/unfollow lives).
import { render, navigate } from "../router.js";
import { esc, avatarHTML, timeAgo } from "../ui.js";
import * as api from "../api.js";

export async function renderPeople() {
  render(`
    <div class="screen-pad people-screen">
      <div class="screen-header"><span></span>
        <h2 class="stamp-title small">FOLLOWING</h2><span></span></div>

      <section class="people-following" data-following>
        <p class="faint">loading…</p>
      </section>
    </div>
  `, (root) => boot(root));
}

async function boot(root) {
  const el = root.querySelector("[data-following]");

  let rows;
  try {
    rows = await api.followingReading();
  } catch (err) {
    el.innerHTML = `<p class="faint">couldn't load your follows: ${esc(err.message)}</p>`;
    return;
  }

  if (!rows.length) {
    el.innerHTML = `
      <div class="empty-state"><p>you're not following anyone yet.</p>
        <p class="faint">open a fellow reader's profile and tap “follow” to see what
          they're reading here.</p></div>`;
    return;
  }

  el.innerHTML = rows.map(rowHTML).join("");
  el.querySelectorAll("[data-user]").forEach((row) => {
    row.addEventListener("click", () => navigate(`/user/${row.dataset.user}`));
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        navigate(`/user/${row.dataset.user}`);
      }
    });
  });
}

// One reader: avatar, name, and their current book + page X / Y. A follow can
// exist without any visible reading (RLS hides what we can't see) — say so
// instead of showing nothing.
function rowHTML({ profile, progress, book }) {
  const name = esc(profile.display_name || "Reader");
  let line;
  if (!book) {
    line = `<span class="faint">no visible reading right now</span>`;
  } else if (progress.status === "finished") {
    line = `finished <span class="people-book">${esc(book.title)}</span>`;
  } else {
    const of = book.page_count ? ` / ${book.page_count}` : "";
    line = `<span class="people-book">${esc(book.title)}</span>
      <span class="people-page">p.${esc(progress.current_page)}${esc(of)}</span>`;
  }
  return `
    <article class="people-row patch" data-user="${esc(profile.id)}" role="button" tabindex="0"
      aria-label="View ${name}'s profile">
      <div class="people-row-head">
        ${avatarHTML(profile, 44)}
        <div class="people-row-meta">
          <span class="people-who">${name}</span>
          <span class="people-what faint">${line}</span>
        </div>
        ${progress ? `<span class="people-when faint">${esc(timeAgo(progress.updated_at))}</span>` : ""}
      </div>
    </article>`;
}
