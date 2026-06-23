// The app's home screen: a social-media style activity FEED across every club you
// belong to, flanked by two rails — clubs (left) and your reading (right).
//
// Like book.js, the feed is derived ENTIRELY client-side from existing api.js
// data (reactions are already spoiler-filtered by RLS server-side; we never
// re-implement gating here). No notifications table, no new DB access.
import { render, navigate, onCleanup } from "../router.js";
import { esc, avatarHTML, clubAvatarHTML, timeAgo, daysUntil, toast } from "../ui.js";
import { store } from "../store.js";
import * as api from "../api.js";
import { createClubModal, joinClubModal } from "./clubs.js";
import { engagementBarHTML, replyThreadHTML, wireEngagementUI, makeNameResolver } from "../engage.js";

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
        <div class="feed-announce" data-announce></div>
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

    // Bulk-load (in three queries, not per-club) the reply threads, the global
    // announcements, and every engagement on anything visible on this screen.
    const reactionIds = data.flatMap((d) => d.reactions.map((r) => r.id));
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
    const shared = { data, replies, announcements, engagements };
    const ctx = buildContext(shared);

    paintClubsRail(root, data);
    paintReadingRail(root, data);
    paintAnnouncements(root, shared, ctx, load);
    paintFeed(root, shared, ctx, load);
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
    api.subscribe("feed-engagements", "engagements", undefined, refresh),
    api.subscribe("feed-replies", "reaction_replies", undefined, refresh),
    api.subscribe("feed-announcements", "announcements", undefined, refresh),
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
      <button class="announce-dismiss" data-dismiss="${a.id}" title="dismiss">×</button>
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

/* ------------------------------------------------------------- CENTER · feed */
function paintFeed(root, shared, ctx, reload) {
  const host = root.querySelector("[data-feed]");
  const events = [...buildEvents(shared.data, ctx), ...buildLikeNotifications(shared, ctx)]
    .sort((a, b) => new Date(b.ts) - new Date(a.ts));

  host.innerHTML = events.length
    ? events.map((e) => eventCardHTML(e, ctx)).join("")
    : `<div class="feed-empty patch">
         <p>your feed is quiet.</p>
         <p class="faint">join or create a club, set a book, and activity from every club you're in will show up here.</p>
       </div>`;

  wireGo(host);
  wireEngagementUI(host, reload);
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
  const { data, replies, engagements } = shared;
  const engByTarget = groupBy(engagements, "target_id");
  const pById = {};
  for (const d of data) {
    for (const m of d.members) if (m.profile) pById[m.user_id] = m.profile;
    for (const r of d.reactions) if (r.profile) pById[r.user_id] = r.profile;
  }
  for (const r of replies) if (r.profile) pById[r.user_id] = r.profile;
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

  // Things I authored, with a human label (already escaped) for the notification.
  const mine = [];
  for (const d of data) {
    if (d.book && d.book.picked_by === me) mine.push({ id: d.book.id, label: `your pick — ${esc(d.book.title)}` });
    for (const r of d.reactions) if (r.user_id === me) {
      mine.push({ id: r.id, label: `your reaction on ${esc(d.book?.title || d.club.name)}` });
    }
    for (const p of d.progress) if (p.user_id === me) mine.push({ id: p.id, label: "your reading update" });
  }
  for (const r of replies) if (r.user_id === me) mine.push({ id: r.id, label: "your reply" });

  const events = [];
  for (const m of mine) {
    const likes = likesByTarget[m.id];
    if (!likes?.length) continue;
    const names = likes.map((l) => ctx.nameOf(l.user_id));
    const ts = likes.reduce((mx, l) => Math.max(mx, new Date(l.created_at).getTime()), 0);
    events.push({ kind: "notif", ts: new Date(ts).toISOString(), icon: "👍",
      text: `${likeLabel(names)} liked ${m.label}` });
  }
  return events;
}

function likeLabel(names) {
  if (names.length === 1) return esc(names[0]);
  if (names.length === 2) return `${esc(names[0])} and ${esc(names[1])}`;
  return `${esc(names[0])} <span class="faint">(and ${names.length - 1} others)</span>`;
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
        targetType: "book", targetId: book.id,
      });

      for (const r of reactions) {
        events.push({ kind: "reaction", ts: r.created_at, reaction: r, where,
          go: `/club/${club.id}/book/${book.id}` });
      }

      for (const p of progress) {
        const name = p.user_id === me ? "You" : (p.profile?.display_name || "A reader");
        const go = `/club/${club.id}/book/${book.id}`;
        const t = { targetType: "progress", targetId: p.id };
        if (p.status === "finished") {
          events.push({ kind: "notif", ts: p.finished_at || p.updated_at, icon: "🎉",
            text: `${esc(name)} finished ${esc(book.title)}`, go, ...t });
        } else if (p.status === "reading" && p.current_page > 0) {
          const of = book.page_count ? ` of ${book.page_count}` : "";
          events.push({ kind: "notif", ts: p.updated_at, icon: "📖",
            text: `${esc(name)} read to page ${p.current_page}${of} of ${esc(book.title)}`, go, ...t });
        } else if (p.status === "reading" || p.started_at) {
          events.push({ kind: "notif", ts: p.started_at || p.updated_at, icon: "🔖",
            text: `${esc(name)} started ${esc(book.title)}`, go, ...t });
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
      const t = { targetType: "selection", targetId: s.id };
      if (s.status === "open") {
        events.push({ kind: "notif", ts: s.created_at, icon: "🗳️", highlight: true,
          text: `A vote opened in ${esc(club.name)} — pick who chooses next`,
          go: `/club/${club.id}/picker`, ...t });
      } else if (s.status === "decided") {
        const winner = members.find((m) => m.user_id === s.result_user)?.profile?.display_name;
        events.push({ kind: "notif", ts: s.decided_at || s.created_at, icon: "🎯",
          text: winner ? `${esc(winner)} will pick the next book for ${esc(club.name)}`
                       : `${esc(club.name)} decided who picks next`,
          go: `/club/${club.id}/history`, ...t });
      }
    }
  }
  return events;
}

function eventCardHTML(e, ctx) {
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
        <div class="card-foot">
          ${engagementBarHTML("reaction", r.id, ctx.engOf(r.id), ctx.nameOf, ctx.myId)}
          ${replyThreadHTML(r.id, ctx.repliesByReaction[r.id] || [], ctx.engOf, ctx.nameOf, ctx.myId)}
        </div>
      </article>`;
  }
  // notification (activity) card — likeable when backed by a real row.
  const goAttr = e.go ? ` data-go="${e.go}"` : "";
  const bar = e.targetId
    ? `<div class="card-foot">${engagementBarHTML(e.targetType, e.targetId, ctx.engOf(e.targetId), ctx.nameOf, ctx.myId)}</div>`
    : "";
  return `
    <article class="feed-item notif-card ${e.highlight ? "notif-highlight" : ""}"${goAttr}>
      <span class="notif-icon" aria-hidden="true">${e.icon}</span>
      <div class="notif-main">
        <p class="notif-text">${e.text}</p>
        <span class="notif-time faint">${timeAgo(e.ts)}</span>
        ${bar}
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
