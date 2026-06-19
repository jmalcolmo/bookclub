import { render, navigate } from "../router.js";
import { esc, toast, avatarHTML, colorFor } from "../ui.js";
import { store } from "../store.js";
import * as api from "../api.js";

export async function renderPicker({ params }) {
  const clubId = params.id;
  render(`<div class="screen-pad"><p class="faint">loading…</p></div>`);
  const [club, members, open] = await Promise.all([
    api.getClub(clubId), api.clubMembers(clubId), api.openSelections(clubId),
  ]);

  const openVote = open.find((s) => s.method === "vote");
  if (openVote) return renderVote({ clubId, club, members, selection: openVote });

  render(`
    <div class="screen-pad picker-screen">
      <div class="screen-header">
        <button class="btn-back" data-nav="club">← ${esc(club.name)}</button>
        <h2 class="stamp-title small">WHO PICKS NEXT?</h2><span></span>
      </div>
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
    root.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => {
      root.querySelectorAll("[data-m]").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      const stage = root.querySelector("[data-stage]");
      const m = b.dataset.m;
      if (m === "wheel") wheelStage(stage, { clubId, members });
      else if (m === "pick") pickStage(stage, { clubId, members });
      else if (m === "vote") startVoteStage(stage, { clubId });
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

function wheelStage(stage, { clubId, members }) {
  const n = members.length;
  const seg = 360 / n;
  const grad = members.map((m, i) =>
    `${colorFor(m.profile?.display_name || m.user_id)} ${i * seg}deg ${(i + 1) * seg}deg`).join(", ");
  const labels = members.map((m, i) =>
    `<span class="wheel-label" style="transform:rotate(${i * seg + seg / 2}deg)">
       <span style="transform:rotate(90deg)">${esc((m.profile?.display_name || "?").split(" ")[0])}</span></span>`).join("");

  stage.innerHTML = `
    <div class="wheel-wrap">
      <div class="wheel-pointer">▼</div>
      <div class="wheel" data-wheel style="background:conic-gradient(${grad})">${labels}</div>
    </div>
    <button class="btn-primary big" data-spin>Spin</button>
    <div data-out></div>`;

  const wheel = stage.querySelector("[data-wheel]");
  stage.querySelector("[data-spin]").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    const winIdx = Math.floor(Math.random() * n);
    const turns = 5 + Math.random() * 2;
    // pointer at top (0deg). Land middle of winning segment under pointer.
    const target = turns * 360 + (360 - (winIdx * seg + seg / 2));
    wheel.style.transition = "transform 4.5s cubic-bezier(.17,.67,.12,.99)";
    wheel.style.transform = `rotate(${target}deg)`;
    setTimeout(async () => {
      const winner = members[winIdx];
      try {
        const sel = await api.createSelection(clubId, "wheel");
        await api.decideSelection(sel.id, winner.user_id);
      } catch (err) { toast(err.message, "error"); }
      const out = stage.querySelector("[data-out]");
      out.innerHTML = resultBanner(winner.profile);
      out.querySelector("[data-result-done]").addEventListener("click", () => navigate(`/club/${clubId}`));
    }, 4700);
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
    window.addEventListener("hashchange", function off() { unsub(); window.removeEventListener("hashchange", off); });

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
