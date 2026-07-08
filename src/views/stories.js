// Full-screen STORY VIEWER (Instagram/Snap-style). Opened from the stories strip
// at the top of the feed. Given the author-grouped stories from api.activeStories()
// and a starting group index, it plays each author's stories in order with:
//   - a row of top progress bars (one per story in the current author's group),
//   - tap left / right to go back / forward (advancing across authors),
//   - auto-advance on a timer,
//   - a mark-as-seen call (api.markStoryViewed) as each story is shown.
//
// This is an OVERLAY, not a router route: the feed opens it in place and gets a
// callback when it closes so it can repaint the strip (rings update as stories
// are seen). There is NO spoiler gate here and no client-side visibility logic —
// the groups handed in already came back RLS-filtered from api.activeStories().
import { esc, avatarHTML, timeAgo, toast } from "../ui.js";
import * as api from "../api.js";

const STORY_MS = 5000; // auto-advance dwell per story

// Open the viewer over the whole screen.
//   groups     — the author-grouped list from api.activeStories()
//   startIndex — which group (author) to start on
//   onClose    — called when the viewer closes; receives the Set of story ids
//                marked seen during this session so the caller can repaint.
export function openStoryViewer(groups, startIndex = 0, onClose) {
  if (!groups?.length) return;

  let gi = Math.max(0, Math.min(startIndex, groups.length - 1)); // group index
  let si = 0;                                                    // story index in group
  const seenThisSession = new Set();
  let timer = null;

  const back = document.createElement("div");
  back.className = "story-viewer-backdrop";
  back.setAttribute("role", "dialog");
  back.setAttribute("aria-label", "Stories");
  document.body.appendChild(back);
  document.body.classList.add("story-viewer-open");

  function close() {
    clearTimeout(timer);
    document.removeEventListener("keydown", onKey);
    back.remove();
    document.body.classList.remove("story-viewer-open");
    if (onClose) onClose(seenThisSession);
  }

  // The story currently on screen.
  function current() {
    const g = groups[gi];
    return g ? g.stories[si] : null;
  }

  // Advance forward one story, crossing into the next author when needed. Past
  // the last story of the last author, close.
  function next() {
    const g = groups[gi];
    if (si < g.stories.length - 1) { si += 1; render(); return; }
    if (gi < groups.length - 1) { gi += 1; si = 0; render(); return; }
    close();
  }

  // Step back one story, crossing into the previous author's LAST story. At the
  // very first story, just restart it.
  function prev() {
    if (si > 0) { si -= 1; render(); return; }
    if (gi > 0) { gi -= 1; si = groups[gi].stories.length - 1; render(); return; }
    render(); // already at the first story — restart it
  }

  // Mark the on-screen story seen (best-effort; a failed write just leaves the
  // ring unseen, which is harmless). Records locally so the caller can repaint.
  async function markSeen(story) {
    if (!story || seenThisSession.has(story.id) || story.seen) {
      if (story) seenThisSession.add(story.id);
      return;
    }
    seenThisSession.add(story.id);
    story.seen = true;
    try { await api.markStoryViewed(story.id); }
    catch { /* non-fatal: seen ring simply won't persist */ }
  }

  function render() {
    const g = groups[gi];
    const story = current();
    if (!g || !story) { close(); return; }

    clearTimeout(timer);

    // Progress bars: one per story in this author's group. Bars before the
    // current index are full, the current one animates, later ones are empty.
    const bars = g.stories.map((_, i) => {
      const state = i < si ? "done" : i === si ? "active" : "";
      return `<span class="story-bar ${state}"><span class="story-bar-fill"></span></span>`;
    }).join("");

    const name = g.profile?.display_name || "Reader";
    back.innerHTML = `
      <div class="story-stage" data-stage>
        <div class="story-progress">${bars}</div>
        <div class="story-topbar">
          <span class="story-author">
            ${avatarHTML(g.profile, 34)}
            <span class="story-author-name">${esc(name)}</span>
            <span class="story-time">${timeAgo(story.created_at)}</span>
          </span>
          <button class="story-close" data-close aria-label="Close stories">×</button>
        </div>
        <div class="story-content ${story.image_url ? "" : "story-content-textonly"}">
          ${story.image_url
            ? `<img class="story-image" src="${esc(story.image_url)}" alt="Story by ${esc(name)}">`
            : ""}
          ${story.body ? `<p class="story-caption ${story.image_url ? "" : "story-caption-big"}">${esc(story.body)}</p>` : ""}
        </div>
        <button class="story-tap story-tap-prev" data-prev aria-label="Previous"></button>
        <button class="story-tap story-tap-next" data-next aria-label="Next"></button>
      </div>`;

    // Kick the active bar's fill animation for this dwell.
    const activeFill = back.querySelector(".story-bar.active .story-bar-fill");
    if (activeFill) {
      activeFill.style.animation = "none";
      // force reflow so the restart takes
      void activeFill.offsetWidth;
      activeFill.style.animation = `story-fill ${STORY_MS}ms linear forwards`;
    }

    back.querySelector("[data-close]").addEventListener("click", close);
    back.querySelector("[data-next]").addEventListener("click", next);
    back.querySelector("[data-prev]").addEventListener("click", prev);

    markSeen(story);
    timer = setTimeout(next, STORY_MS);
  }

  function onKey(e) {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight") next();
    else if (e.key === "ArrowLeft") prev();
  }
  document.addEventListener("keydown", onKey);

  render();
}

// Compose + post a story (photo and/or caption) from the "Your story" bubble.
// Reuses the shared square cropper and api.uploadStoryImage/addStory. Resolves
// true if a story was posted (so the caller can refresh the strip), false if the
// user cancelled or posted nothing.
export async function composeStory(cropImage) {
  return new Promise((resolve) => {
    let pendingBlob = null;

    const back = document.createElement("div");
    back.className = "story-compose-backdrop";
    back.innerHTML = `
      <div class="story-compose patch">
        <h3 class="story-compose-title stamp-title small">＋ Your story</h3>
        <p class="faint story-compose-blurb">Share a photo or a thought. It disappears in 72 hours.</p>
        <div data-preview class="story-compose-preview" hidden></div>
        <label class="btn-ghost small story-compose-photo">📷 add photo
          <input type="file" accept="image/*" data-photo hidden></label>
        <textarea data-body rows="3" maxlength="280"
          placeholder="say something… (optional if you add a photo)"></textarea>
        <div class="story-compose-actions">
          <button class="btn-ghost small" data-cancel>cancel</button>
          <button class="btn-primary small" data-post>post story</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    document.body.classList.add("story-viewer-open");

    const preview = back.querySelector("[data-preview]");
    const fileInput = back.querySelector("[data-photo]");
    const bodyEl = back.querySelector("[data-body]");
    const postBtn = back.querySelector("[data-post]");

    const done = (posted) => {
      back.remove();
      document.body.classList.remove("story-viewer-open");
      resolve(posted);
    };

    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        const blob = await cropImage(file, { shape: "square" });
        if (!blob) return;
        pendingBlob = blob;
        preview.style.backgroundImage = `url('${URL.createObjectURL(blob)}')`;
        preview.hidden = false;
      } catch (err) { toast(err.message, "error"); }
    });

    back.querySelector("[data-cancel]").addEventListener("click", () => done(false));
    back.addEventListener("click", (e) => { if (e.target === back) done(false); });

    postBtn.addEventListener("click", async () => {
      const body = bodyEl.value.trim();
      if (!body && !pendingBlob) { toast("Add a photo or some text", "error"); return; }
      postBtn.disabled = true;
      try {
        let imageUrl = null;
        if (pendingBlob) imageUrl = await api.uploadStoryImage(pendingBlob);
        await api.addStory({ body, imageUrl });
        toast("Story posted", "success");
        done(true);
      } catch (err) { toast(err.message, "error"); postBtn.disabled = false; }
    });
  });
}
