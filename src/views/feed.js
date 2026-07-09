// The app's home screen: a social-media style activity FEED across every club you
// belong to, flanked by two rails — clubs (left) and your reading (right).
//
// Like book.js, the feed is derived ENTIRELY client-side from existing api.js
// data (reactions are already spoiler-filtered by RLS server-side; we never
// re-implement gating here). No notifications table, no new DB access.
import { render, navigate, onCleanup } from "../router.js";
import { esc, avatarHTML, clubAvatarHTML, timeAgo, daysUntil, toast, userLinkHTML, wireUserLinks } from "../ui.js";
import { store } from "../store.js";
import * as api from "../api.js";
import { createClubModal, joinClubModal, openModal, closeModal } from "./clubs.js";
import { engagementBarHTML, replyThreadHTML, wireEngagementUI, makeNameResolver } from "../engage.js";
import { openStoryViewer, composeStory } from "./stories.js";
import { composePostToClubs } from "./posts.js";
import { addBookModal } from "./club.js";
import { cropImage } from "../imageCropper.js";

const ACCENTS = {
  "yarn-sage": "#7a9068", "yarn-rust": "#a05838", "yarn-slate": "#587888",
  "yarn-mauve": "#886878", "yarn-ochre": "#b8a058", "yarn-moss": "#607050",
  "yarn-clay": "#987860", "yarn-bark": "#483828",
};
const accentColor = (a) => ACCENTS[a] || ACCENTS["yarn-sage"];

// Rotating literary quotes for the feed header.
const QUOTES = [
  { text: "A reader lives a thousand lives before he dies. The man who never reads lives only one.", author: "George R.R. Martin", work: "A Dance with Dragons", year: 2011 },
  { text: "Not all those who wander are lost.", author: "J.R.R. Tolkien", work: "The Fellowship of the Ring", year: 1954 },
  { text: "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.", author: "Jane Austen", work: "Pride and Prejudice", year: 1813 },
  { text: "All happy families are alike; each unhappy family is unhappy in its own way.", author: "Leo Tolstoy", work: "Anna Karenina", year: 1878 },
  { text: "It was the best of times, it was the worst of times.", author: "Charles Dickens", work: "A Tale of Two Cities", year: 1859 },
  { text: "The most courageous act is still to think for yourself. Aloud.", author: "Coco Chanel", work: "The Gospel According to Coco Chanel", year: 2009 },
  { text: "We accept the love we think we deserve.", author: "Stephen Chbosky", work: "The Perks of Being a Wallflower", year: 1999 },
  { text: "So it goes.", author: "Kurt Vonnegut", work: "Slaughterhouse-Five", year: 1969 },
  { text: "The answer to the ultimate question of life, the universe, and everything is 42.", author: "Douglas Adams", work: "The Hitchhiker's Guide to the Galaxy", year: 1979 },
  { text: "Why, sometimes I've believed as many as six impossible things before breakfast.", author: "Lewis Carroll", work: "Through the Looking-Glass", year: 1871 },
  { text: "There is no greater agony than bearing an untold story inside you.", author: "Maya Angelou", work: "I Know Why the Caged Bird Sings", year: 1969 },
  { text: "One must always be careful of books, and what is inside them, for words have the power to change us.", author: "Cassandra Clare", work: "City of Bones", year: 2007 },
  { text: "That's the thing about books. They let you travel without moving your feet.", author: "Jhumpa Lahiri", work: "The Namesake", year: 2003 },
  { text: "I took a deep breath and listened to the old brag of my heart: I am, I am, I am.", author: "Sylvia Plath", work: "The Bell Jar", year: 1963 },
  { text: "Until I feared I would lose it, I never loved to read. One does not love breathing.", author: "Harper Lee", work: "To Kill a Mockingbird", year: 1960 },
  { text: "Time is a flat circle.", author: "Friedrich Nietzsche", work: "The Gay Science", year: 1882 },
  { text: "It does not do to dwell on dreams and forget to live.", author: "J.K. Rowling", work: "Harry Potter and the Philosopher's Stone", year: 1997 },
  { text: "We are all just walking each other home.", author: "Ram Dass", work: "Be Here Now", year: 1971 },
];

// Pick a quote deterministically by day so it changes daily but doesn't
// flicker on every reload within the same session.
function todaysGreeting() {
  const day = Math.floor(Date.now() / 86_400_000);
  return QUOTES[day % QUOTES.length];
}

// Count events from the past 24 hours as a lightweight "new activity" signal.
function countRecentEvents(events) {
  const cutoff = Date.now() - 86_400_000;
  return events.filter((e) => new Date(e.ts).getTime() > cutoff).length;
}

// Minimal inline styles for the "+" compose hub. These belong in club.css
// long-term (see the follow-up note in the workstream report); inlined here to
// keep the FAB + menu self-contained within this view's boundary. All colors
// come from the design-system tokens so it stays on-theme.
const composeHubStyles = `
<style>
  .feed-fab {
    position: fixed; right: 22px; bottom: 84px; z-index: 40;
    width: 58px; height: 58px; border-radius: 50%;
    background: var(--yarn-rust); color: var(--surface);
    border: 3px solid var(--surface); box-shadow: var(--shadow-lift);
    font-size: 30px; line-height: 1; cursor: pointer;
    display: grid; place-items: center;
    transition: transform .12s ease;
  }
  .feed-fab:hover { transform: scale(1.06) rotate(90deg); }
  .feed-fab:active { transform: scale(.96); }
  @media (min-width: 900px) { .feed-fab { bottom: 34px; right: 34px; } }

  .compose-hub { display: flex; flex-direction: column; gap: 10px; }
  .compose-hub-action {
    display: flex; align-items: center; gap: 12px; text-align: left;
    padding: 12px 14px; border-radius: 12px; cursor: pointer;
    background: var(--surface-2); border: 2px solid var(--yarn-bark);
    box-shadow: var(--shadow-soft); color: var(--text-primary);
    font: inherit;
  }
  .compose-hub-action:hover { background: var(--surface); }
  .compose-hub-icon { font-size: 22px; flex: 0 0 auto; }
  .compose-hub-text { display: flex; flex-direction: column; gap: 2px; }

  .post-club-select { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 10px; }
  .post-club-chip {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 5px 11px 5px 6px; border-radius: 999px; cursor: pointer;
    background: var(--surface-2); border: 2px solid var(--yarn-bark);
    color: var(--text-primary); font: inherit;
  }
  .post-club-chip.selected { background: var(--yarn-sage); color: var(--surface); border-color: var(--yarn-sage); }
  .post-club-chip-name { font-size: 13px; }
</style>`;

export async function renderFeed({ tab = "feed" } = {}) {
  render(`
    ${composeHubStyles}
    <div class="feed-shell">
      <aside class="feed-rail feed-rail-clubs" data-rail="clubs" aria-label="Your clubs"></aside>
      <main class="feed-column">
        <div class="feed-mobile-bar">
          <button class="btn-ghost small" data-open-rail="clubs">📚 Clubs</button>
          <h1 class="stamp-title small feed-title">YOUR FEED</h1>
          <button class="btn-ghost small" data-open-rail="reading">📖 Reading</button>
        </div>
        <h1 class="stamp-title small feed-title feed-title-desktop">YOUR FEED</h1>
        <div class="feed-tabs" role="tablist" aria-label="Feed">
          <button class="feed-tab-btn" role="tab" data-feed-tab="feed">Feed</button>
          <button class="feed-tab-btn" role="tab" data-feed-tab="unlocked">
            ✨ Unlocked<span class="feed-tab-badge" data-unlock-badge hidden></span>
          </button>
        </div>
        <div class="feed-stories" data-stories></div>
        <div class="feed-greeting" data-greeting></div>
        <div class="feed-announce" data-announce></div>
        <div class="feed-stream" data-feed><p class="faint">loading your feed…</p></div>
      </main>
      <aside class="feed-rail feed-rail-reading" data-rail="reading" aria-label="Your reading"></aside>
      <div class="feed-drawer-backdrop" data-drawer-backdrop hidden></div>
      <button class="feed-fab" data-fab title="Create" aria-label="Create" aria-haspopup="true" aria-expanded="false">＋</button>
    </div>
  `, (root) => boot(root, tab));
}

async function boot(root, initialTab = "feed") {
  wireDrawers(root);

  // The latest snapshot of my clubs (kept fresh by load()) so the "+" compose
  // hub can offer them in its multi-select without a second fetch.
  let myClubs = [];

  // Which stream the center column shows: the mixed feed, or the reactions my
  // progress bumps have unlocked (TikTok-style "For You / Following" split — here
  // "Feed / Unlocked"). Both render through the SAME card painter.
  let activeTab = initialTab;
  let feedEvents = [];        // the mixed feed
  let unlockedEvents = [];    // unlock items as feed-shaped reaction events
  let unseenUnlockIds = [];   // reaction ids not yet marked seen (badge + mark-on-view)
  let sharedCtx = null;       // render context (engagements/replies/names)

  // One pass over my clubs, fetching everything the three regions need. Each
  // region is then painted from the same in-memory snapshot.
  async function load() {
    const clubs = await api.myClubs();
    myClubs = clubs;
    const [data, followed, stories, unlocks] = await Promise.all([
      Promise.all(clubs.map(gatherClub)),
      // Readers I follow: their solo reading OUTSIDE my clubs (already
      // RLS-filtered). Items inside a shared club are dropped below — the club
      // events cover those.
      api.followFeed().catch(() => ({ items: [] })),
      // Active (unexpired, audience-visible) stories, grouped by author. Already
      // RLS-filtered; a failure just hides the strip.
      api.activeStories().catch(() => []),
      // Everything my progress bumps have unlocked (feeds the Unlocked tab).
      // Already RLS-filtered; a failure just empties the tab.
      api.myUnlocks().catch(() => []),
    ]);
    const myClubIds = new Set(clubs.map((c) => c.id));
    const followItems = followed.items.filter((i) => !myClubIds.has(i.book.club_id));

    // Bulk-load (in three queries, not per-club) the reply threads, the global
    // announcements, and every engagement on anything visible on this screen —
    // including the Unlocked tab's reactions, so its cards carry the same live
    // engagement bars + reply threads as the mixed feed.
    const reactionIds = [...new Set([
      ...data.flatMap((d) => d.reactions.map((r) => r.id)),
      ...unlocks.map((u) => u.reaction.id),
    ])];
    const [replies, announcements] = await Promise.all([
      api.reactionReplies(reactionIds),
      api.activeAnnouncements(),
    ]);
    const targetIds = [
      ...reactionIds,
      ...replies.map((r) => r.id),
      ...data.filter((d) => d.book).map((d) => d.book.id),
      ...data.flatMap((d) => d.progress.map((p) => p.id)),
      ...data.flatMap((d) => d.selections.map((s) => s.id)),
      ...announcements.map((a) => a.id),
    ];
    const engagements = await api.engagementsFor(targetIds);
    const shared = { data, followItems, replies, announcements, engagements, unlocks };
    const ctx = buildContext(shared);

    // Build events once so the greeting can derive the "new activity" count
    // from the same data the feed will render — no extra API call.
    const events = [
      ...buildEvents(shared.data, ctx),
      ...buildFollowEvents(followItems),
      ...buildLikeNotifications(shared, ctx),
    ].sort((a, b) => new Date(b.ts) - new Date(a.ts));

    feedEvents = events;
    unlockedEvents = buildUnlockedEvents(unlocks, data);
    unseenUnlockIds = unlocks.filter((u) => !u.seen_at).map((u) => u.reaction_id);
    sharedCtx = ctx;

    paintClubsRail(root, data);
    paintReadingRail(root, data);
    paintStories(root, stories, load);
    paintGreeting(root, events);
    paintAnnouncements(root, shared, ctx, load);
    paintTabBar();
    paintStream();
    return data;
  }

  // ---- Feed / Unlocked tabs -------------------------------------------------
  function paintTabBar() {
    root.querySelectorAll("[data-feed-tab]").forEach((b) =>
      b.classList.toggle("active", b.dataset.feedTab === activeTab));
    const badge = root.querySelector("[data-unlock-badge]");
    if (badge) {
      badge.hidden = unseenUnlockIds.length === 0;
      badge.textContent = unseenUnlockIds.length || "";
    }
  }

  // Paint whichever stream the active tab shows — both go through the same
  // eventCardHTML painter, so the Unlocked tab reads exactly like the feed.
  // Stories, the greeting, and announcements belong to the mixed feed; the
  // Unlocked tab is just the caught-up reactions.
  function paintStream() {
    for (const sel of ["[data-stories]", "[data-greeting]", "[data-announce]"]) {
      const el = root.querySelector(sel);
      if (el) el.style.display = activeTab === "unlocked" ? "none" : "";
    }
    if (activeTab === "unlocked") {
      paintFeed(root, { events: unlockedEvents, emptyHTML: `
        <div class="feed-empty patch">
          <p>nothing unlocked yet.</p>
          <p class="faint">reactions club-mates left in pages you've read appear here
          once you log progress past them — spoiler-free until you get there.</p>
        </div>` }, sharedCtx, load);
      markUnlockedSeen();
    } else {
      paintFeed(root, { events: feedEvents }, sharedCtx, load);
    }
  }

  // Viewing the Unlocked tab marks its rows seen (server-side, cross-device —
  // same semantics as dismissing an announcement) and clears the badge.
  function markUnlockedSeen() {
    if (!unseenUnlockIds.length) return;
    api.markUnlocksSeen(unseenUnlockIds).catch(() => {});
    unseenUnlockIds = [];
    paintTabBar();
  }

  root.querySelectorAll("[data-feed-tab]").forEach((b) =>
    b.addEventListener("click", () => {
      if (activeTab === b.dataset.feedTab) return;
      activeTab = b.dataset.feedTab;
      paintTabBar();
      paintStream();
    }));

  await load();

  // The "+" compose hub: a floating action button that opens a small menu of
  // three create actions (post / story / start a book). Wired once — the shell
  // stays mounted across live refreshes, and it reads myClubs fresh each open.
  wireComposeHub(root, () => myClubs, load);

  // Live refresh: any reaction or progress change in a book I can see, or any
  // selection change, re-runs the snapshot in place (debounced). The shell stays
  // mounted so these subscriptions persist until the router cleans them up.
  let timer;
  const refresh = () => { clearTimeout(timer); timer = setTimeout(load, 400); };
  const subs = [
    api.subscribe("feed-reactions", "reactions", undefined, refresh),
    api.subscribe("feed-progress", "reading_progress", undefined, refresh),
    api.subscribe("feed-selections", "selections", undefined, refresh),
    api.subscribe("feed-engagements", "engagements", undefined, refresh),
    api.subscribe("feed-replies", "reaction_replies", undefined, refresh),
    api.subscribe("feed-announcements", "announcements", undefined, refresh),
    // Stories strip: a new/removed story or a fresh view (seen ring) repaints.
    api.subscribe("feed-stories", "stories", undefined, refresh),
    api.subscribe("feed-story-views", "story_views", undefined, refresh),
  ];
  onCleanup(() => { clearTimeout(timer); subs.forEach((u) => u()); });
}

// Pull the current book + selections for a club, and (if there's a book) its
// reactions, progress, and members. Reactions come back spoiler-filtered.
async function gatherClub(club) {
  const [book, selections] = await Promise.all([
    api.currentBook(club.id),
    api.clubSelections(club.id),
  ]);
  let reactions = [], progress = [], members = [];
  if (book) {
    [reactions, progress, members] = await Promise.all([
      api.bookReactions(book.id),
      api.bookProgress(book.id),
      api.clubMembers(club.id),
    ]);
  }
  return { club, book, selections, reactions, progress, members };
}

/* ----------------------------------------------------------- LEFT RAIL · clubs */
function paintClubsRail(root, data) {
  const host = root.querySelector("[data-rail='clubs']");
  const active = data.filter((d) => d.book);

  const cards = active.map(({ club, book }) => `
    <button class="rail-club-card" data-go="/club/${club.id}" style="--accent:${accentColor(club.accent)}">
      ${clubAvatarHTML(club, 56, accentColor(club.accent))}
      <span class="rail-club-meta">
        <span class="rail-club-name">${esc(club.name)}</span>
        <span class="now-reading-tag">now reading</span>
        <span class="rail-club-book">${esc(book.title)}</span>
      </span>
    </button>`).join("");

  host.innerHTML = `
    <div class="rail-section">
      <h2 class="rail-head">Active clubs</h2>
      ${active.length ? cards : `<p class="faint rail-empty">no clubs are reading anything right now.</p>`}
    </div>
    <div class="rail-actions">
      <button class="btn-ghost" data-action="join">+ Join with code</button>
      <button class="btn-primary" data-action="create">+ New Club</button>
      <button class="btn-ghost rail-allclubs" data-go="/clubs">All clubs →</button>
    </div>`;

  host.querySelector("[data-action='join']").addEventListener("click", joinClubModal);
  host.querySelector("[data-action='create']").addEventListener("click", createClubModal);
  wireGo(host);
}

/* -------------------------------------------------------- RIGHT RAIL · reading */
function paintReadingRail(root, data) {
  const host = root.querySelector("[data-rail='reading']");
  const me = store.user.id;

  // My in-progress / unstarted current books, with my progress + deadline.
  const reading = data.filter((d) => d.book).map(({ club, book, progress }) => {
    const mine = progress.find((p) => p.user_id === me);
    const pct = (book.page_count && mine)
      ? Math.min(100, Math.round((mine.current_page / book.page_count) * 100)) : 0;
    const dl = daysUntil(book.deadline);
    const dlChip = book.deadline
      ? `<span class="deadline-badge ${dl < 0 ? "overdue" : dl <= 3 ? "soon" : ""}">${dl < 0 ? `${-dl}d overdue` : `${dl}d left`}</span>`
      : "";
    const status = mine?.status === "finished" ? "finished ✓"
      : mine ? `p.${mine.current_page}${book.page_count ? ` / ${book.page_count}` : ""}`
      : "not started";
    return `
      <button class="reading-item" data-go="/club/${club.id}/book/${book.id}">
        ${book.cover_url
          ? `<img class="book-cover sm" src="${esc(book.cover_url)}" alt="${esc(book.title)} cover">`
          : `<div class="book-cover sm book-cover-blank" role="img" aria-label="${esc(book.title)} cover">📖</div>`}
        <span class="reading-meta">
          <span class="reading-title">${esc(book.title)}</span>
          <span class="reading-club faint">${esc(club.name)}</span>
          <span class="progress-bar"><span class="progress-fill" style="width:${pct}%"></span></span>
          <span class="reading-foot">
            <span class="progress-label faint">${status}</span>${dlChip}
          </span>
        </span>
      </button>`;
  }).join("");

  // Open votes across my clubs that want my attention.
  const alerts = data.flatMap(({ club, selections }) =>
    selections.filter((s) => s.status === "open").map((s) => `
      <button class="vote-alert" data-go="/club/${club.id}/picker">
        <span class="vote-alert-icon">🗳️</span>
        <span class="vote-alert-text">Vote open in <strong>${esc(club.name)}</strong> — cast your ballot</span>
      </button>`)).join("");

  host.innerHTML = `
    <div class="rail-section">
      <h2 class="rail-head">Currently reading</h2>
      ${reading || `<p class="faint rail-empty">you're not reading anything yet.</p>`}
    </div>
    ${alerts ? `<div class="rail-section">
      <h2 class="rail-head">Needs you</h2>
      ${alerts}
    </div>` : ""}`;

  wireGo(host);
}

/* --------------------------------------------------------- STORIES · strip */
// The ephemeral-stories strip above the greeting. Groups came back already
// RLS-filtered + grouped by author from api.activeStories(). Your own bubble is
// pinned first as "＋ Your story" (tap to compose; if you already have live
// stories, tap opens your viewer and a small + affordance composes). Each other
// author bubble wears a yarn-accent ring when it has an unseen story, dimmed
// when all seen. Tapping opens the full-screen viewer at that author.
function paintStories(root, groups, reload) {
  const host = root.querySelector("[data-stories]");
  if (!host) return;

  // Bubbles for people I follow / club-mates (my own group is handled below).
  const others = groups.filter((g) => !g.isMine);
  const mine = groups.find((g) => g.isMine) || null;

  const bubble = (g, i) => {
    const name = g.profile?.display_name || "Reader";
    const ringClass = g.allSeen ? "story-seen" : "story-unseen";
    return `
      <button class="story-bubble ${ringClass}" data-open-story="${i}"
        title="${esc(name)}'s story" aria-label="${esc(name)}'s story">
        <span class="story-ring">${avatarHTML(g.profile, 58)}</span>
        <span class="story-bubble-name">${esc(name)}</span>
      </button>`;
  };

  // "＋ Your story" bubble always leads. If I have live stories it shows my
  // avatar with a + badge (tap = view mine); otherwise a plain add tile.
  const myBubble = mine
    ? `<button class="story-bubble story-mine ${mine.allSeen ? "story-seen" : "story-unseen"}"
         data-open-mine title="Your story" aria-label="Your story">
         <span class="story-ring">${avatarHTML(mine.profile, 58)}<span class="story-add-badge">＋</span></span>
         <span class="story-bubble-name">Your story</span>
       </button>`
    : `<button class="story-bubble story-mine story-add" data-compose
         title="Add to your story" aria-label="Add to your story">
         <span class="story-ring story-ring-add">＋</span>
         <span class="story-bubble-name">Your story</span>
       </button>`;

  host.innerHTML = `<div class="story-strip">${myBubble}${others.map((g, i) => bubble(g, i)).join("")}</div>`;

  // Repaint the strip after the viewer closes so newly-seen rings dim, and after
  // composing so a fresh story appears.
  const afterClose = () => reload();

  host.querySelector("[data-compose]")?.addEventListener("click", async () => {
    const posted = await composeStory(cropImage);
    if (posted) reload();
  });

  host.querySelector("[data-open-mine]")?.addEventListener("click", () => {
    // Open the viewer starting on my own group (index 0 of the full groups list,
    // since api.activeStories() pins mine first).
    openStoryViewer(groups, 0, afterClose);
  });

  host.querySelectorAll("[data-open-story]").forEach((btn) => {
    btn.addEventListener("click", () => {
      // btn index is into `others`; map it to the index within the full groups
      // list the viewer walks.
      const other = others[Number(btn.dataset.openStory)];
      const gi = groups.indexOf(other);
      openStoryViewer(groups, gi < 0 ? 0 : gi, afterClose);
    });
  });
}

/* --------------------------------------------------------- ANNOUNCEMENTS */
// Global admin broadcasts at the top of the feed, plus (admin only) a composer.
function paintAnnouncements(root, shared, ctx, reload) {
  const host = root.querySelector("[data-announce]");
  const isAdmin = !!store.profile?.is_admin;

  const composer = isAdmin ? `
    <div class="announce-composer patch">
      <h3 class="announce-admin-title">📣 Broadcast to everyone</h3>
      <form data-broadcast class="announce-form">
        <textarea name="body" rows="2" maxlength="280" required
          placeholder="e.g. You can now respond to people's reactions!"></textarea>
        <button type="submit" class="btn-primary small">Send to all users</button>
      </form>
    </div>` : "";

  const cards = shared.announcements.map((a) => `
    <div class="announce-card patch" data-announce-id="${a.id}">
      <span class="announce-icon" aria-hidden="true">📣</span>
      <div class="announce-main">
        <p class="announce-body">${esc(a.body)}</p>
        <div class="card-foot">${engagementBarHTML("announcement", a.id, ctx.engOf(a.id), ctx.nameOf, ctx.myId)}</div>
      </div>
      <button class="announce-dismiss" data-dismiss="${a.id}" title="Dismiss announcement" aria-label="Dismiss announcement">×</button>
    </div>`).join("");

  host.innerHTML = composer + cards;

  const form = host.querySelector("[data-broadcast]");
  if (form) form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = form.body.value.trim();
    if (!body) return;
    try { await api.postAnnouncement(body); form.body.value = ""; toast("Broadcast sent to all users", "success"); reload(); }
    catch (err) { toast(err.message, "error"); }
  });

  host.querySelectorAll("[data-dismiss]").forEach((b) => b.addEventListener("click", async () => {
    try { await api.dismissAnnouncement(b.dataset.dismiss); reload(); }
    catch (err) { toast(err.message, "error"); }
  }));

  wireEngagementUI(host, reload);
}

/* ------------------------------------------------------- GREETING HEADER */
// A rotating literary quote + attribution + a lightweight "N new" count
// derived from the same events the feed already renders. Scrolls past naturally
// above the stream.
function paintGreeting(root, events) {
  const host = root.querySelector("[data-greeting]");
  if (!host) return;
  const quote = todaysGreeting();
  const recentCount = countRecentEvents(events);
  const countChip = recentCount > 0
    ? `<span class="greeting-count">${recentCount} new</span>`
    : "";
  host.innerHTML = `
    <div class="feed-greeting-inner">
      <p class="greeting-line">${esc(quote.text)}</p>
      <p class="greeting-attribution">— ${esc(quote.author)}, <em>${esc(quote.work)}</em> (${esc(String(quote.year))})</p>
      ${countChip}
    </div>`;
}

/* ------------------------------------------------------------- CENTER · feed */
function paintFeed(root, shared, ctx, reload) {
  const host = root.querySelector("[data-feed]");
  // Use pre-computed events if available (passed from load()); otherwise derive
  // them here (e.g. first render before refactor callers catch up).
  const events = shared.events
    || ([...buildEvents(shared.data, ctx),
         ...buildFollowEvents(shared.followItems || []),
         ...buildLikeNotifications(shared, ctx)]
        .sort((a, b) => new Date(b.ts) - new Date(a.ts)));

  host.innerHTML = events.length
    ? events.map((e) => eventCardHTML(e, ctx)).join("")
    : (shared.emptyHTML || `<div class="feed-empty patch">
         <p>your feed is quiet.</p>
         <p class="faint">join or create a club, set a book, and activity from every club you're in will show up here.</p>
       </div>`);

  wireGo(host);
  wireUserLinks(host);
  wireEngagementUI(host, reload);
}

// Unlock rows (api.myUnlocks) reshaped into the feed's own reaction-event form,
// so the Unlocked tab renders through eventCardHTML like everything else. Sorted
// newest-unlock first, then by page within a batch (walk forward through the
// pages you just crossed). Club names resolve from the loaded snapshots; a book
// from a club not in the snapshot (e.g. finished long ago) still renders — the
// chip just falls back to the book line alone.
function buildUnlockedEvents(unlocks, data) {
  const clubNameById = {};
  for (const d of data) clubNameById[d.club.id] = d.club.name;
  return unlocks
    .slice()
    .sort((a, b) => (new Date(b.unlocked_at) - new Date(a.unlocked_at))
      || (a.reaction.page - b.reaction.page))
    .map((u) => ({
      kind: "reaction", type: "reaction", ts: u.unlocked_at,
      reaction: u.reaction,
      club: clubNameById[u.book.club_id] || "Unlocked",
      bookTitle: u.book.title,
      go: `/club/${u.book.club_id}/book/${u.book.id}`,
    }));
}

// Group rows by a key into { keyValue: rows[] }.
function groupBy(rows, key) {
  const out = {};
  for (const r of rows) (out[r[key]] ||= []).push(r);
  return out;
}

// Build the shared render context: engagement lookup, reply lookup, and a name
// resolver for like/emoji hover tooltips.
function buildContext(shared) {
  const { data, replies, engagements, unlocks = [] } = shared;
  const engByTarget = groupBy(engagements, "target_id");
  const pById = {};
  for (const d of data) {
    for (const m of d.members) if (m.profile) pById[m.user_id] = m.profile;
    for (const r of d.reactions) if (r.profile) pById[r.user_id] = r.profile;
  }
  for (const r of replies) if (r.profile) pById[r.user_id] = r.profile;
  for (const u of unlocks) if (u.reaction.profile) pById[u.reaction.user_id] = u.reaction.profile;
  return {
    myId: store.user.id,
    engOf: (id) => engByTarget[id] || [],
    repliesByReaction: groupBy(replies, "reaction_id"),
    nameOf: makeNameResolver(pById),
  };
}

// "Someone liked your X" cards, derived from likes others left on things I made.
function buildLikeNotifications(shared, ctx) {
  const me = store.user.id;
  const { data, replies, engagements } = shared;

  const likesByTarget = {};
  for (const e of engagements) {
    if (e.kind === "like" && e.user_id !== me) (likesByTarget[e.target_id] ||= []).push(e);
  }

  // Things I authored, with a human label (already escaped) for the notification
  // and the club it happened in (for the card's header chip).
  const mine = [];
  const clubByReaction = {};
  for (const d of data) {
    for (const r of d.reactions) clubByReaction[r.id] = d.club.name;
    if (d.book && d.book.picked_by === me) {
      mine.push({ id: d.book.id, club: d.club.name, book: d.book.title, label: "your pick" });
    }
    for (const r of d.reactions) if (r.user_id === me) {
      mine.push({ id: r.id, club: d.club.name, book: d.book?.title, label: "your reaction" });
    }
    for (const p of d.progress) if (p.user_id === me) {
      mine.push({ id: p.id, club: d.club.name, book: d.book?.title, label: "your reading update" });
    }
  }
  for (const r of replies) {
    if (r.user_id === me) mine.push({ id: r.id, club: clubByReaction[r.reaction_id], label: "your reply" });
  }

  const events = [];
  for (const m of mine) {
    const likes = likesByTarget[m.id];
    if (!likes?.length) continue;
    const names = likes.map((l) => ctx.nameOf(l.user_id));
    const ts = likes.reduce((mx, l) => Math.max(mx, new Date(l.created_at).getTime()), 0);
    events.push({ kind: "notif", type: "social", ts: new Date(ts).toISOString(), icon: "👍",
      club: m.club, bookTitle: m.book,
      text: `${likeLabel(names)} liked ${m.label}` });
  }
  return events;
}

// Follow-feed items: solo reading by people I follow, outside my clubs. These
// carry a "Following" header chip instead of a club name and tap through to the
// reader's profile (their book lives in a club I'm not a member of).
function buildFollowEvents(items) {
  return items.map((i) => {
    const name = esc(i.profile?.display_name || "A reader");
    const go = i.profile ? `/user/${i.profile.id}` : undefined;
    const base = { type: "follow", follow: true, ts: i.at, go, bookTitle: i.book.title };
    if (i.kind === "reaction") {
      return { kind: "reaction", ...base, reaction: {
        id: i.id, user_id: i.profile?.id, profile: i.profile,
        page: i.page, body: i.body, created_at: i.at,
      } };
    }
    const of = i.book.page_count ? ` of ${i.book.page_count}` : "";
    const text = i.status === "finished" ? `${name} finished the book`
      : i.page > 0 ? `${name} read to page ${i.page}${of}`
      : `${name} started reading`;
    const icon = i.status === "finished" ? "🎉" : i.page > 0 ? "📖" : "🔖";
    return { kind: "notif", ...base, icon, text };
  });
}

function likeLabel(names) {
  if (names.length === 1) return esc(names[0]);
  if (names.length === 2) return `${esc(names[0])} and ${esc(names[1])}`;
  return `${esc(names[0])} <span class="faint">(and ${names.length - 1} others)</span>`;
}

// Turn the per-club snapshot into a flat list of feed events. Reactions are
// already spoiler-safe; progress milestones mirror book.js's buildNotifications.
// Every event carries `club` (header chip) + `bookTitle` (its own line) instead
// of baking them into the sentence, and a `type` that drives its look:
//   progress · reaction · milestone · pick · social · follow
function buildEvents(data) {
  const me = store.user?.id;
  const events = [];

  for (const { club, book, reactions, progress, members, selections } of data) {
    if (book) {
      const go = `/club/${club.id}/book/${book.id}`;
      const b = { club: club.name, bookTitle: book.title };

      events.push({
        kind: "notif", type: "milestone", ts: book.created_at, icon: "📚",
        text: "The club started a new book", go, ...b,
        targetType: "book", targetId: book.id,
      });

      for (const r of reactions) {
        events.push({ kind: "reaction", type: "reaction", ts: r.created_at,
          reaction: r, go, ...b });
      }

      for (const p of progress) {
        const name = p.user_id === me ? "You" : (p.profile?.display_name || "A reader");
        const t = { targetType: "progress", targetId: p.id, go, ...b };
        if (p.status === "finished") {
          events.push({ kind: "notif", type: "milestone", ts: p.finished_at || p.updated_at,
            icon: "🎉", text: `${esc(name)} finished the book`, ...t });
        } else if (p.status === "reading" && p.current_page > 0) {
          const of = book.page_count ? ` of ${book.page_count}` : "";
          events.push({ kind: "notif", type: "progress", ts: p.updated_at, icon: "📖",
            text: `${esc(name)} read to page ${p.current_page}${of}`, ...t });
        } else if (p.status === "reading" || p.started_at) {
          events.push({ kind: "notif", type: "progress", ts: p.started_at || p.updated_at,
            icon: "🔖", text: `${esc(name)} started reading`, ...t });
        }
      }

      const finishedRows = progress.filter((p) => p.status === "finished");
      if (members.length > 0 && finishedRows.length >= members.length) {
        const lastTs = finishedRows.reduce(
          (m, p) => Math.max(m, new Date(p.finished_at || p.updated_at).getTime()), 0);
        events.push({ kind: "notif", type: "milestone", ts: new Date(lastTs).toISOString(),
          icon: "🏆", highlight: true, text: "Everyone finished the book!", go, ...b });
      }
    }

    for (const s of selections) {
      const t = { targetType: "selection", targetId: s.id, club: club.name };
      if (s.status === "open") {
        events.push({ kind: "notif", type: "pick", ts: s.created_at, icon: "🗳️",
          highlight: true, text: "A vote opened — pick who chooses next",
          go: `/club/${club.id}/picker`, ...t });
      } else if (s.status === "decided" && s.announced) {
        // Opt-in: only surface the decided selection once the decider/owner has
        // announced it (see api.announceSelection / picker "Announce" button).
        const winner = members.find((m) => m.user_id === s.result_user)?.profile?.display_name;
        events.push({ kind: "notif", type: "pick", ts: s.decided_at || s.created_at, icon: "🎯",
          text: winner ? `${esc(winner)} will pick the next book` : "The club decided who picks next",
          go: `/club/${club.id}/history`, ...t });
      }
    }
  }
  return events;
}

// The small header every card carries: which club this happened in — or
// "Following" when it comes from a reader you follow outside your clubs —
// with the book it's about right underneath.
function cardHeadHTML(e) {
  const chip = e.club
    ? `<span class="feed-chip">${esc(e.club)}</span>`
    : `<span class="feed-chip feed-chip-follow">✧ Following</span>`;
  const bookLine = e.bookTitle ? `<span class="feed-book-line">${esc(e.bookTitle)}</span>` : "";
  return `<div class="feed-card-head">${chip}<span class="notif-time faint">${timeAgo(e.ts)}</span></div>${bookLine}`;
}

function eventCardHTML(e, ctx) {
  const typeClass = `feed-kind-${e.type || "progress"}`;
  if (e.kind === "reaction") {
    const r = e.reaction;
    // Follow-path reactions are display-only (no engagement bar or replies —
    // they live in clubs we're not members of), and tap to the reader's profile.
    const foot = e.follow ? "" : `
        <div class="card-foot">
          ${engagementBarHTML("reaction", r.id, ctx.engOf(r.id), ctx.nameOf, ctx.myId)}
          ${replyThreadHTML(r.id, ctx.repliesByReaction[r.id] || [], ctx.engOf, ctx.nameOf, ctx.myId)}
        </div>`;
    return `
      <article class="feed-item feed-reaction ${typeClass}" data-go="${e.go}">
        ${cardHeadHTML(e)}
        <div class="reaction-head">
          ${userLinkHTML(r.user_id, `${avatarHTML(r.profile, 30)}
            <span class="reaction-name">${esc(r.profile?.display_name || "Reader")}</span>`,
            r.profile?.display_name)}
          <span class="reaction-page">p.${r.page}</span>
        </div>
        <p class="reaction-body">${esc(r.body)}</p>${foot}
      </article>`;
  }
  // notification (activity) card — likeable when backed by a real row.
  const goAttr = e.go ? ` data-go="${e.go}"` : "";
  const bar = e.targetId
    ? `<div class="card-foot">${engagementBarHTML(e.targetType, e.targetId, ctx.engOf(e.targetId), ctx.nameOf, ctx.myId)}</div>`
    : "";
  return `
    <article class="feed-item notif-card ${typeClass} ${e.highlight ? "notif-highlight" : ""}"${goAttr}>
      ${cardHeadHTML(e)}
      <div class="notif-row">
        <span class="notif-icon" aria-hidden="true">${e.icon}</span>
        <div class="notif-main">
          <p class="notif-text">${e.text}</p>
        </div>
      </div>
      ${bar}
    </article>`;
}

/* --------------------------------------------------------------- interactions */
// Any element with data-go navigates on click (cards, rail items, buttons).
function wireGo(scope) {
  scope.querySelectorAll("[data-go]").forEach((el) => {
    if (el.dataset.goWired) return;
    el.dataset.goWired = "1";
    el.addEventListener("click", () => navigate(el.dataset.go));
  });
}

// Mobile: the two rails live off-canvas and slide in when their top-bar button
// is tapped. On desktop the buttons are hidden and the rails are grid columns.
function wireDrawers(root) {
  const backdrop = root.querySelector("[data-drawer-backdrop]");
  const close = () => {
    root.querySelectorAll(".feed-rail.open").forEach((r) => r.classList.remove("open"));
    backdrop.hidden = true;
  };
  root.querySelectorAll("[data-open-rail]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const rail = root.querySelector(`[data-rail='${btn.dataset.openRail}']`);
      close();
      rail.classList.add("open");
      backdrop.hidden = false;
    }));
  backdrop.addEventListener("click", close);
}

/* ------------------------------------------------------- COMPOSE HUB ("+") */
// A floating action button opening a menu of three create actions:
//   1. Create post  — the multi-club post composer (composePostToClubs)
//   2. Post a story — the SAME story composer the "＋ Your story" bubble uses
//   3. Start a book — pick a club, then the existing OpenLibrary addBookModal
// `getClubs` returns the feed's latest myClubs snapshot; `reload` repaints the
// feed after a post/story so a fresh item shows immediately.
function wireComposeHub(root, getClubs, reload) {
  const fab = root.querySelector("[data-fab]");
  if (!fab || fab.dataset.wired) return;
  fab.dataset.wired = "1";

  fab.addEventListener("click", () => {
    openModal(`
      <h3>Create</h3>
      <div class="modal-body compose-hub">
        <button class="compose-hub-action" data-compose="post">
          <span class="compose-hub-icon">✎</span>
          <span class="compose-hub-text"><strong>Create post</strong>
            <span class="faint">a thought or photo, to one or more clubs</span></span>
        </button>
        <button class="compose-hub-action" data-compose="story">
          <span class="compose-hub-icon">📸</span>
          <span class="compose-hub-text"><strong>Post a story</strong>
            <span class="faint">disappears in 72 hours</span></span>
        </button>
        <button class="compose-hub-action" data-compose="book">
          <span class="compose-hub-icon">📚</span>
          <span class="compose-hub-text"><strong>Start a book</strong>
            <span class="faint">set a club's current book</span></span>
        </button>
        <div class="modal-actions"><button class="btn-ghost" data-close>cancel</button></div>
      </div>
    `, (modal) => {
      modal.querySelector("[data-compose='post']").addEventListener("click", async () => {
        closeModal();
        const posted = await composePostToClubs(getClubs());
        if (posted) reload();
      });
      modal.querySelector("[data-compose='story']").addEventListener("click", async () => {
        closeModal();
        // Reuse the exact same composer entry point as the stories strip bubble.
        const posted = await composeStory(cropImage);
        if (posted) reload();
      });
      modal.querySelector("[data-compose='book']").addEventListener("click", () => {
        closeModal();
        startBookFlow(getClubs());
      });
    });
  });
}

// "Start a book": pick which club, then hand off to the existing OpenLibrary
// search modal (addBookModal from club.js) to set that club's current book. Only
// clubs where I'm the creator/owner can set the book (books_update/insert is
// owner-gated server-side); a non-owner pick would fail its insert, so we offer
// only owner-tier clubs. With exactly one eligible club we skip straight to the
// book search.
function startBookFlow(clubs) {
  const eligible = clubs.filter((c) => c.my_role === "creator" || c.my_role === "owner");
  if (!eligible.length) {
    toast("Only a club's owner can set its book", "info");
    return;
  }
  const pick = (club) => addBookModal(club, () => navigate(`/club/${club.id}`));
  if (eligible.length === 1) { pick(eligible[0]); return; }

  openModal(`
    <h3>Start a book in…</h3>
    <div class="modal-body compose-hub">
      ${eligible.map((c) => `
        <button class="compose-hub-action" data-club="${esc(c.id)}">
          ${clubAvatarHTML(c, 28)}
          <span class="compose-hub-text"><strong>${esc(c.name)}</strong></span>
        </button>`).join("")}
      <div class="modal-actions"><button class="btn-ghost" data-close>cancel</button></div>
    </div>
  `, (modal) => {
    modal.querySelectorAll("[data-club]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const club = eligible.find((c) => c.id === btn.dataset.club);
        closeModal();
        if (club) pick(club);
      }));
  });
}
