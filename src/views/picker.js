import { render, navigate, onCleanup } from "../router.js";
import { esc, toast, avatarHTML, colorFor } from "../ui.js";
import { store } from "../store.js";
import * as api from "../api.js";

export async function renderPicker({ params }) {
  const clubId = params.id;
  render(`<div class="screen-pad"><p class="faint">loading…</p></div>`);
  const [club, members, open] = await Promise.all([
    api.getClub(clubId), api.clubMembers(clubId), api.openSelections(clubId),
  ]);

  // If a vote is already in progress, surface it as a resumable banner — but
  // still show the method options so "Pick next reader" never skips the choice.
  const openVote = open.find((s) => s.method === "vote");

  render(`
    <div class="screen-pad picker-screen">
      <div class="screen-header">
        <button class="btn-back" data-nav="club">← ${esc(club.name)}</button>
        <h2 class="stamp-title small">WHO PICKS NEXT?</h2><span></span>
      </div>
      ${openVote ? `
        <div class="parked-note patch">
          <p>🗳️ A vote is already in progress.</p>
          <button class="btn-primary" data-goto-vote>Go to the open vote →</button>
        </div>` : ""}
      <p class="faint center">choose how your club decides who picks the next book.</p>
      <div class="method-grid">
        <button class="method-card patch" data-m="wheel">
          <span class="method-emoji">🎡</span><span class="method-name">Spin the Wheel</span>
          <span class="method-desc">random spin lands on one member</span></button>
        <button class="method-card patch" data-m="vote">
          <span class="method-emoji">🗳️</span><span class="method-name">Hold a Vote</span>
          <span class="method-desc">everyone votes; most votes wins</span></button>
        <button class="method-card patch" data-m="pick">
          <span class="method-emoji">👉</span><span class="method-name">Just Pick</span>
          <span class="method-desc">choose a member directly</span></button>
        <button class="method-card patch method-parked" data-m="race">
          <span class="method-emoji">🔮</span><span class="method-name">Marble Race</span>
          <span class="method-desc">the classic — being rebuilt</span></button>
      </div>
      <div data-stage class="picker-stage"></div>
    </div>
  `, (root) => {
    root.querySelector("[data-nav='club']").addEventListener("click", () => navigate(`/club/${clubId}`));
    root.querySelector("[data-goto-vote]")?.addEventListener("click", () =>
      renderVote({ clubId, club, members, selection: openVote }));
    root.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => {
      root.querySelectorAll("[data-m]").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      const stage = root.querySelector("[data-stage]");
      const m = b.dataset.m;
      if (m === "wheel") wheelStage(stage, { clubId, members });
      else if (m === "pick") pickStage(stage, { clubId, members });
      // Resume an existing open vote rather than opening a duplicate.
      else if (m === "vote") {
        if (openVote) renderVote({ clubId, club, members, selection: openVote });
        else startVoteStage(stage, { clubId });
      }
      else raceStage(stage);
    }));
  });
}

function resultBanner(profile) {
  return `<div class="picker-result patch">
    ${avatarHTML(profile, 72)}
    <h3 class="result-name">${esc(profile?.display_name || "Reader")}</h3>
    <p class="result-sub">picks the next book!</p>
    <button class="btn-primary" data-result-done>Back to club →</button>
  </div>`;
}

// Geometry for the SVG wheel. viewBox is 200×200, centered at (100,100).
const WHEEL = { cx: 100, cy: 100, r: 94, labelR: 58 };

// Point on a circle at an angle measured CLOCKWISE from the top (12 o'clock),
// which is where the pointer sits. Shared by slice paths and label placement so
// they can never drift apart.
function wheelPoint(r, deg) {
  const a = (deg * Math.PI) / 180;
  return [WHEEL.cx + r * Math.sin(a), WHEEL.cy - r * Math.cos(a)];
}

function wheelName(m) {
  const first = (m.profile?.display_name || "Reader").trim().split(/\s+/)[0];
  return first.length > 11 ? first.slice(0, 10) + "…" : first;
}

// Draw the whole wheel as one SVG so slices and labels live in the same
// coordinate system — the old bug was slices and labels using separate layouts.
// The <svg data-wheel> element is what we later spin.
function wheelSVG(members) {
  const n = members.length;
  const seg = 360 / n;
  const { cx, cy, r, labelR } = WHEEL;

  const slices = members.map((m, i) => {
    const fill = colorFor(m.profile?.display_name || m.user_id);
    const mid = i * seg + seg / 2;
    // Single member: a full circle can't be drawn as one arc — use a disc.
    let shape;
    if (n === 1) {
      shape = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
    } else {
      const [x0, y0] = wheelPoint(r, i * seg);
      const [x1, y1] = wheelPoint(r, (i + 1) * seg);
      const large = seg > 180 ? 1 : 0;
      shape = `<path d="M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${fill}"/>`;
    }
    // Label sits on the slice's mid radius. Rotate it to read outward; flip the
    // bottom-half labels 180° (in place) so they stay upright, not upside-down.
    const flip = mid > 90 && mid < 270;
    const rot = flip ? mid + 180 : mid;
    const [lx, ly] = wheelPoint(labelR, mid);
    const label = `<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" class="wheel-label"
      text-anchor="middle" dominant-baseline="central"
      transform="rotate(${rot.toFixed(2)} ${lx.toFixed(2)} ${ly.toFixed(2)})">${esc(wheelName(m))}</text>`;
    return shape + label;
  }).join("");

  // We spin the whole <svg> element (a replaced element that transitions
  // reliably); CSS transforms on inner <g> nodes don't animate in some browsers.
  return `
    <div class="wheel-wrap">
      <div class="wheel-pointer">▼</div>
      <svg class="wheel-svg" data-wheel viewBox="0 0 200 200" aria-hidden="true">
        ${slices}
        <circle cx="${cx}" cy="${cy}" r="${r}" class="wheel-rim"/>
        <circle cx="${cx}" cy="${cy}" r="13" class="wheel-hub"/>
      </svg>
    </div>`;
}

function wheelStage(stage, { clubId, members }) {
  const n = members.length;
  const seg = 360 / n;

  stage.innerHTML = `
    ${wheelSVG(members)}
    <button class="btn-primary big" data-spin>Spin</button>
    <div data-out></div>`;

  const wheel = stage.querySelector("[data-wheel]");
  stage.querySelector("[data-spin]").addEventListener("click", (e) => {
    e.currentTarget.disabled = true;

    // Pick a random resting rotation with several full turns of drama, landing a
    // slice CENTER exactly under the pointer at the top.
    const target = Math.floor(Math.random() * n);
    const turns = 5 + Math.floor(Math.random() * 3);
    const rotation = turns * 360 + (360 - (target * seg + seg / 2));

    // The winner is whatever slice ends up under the pointer — derived straight
    // from the final rotation so the announced name always matches the marker.
    const localAtTop = ((-rotation) % 360 + 360) % 360;
    const winIdx = Math.floor(localAtTop / seg) % n;
    const winner = members[winIdx];

    const SPIN_MS = 4800;
    wheel.style.transition = `transform ${SPIN_MS}ms cubic-bezier(.17,.67,.12,.99)`;
    wheel.style.transform = `rotate(${rotation}deg)`;

    // Fire on a timer matching the animation — transitionend is unreliable for
    // SVG transforms across browsers, so don't depend on it.
    setTimeout(async () => {
      try {
        const sel = await api.createSelection(clubId, "wheel");
        await api.decideSelection(sel.id, winner.user_id);
      } catch (err) { toast(err.message, "error"); }
      const out = stage.querySelector("[data-out]");
      out.innerHTML = resultBanner(winner.profile);
      out.querySelector("[data-result-done]").addEventListener("click", () => navigate(`/club/${clubId}`));
    }, SPIN_MS + 150);
  });
}

function pickStage(stage, { clubId, members }) {
  stage.innerHTML = `
    <p class="faint center">tap whoever should pick next.</p>
    <div class="pick-grid">
      ${members.map((m) => `<button class="pick-chip" data-uid="${m.user_id}">
        ${avatarHTML(m.profile, 44)}<span>${esc(m.profile?.display_name || "Reader")}</span></button>`).join("")}
    </div>
    <div data-out></div>`;
  stage.querySelectorAll("[data-uid]").forEach((b) => b.addEventListener("click", async () => {
    const m = members.find((x) => x.user_id === b.dataset.uid);
    try {
      const sel = await api.createSelection(clubId, "pick");
      await api.decideSelection(sel.id, m.user_id);
    } catch (err) { toast(err.message, "error"); }
    const out = stage.querySelector("[data-out]");
    out.innerHTML = resultBanner(m.profile);
    out.querySelector("[data-result-done]").addEventListener("click", () => navigate(`/club/${clubId}`));
  }));
}

function startVoteStage(stage, { clubId }) {
  stage.innerHTML = `
    <p class="faint center">open a vote — everyone in the club can cast one vote.</p>
    <button class="btn-primary big" data-open-vote>Open the vote</button>`;
  stage.querySelector("[data-open-vote]").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    try { await api.openVote(clubId); navigate(`/club/${clubId}/picker`); }
    catch (err) { toast(err.message, "error"); e.currentTarget.disabled = false; }
  });
}

function raceStage(stage) {
  stage.innerHTML = `
    <div class="parked-note patch">
      <p>🔮 The marble race is being rebuilt and isn't wired into clubs yet.</p>
      <p class="faint">You can still play the classic standalone version.</p>
      <a class="btn-ghost" href="race.html">Open classic race ↗</a>
    </div>`;
}

// ---- live vote screen ----
async function renderVote({ clubId, club, members, selection }) {
  const isCreator = selection.created_by === store.user.id;
  render(`
    <div class="screen-pad picker-screen">
      <div class="screen-header">
        <button class="btn-back" data-nav="club">← ${esc(club.name)}</button>
        <h2 class="stamp-title small">VOTE: WHO PICKS NEXT?</h2><span></span>
      </div>
      <p class="faint center">tap a member to cast (or change) your vote.</p>
      <div class="vote-grid" data-vote-grid></div>
      ${isCreator ? `<div class="center"><button class="btn-primary" data-close-vote>Close vote &amp; crown winner</button></div>` : `<p class="faint center">waiting for the host to close the vote…</p>`}
      <div data-out></div>
    </div>
  `, (root) => {
    root.querySelector("[data-nav='club']").addEventListener("click", () => navigate(`/club/${clubId}`));
    const grid = root.querySelector("[data-vote-grid]");

    const paint = async () => {
      const votes = await api.selectionVotes(selection.id);
      const tally = {};
      votes.forEach((v) => (tally[v.candidate_id] = (tally[v.candidate_id] || 0) + 1));
      const mine = votes.find((v) => v.voter_id === store.user.id)?.candidate_id;
      grid.innerHTML = members.map((m) => {
        const c = tally[m.user_id] || 0;
        return `<button class="vote-chip ${mine === m.user_id ? "voted" : ""}" data-uid="${m.user_id}">
          ${avatarHTML(m.profile, 40)}
          <span class="vote-name">${esc(m.profile?.display_name || "Reader")}</span>
          <span class="vote-count">${c}</span></button>`;
      }).join("");
      grid.querySelectorAll("[data-uid]").forEach((b) => b.addEventListener("click", async () => {
        try { await api.castVote(selection.id, b.dataset.uid); paint(); }
        catch (err) { toast(err.message, "error"); }
      }));
    };
    paint();
    const unsub = api.subscribe(`votes-${selection.id}`, "selection_votes",
      `selection_id=eq.${selection.id}`, paint);
    onCleanup(unsub);

    root.querySelector("[data-close-vote]")?.addEventListener("click", async () => {
      const votes = await api.selectionVotes(selection.id);
      if (!votes.length) { toast("No votes cast yet", "error"); return; }
      const tally = {};
      votes.forEach((v) => (tally[v.candidate_id] = (tally[v.candidate_id] || 0) + 1));
      const winnerId = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
      const winner = members.find((m) => m.user_id === winnerId);
      try { await api.decideSelection(selection.id, winnerId); } catch (err) { toast(err.message, "error"); }
      const out = root.querySelector("[data-out]");
      out.innerHTML = resultBanner(winner?.profile);
      out.querySelector("[data-result-done]").addEventListener("click", () => navigate(`/club/${clubId}`));
    });
  });
}
