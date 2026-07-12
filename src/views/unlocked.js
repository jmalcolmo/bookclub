// "Unlocked reactions" - the notification layer on top of the spoiler gate.
// When a reader bumps their progress past a page, other members' reactions in
// the crossed pages become visible (the gate opens); setProgress records those
// as unseen `reaction_unlocks`. They surface in the feed's ✨ Unlocked tab
// (src/views/feed.js), which renders them through the same card painter as the
// mixed feed - this module carries just the moment-of-unlock toast that points
// there. Everything stays RLS-gated; nothing hidden can ever appear.
import { navigate } from "../router.js";

// The moment-of-unlock banner, shown as an actionable toast after a progress
// bump that opened ≥1 reaction. "View →" opens the feed's Unlocked tab (which
// marks the rows seen). Mirrors the toast() DOM but carries an action link.
export function unlockToast(count) {
  const host = document.querySelector("[data-toast-container]");
  if (!host || !count) return;
  const t = document.createElement("div");
  t.className = "toast toast-unlock show";
  const label = count === 1 ? "1 reaction unlocked" : `${count} reactions unlocked`;
  t.innerHTML = `<span>✨ ${label} while you were away.</span>
    <button class="unlock-toast-view" type="button">View →</button>`;
  t.querySelector(".unlock-toast-view").addEventListener("click", () => {
    t.remove();
    navigate("/feed/unlocked");
  });
  host.appendChild(t);
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, 6000);
}
