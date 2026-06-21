// App entry: boot auth, set up the nav bar + routes, then resolve the route.
import { supabase, ENV_NAME } from "./supabaseClient.js";
import { getSession, onAuthChange, signOut } from "./auth.js";
import { store, setAuth } from "./store.js";
import * as api from "./api.js";
import { route, setNotFound, startRouter, resolve, navigate, currentPath } from "./router.js";
import { $, avatarHTML, esc, toast } from "./ui.js";

import { renderLogin } from "./views/login.js";
import { renderFeed } from "./views/feed.js";
import { renderProgress } from "./views/progress.js";
import { renderClubs } from "./views/clubs.js";
import { renderClub } from "./views/club.js";
import { renderBook } from "./views/book.js";
import { renderPicker } from "./views/picker.js";
import { renderHistory } from "./views/history.js";
import { renderProfile } from "./views/profile.js";

// ---- routes ----
route("/feed", renderFeed);
route("/progress", renderProgress);
route("/clubs", renderClubs);
route("/club/:id", renderClub);
route("/club/:id/picker", renderPicker);
route("/club/:id/history", renderHistory);
route("/club/:id/book/:bookId", renderBook);
route("/profile", renderProfile);
setNotFound(() => navigate("/feed"));

// ---- nav bar ----
// Desktop uses the top header; mobile uses the bottom tab bar. Both are gated on
// auth and both carry [data-nav] buttons wired by wireNav().
function paintNav() {
  const bar = $("[data-nav-bar]");
  const tabs = $("[data-tabbar]");
  if (!store.user) { bar.hidden = true; if (tabs) tabs.hidden = true; return; }
  bar.hidden = false;
  if (tabs) tabs.hidden = false;
  $("[data-nav-name]").textContent = store.profile?.display_name || "me";
  $("[data-nav-avatar]").innerHTML = avatarHTML(store.profile, 24);
  paintTabs();
}

// Highlight the bottom tab matching the current route. Club/book/picker/history
// pages all live under the Clubs tab; the OAuth landing falls through to Feed.
function paintTabs() {
  const path = currentPath();
  let active = "feed";
  if (path.startsWith("/clubs") || path.startsWith("/club/")) active = "clubs";
  else if (path.startsWith("/progress")) active = "progress";
  else if (path.startsWith("/profile")) active = "profile";
  document.querySelectorAll("[data-tab]").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === active));
}

function wireNav() {
  document.querySelectorAll("[data-nav]").forEach((b) => {
    if (b.dataset.wired) return;
    b.dataset.wired = "1";
    b.addEventListener("click", () => {
      const t = b.dataset.nav;
      if (t === "feed") navigate("/feed");
      else if (t === "progress") navigate("/progress");
      else if (t === "clubs") navigate("/clubs");
      else if (t === "profile") navigate("/profile");
    });
  });
  document.querySelectorAll("[data-action='signout']").forEach((so) => {
    if (so.dataset.wired) return;
    so.dataset.wired = "1";
    so.addEventListener("click", signOut);
  });
  document.addEventListener("profile-updated", paintNav);
  window.addEventListener("hashchange", paintTabs);
}

// ---- boot ----
async function boot() {
  if (ENV_NAME === "dev") console.info("[env] running against DEV Supabase");

  let session = await getSession();

  const apply = async (s) => {
    if (s?.user) {
      let profile = null;
      try { profile = await api.getProfile(s.user.id); } catch { /* trigger may lag */ }
      setAuth(s, s.user, profile);
      paintNav();
      // After OAuth, Supabase may leave a "#access_token=..." fragment that
      // isn't one of our routes. Anything not starting with "#/" -> feed (home).
      const h = window.location.hash;
      if (!h.startsWith("#/")) navigate("/feed");
      else resolve();
    } else {
      setAuth(null, null, null);
      paintNav();
      renderLogin();
    }
  };

  wireNav();
  startRouter();
  onAuthChange((s) => { session = s; apply(s); });
  await apply(session);
}

boot().catch((err) => {
  console.error(err);
  document.getElementById("app").innerHTML =
    `<div class="login-screen"><div class="login-card patch">
      <h1 class="stamp-title">setup needed</h1>
      <p class="login-blurb">Couldn't start the app: ${esc(err.message || err)}</p>
      <p class="faint">Check that your Supabase URL + anon key are set in <code>config.js</code>.</p>
    </div></div>`;
});
