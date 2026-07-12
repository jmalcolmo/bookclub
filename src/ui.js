// Small DOM + formatting helpers shared across views.

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Escape user-provided text before injecting into innerHTML templates.
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// Deterministic yarn color from a string (for default avatars).
const YARNS = [
  "#b8a058", "#7a9068", "#a05838", "#587888",
  "#886878", "#607050", "#987860", "#483828",
];
export function colorFor(str) {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return YARNS[h % YARNS.length];
}

// Resolve a --yarn-* accent name to its hex (for inline styles where a CSS var
// won't do, e.g. canvas/avatar backgrounds). Mirrors the tokens in styles.css.
const ACCENT_HEX = {
  "yarn-ochre": "#b8a058", "yarn-sage": "#7a9068", "yarn-rust": "#a05838",
  "yarn-slate": "#587888", "yarn-mauve": "#886878", "yarn-bark": "#483828",
  "yarn-moss": "#607050", "yarn-clay": "#987860",
};
export function accentHex(accent) { return ACCENT_HEX[accent] || ACCENT_HEX["yarn-sage"]; }

export function initials(name) {
  return String(name || "?")
    .trim().split(/\s+/).slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "").join("") || "?";
}

// Club initials: strip leading emoji/symbols (club names often start with one)
// then take the first letters of the first two real words. "📚 The Tuesday
// Pages" -> "TP".
export function clubInitials(name) {
  const cleaned = String(name || "").replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
  return initials(cleaned || name);
}

// A club "granny-square" avatar: uploaded photo if present, else the club's
// initials on its accent color. `bg` is the resolved accent hex (callers know it).
export function clubAvatarHTML(club, size = 48, bg) {
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px`;
  if (club?.photo_url) {
    return `<span class="club-avatar" style="${style};background-image:url('${esc(club.photo_url)}')"></span>`;
  }
  const color = bg || colorFor(club?.name || "club");
  return `<span class="club-avatar" style="${style};background:${color}">${esc(clubInitials(club?.name))}</span>`;
}

// Renders an avatar chip: photo if available, otherwise initials on a yarn color.
export function avatarHTML(profile, size = 36) {
  const name = profile?.display_name || "Reader";
  const url = profile?.avatar_url;
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px`;
  if (url) {
    return `<span class="avatar" style="${style};background-image:url('${esc(url)}')"></span>`;
  }
  return `<span class="avatar" style="${style};background:${colorFor(name)}">${esc(initials(name))}</span>`;
}

// Instagram-style profile links: any avatar/name pair can be a door to that
// reader's profile. userLinkHTML wraps the markup in a chip carrying
// data-user-link; views call wireUserLinks() after painting. Falls back to the
// bare markup when there's no user id to link to.
export function userLinkHTML(userId, inner, name = "Reader") {
  if (!userId) return inner;
  return `<span class="user-link" data-user-link="${esc(userId)}" role="link" tabindex="0"
    aria-label="View ${esc(name)}'s profile">${inner}</span>`;
}

// Wire every [data-user-link] in scope to navigate to that reader's profile.
// stopPropagation keeps the click from also triggering a card's data-go
// navigation. Assigning location.hash directly avoids a ui.js -> router.js
// import cycle (router already imports toast from here).
export function wireUserLinks(scope) {
  scope.querySelectorAll("[data-user-link]").forEach((el) => {
    if (el.dataset.wiredUser) return;
    el.dataset.wiredUser = "1";
    const go = (e) => {
      e.stopPropagation();
      window.location.hash = `/user/${el.dataset.userLink}`;
    };
    el.addEventListener("click", go);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(e); }
    });
  });
}

export function toast(msg, kind = "info") {
  const host = $("[data-toast-container]");
  if (!host) return;
  const t = document.createElement("div");
  t.className = `toast toast-${kind}`;
  t.textContent = msg;
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, 3200);
}

export function timeAgo(ts) {
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 604800) return `${Math.floor(d / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function fmtDate(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

// Days until a deadline; negative = overdue.
export function daysUntil(ts) {
  if (!ts) return null;
  return Math.ceil((new Date(ts).getTime() - Date.now()) / 86400000);
}
