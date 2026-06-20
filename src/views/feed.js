// The app's home screen: a social-media style activity FEED across every club you
// belong to, flanked by two rails — clubs (left) and your reading (right).
//
// Like book.js, the feed is derived ENTIRELY client-side from existing api.js
// data (reactions are already spoiler-filtered by RLS server-side; we never
// re-implement gating here). No notifications table, no new DB access.
import { render, navigate, onCleanup } from "../router.js";
import { esc, avatarHTML, timeAgo, daysUntil } from "../ui.js";
import { store } from "../store.js";
import * as api from "../api.js";
import { createClubModal, joinClubModal } from "./clubs.js";

const ACCENTS = {
  "yarn-sage": "#7a9068", "yarn-rust": "#a05838", "yarn-slate": "#587888",
  "yarn-mauve": "#886878", "yarn-ochre": "#b8a058", "yarn-moss": "#607050",
  "yarn-clay": "#987860", "yarn-bark": "#483828",
};
const accentColor = (a) => ACCENTS[a] || ACCENTS["yarn-sage"];

export async function renderFeed() {
  render(`
    <div class="feed-shell">
      <aside class="feed-rail feed-rail-clubs" data-rail="clubs" aria-label="Your clubs"></aside>
      <main class="feed-column">
        <div class="feed-mobile-bar">
          <button class="btn-ghost small" data-open-rail="clubs">📚 Clubs</button>
          <h1 class="stamp-title small feed-title">YOUR FEED</h1>
          <button class="btn-ghost small" data-open-rail="reading">📖 Reading</button>
        </div>
        <h1 class="stamp-title small feed-title feed-title-desktop">YOUR FEED</h1>
        <div class="feed-stream" data-feed><p class="faint">loading your feed…</p></div>
      </main>
      <aside class="feed-rail feed-rail-reading" data-rail="reading" aria-label="Your reading"></aside>
      <div class="feed-drawer-backdrop" data-drawer-backdrop hidden></div>
    </div>
  `, (root) => boot(root));
}

async function boot(root) {
  wireDrawers(root);

  // One pass over my clubs, fetching everything the three regions need. Each
  // region is then painted from the same in-memory snapshot.
  async function load() {
    const clubs = await api.myClubs();
    const data = await Promise.all(clubs.map(gatherClub));
    paintClubsRail(root, data);
    paintReadingRail(root, data);
    paintFeed(root, data);
    return data;
  }

  await load();

  // Live refresh: any reaction or progress change in a book I can see, or any
  // selection change, re-runs the snapshot in place (debounced). The shell stays
  // mounted so these subscriptions persist until the router cleans them up.
  let timer;
  const refresh = () => { clearTimeout(timer); timer = setTimeout(load, 400); };
  const subs = [
    api.subscribe("feed-reactions", "reactions", undefined, refresh),
    api.subscribe("feed-progress", "reading_progress", undefined, refresh),
    api.subscribe("feed-selections", "selections", undefined, refresh),
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
      ${book.cover_url
        ? `<img class="book-cover sm" src="${esc(book.cover_url)}" alt="">`
        : `<div class="book-cover sm book-cover-blank">📖</div>`}
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
          ? `<img class="book-cover sm" src="${esc(book.cover_url)}" alt="">`
          : `<div class="book-cover sm book-cover-blank">📖</div>`}
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

/* ------------------------------------------------------------- CENTER · feed */
function paintFeed(root, data) {
  const host = root.querySelector("[data-feed]");
  const events = buildEvents(data).sort((a, b) => new Date(b.ts) - new Date(a.ts));

  host.innerHTML = events.length
    ? events.map(eventCardHTML).join("")
    : `<div class="feed-empty patch">
         <p>your feed is quiet.</p>
         <p class="faint">join or create a club, set a book, and activity from every club you're in will show up here.</p>
       </div>`;

  wireGo(host);
}

// Turn the per-club snapshot into a flat list of feed events. Reactions are
// already spoiler-safe; progress milestones mirror book.js's buildNotifications.
function buildEvents(data) {
  const me = store.user?.id;
  const events = [];

  for (const { club, book, reactions, progress, members, selections } of data) {
    const where = book ? `${book.title} · ${club.name}` : club.name;

    if (book) {
      events.push({
        kind: "notif", ts: book.created_at, icon: "📚",
        text: `${esc(club.name)} started reading ${esc(book.title)}`,
        go: `/club/${club.id}/book/${book.id}`,
      });

      for (const r of reactions) {
        events.push({ kind: "reaction", ts: r.created_at, reaction: r, where,
          go: `/club/${club.id}/book/${book.id}` });
      }

      for (const p of progress) {
        const name = p.user_id === me ? "You" : (p.profile?.display_name || "A reader");
        const go = `/club/${club.id}/book/${book.id}`;
        if (p.status === "finished") {
          events.push({ kind: "notif", ts: p.finished_at || p.updated_at, icon: "🎉",
            text: `${esc(name)} finished ${esc(book.title)}`, go });
        } else if (p.status === "reading" && p.current_page > 0) {
          const of = book.page_count ? ` of ${book.page_count}` : "";
          events.push({ kind: "notif", ts: p.updated_at, icon: "📖",
            text: `${esc(name)} read to page ${p.current_page}${of} of ${esc(book.title)}`, go });
        } else if (p.status === "reading" || p.started_at) {
          events.push({ kind: "notif", ts: p.started_at || p.updated_at, icon: "🔖",
            text: `${esc(name)} started ${esc(book.title)}`, go });
        }
      }

      const finishedRows = progress.filter((p) => p.status === "finished");
      if (members.length > 0 && finishedRows.length >= members.length) {
        const lastTs = finishedRows.reduce(
          (m, p) => Math.max(m, new Date(p.finished_at || p.updated_at).getTime()), 0);
        events.push({ kind: "notif", ts: new Date(lastTs).toISOString(), icon: "🏆",
          highlight: true, text: `Everyone in ${esc(club.name)} finished ${esc(book.title)}!`,
          go: `/club/${club.id}/book/${book.id}` });
      }
    }

    for (const s of selections) {
      if (s.status === "open") {
        events.push({ kind: "notif", ts: s.created_at, icon: "🗳️", highlight: true,
          text: `A vote opened in ${esc(club.name)} — pick who chooses next`,
          go: `/club/${club.id}/picker` });
      } else if (s.status === "decided") {
        const winner = members.find((m) => m.user_id === s.result_user)?.profile?.display_name;
        events.push({ kind: "notif", ts: s.decided_at || s.created_at, icon: "🎯",
          text: winner ? `${esc(winner)} will pick the next book for ${esc(club.name)}`
                       : `${esc(club.name)} decided who picks next`,
          go: `/club/${club.id}/history` });
      }
    }
  }
  return events;
}

function eventCardHTML(e) {
  if (e.kind === "reaction") {
    const r = e.reaction;
    return `
      <article class="feed-item feed-reaction" data-go="${e.go}">
        <div class="reaction-head">
          ${avatarHTML(r.profile, 30)}
          <span class="reaction-name">${esc(r.profile?.display_name || "Reader")}</span>
          <span class="feed-context faint">${esc(e.where)}</span>
          <span class="reaction-page">p.${r.page}</span>
        </div>
        <p class="reaction-body">${esc(r.body)}</p>
        <span class="notif-time faint">${timeAgo(r.created_at)}</span>
      </article>`;
  }
  // notification (activity) card
  return `
    <article class="feed-item notif-card ${e.highlight ? "notif-highlight" : ""}" data-go="${e.go}">
      <span class="notif-icon" aria-hidden="true">${e.icon}</span>
      <div class="notif-main">
        <p class="notif-text">${e.text}</p>
        <span class="notif-time faint">${timeAgo(e.ts)}</span>
      </div>
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
