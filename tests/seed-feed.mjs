// ============================================================================
// The Reading Room — FEED SEEDER (DEV only)
// ----------------------------------------------------------------------------
// Populates the dev database with a believable, busy book club so the main feed
// looks like a real club: many members, a current book + finished history, lots
// of reading-progress at different points, lots of page-tagged reactions, plus
// reviews and picker history.
//
// Run:  npm run seed
//   (or: SUPABASE_SERVICE_ROLE="$(cat .passwords/dev-service-role.txt)" node tests/seed-feed.mjs)
//
// How it works:
//   * Uses the dev SERVICE_ROLE key, which BYPASSES RLS — so it can insert rows
//     on behalf of many fake users and set realistic timestamps. (The `test`
//     harness deliberately uses the anon key to exercise RLS; this is different:
//     it is a data generator, not a test.)
//   * Fixed fake users (stable plus-addressed emails) and a fixed demo club, so
//     re-running RESETS and reseeds the same club instead of piling up clutter.
//   * Adds your real Google account as the club OWNER with deep progress, so when
//     you sign in on the dev site you immediately see the whole populated feed
//     (RLS only shows a club to members, and the spoiler gate only unlocks
//     reactions up to YOUR logged page — deep progress unlocks them all).
//
// SAFE: refuses to run unless it is pointed at the DEV project.
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

// ---- config -----------------------------------------------------------------
const DEV_REF = "wwzvwjhohkyudytoqvfl";   // the ONLY project this may ever touch
const PROD_REF = "kxiyvqpmmfbibeoygmnw";  // explicitly forbidden
const URL = process.env.SUPABASE_URL || `https://${DEV_REF}.supabase.co`;
let SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || null;
if (!SERVICE_ROLE && existsSync(".passwords/dev-service-role.txt")) {
  SERVICE_ROLE = readFileSync(".passwords/dev-service-role.txt", "utf8").trim();
}

// The Supabase project a service_role key belongs to is encoded in its JWT `ref`
// claim — so we can prove the *credential* is dev, not just the endpoint URL.
function keyRef(jwt) {
  try {
    const p = JSON.parse(Buffer.from(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    return p.ref || null;
  } catch { return null; }
}

// The real account that should OWN the demo club and see the feed on sign-in.
const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL || "malcolm.olexa24@gmail.com";

// Stable identity for the demo club (found by exact name on reseed).
const CLUB_NAME = "📚 The Seed Society (demo)";
const CLUB_DESC = "An auto-generated demo club full of fake readers, so the feed looks alive. Reseed with `npm run seed`.";

if (!SERVICE_ROLE) {
  console.error(
    "\nNo service_role key. This seeder needs it to write as many users.\n" +
    "  Provide .passwords/dev-service-role.txt or set SUPABASE_SERVICE_ROLE.\n"
  );
  process.exit(2);
}
// ---- SAFETY: DEV ONLY — this seeder must NEVER touch production -------------
// Three independent gates, all of which must pass:
//   1. the endpoint URL is the dev project (and is not the prod project),
//   2. the service_role credential itself belongs to the dev project,
//   3. neither the URL nor the key references the prod project.
// To ever hit prod you'd need to deliberately supply BOTH a prod URL and a prod
// key — and gate 3 still refuses. Local dev seeding is the only thing allowed.
const kref = keyRef(SERVICE_ROLE);
function refuse(msg) {
  console.error(`\nREFUSING TO RUN — ${msg}\n` +
    `This seeder writes lots of fake data and may only target the DEV project (${DEV_REF}).\n`);
  process.exit(2);
}
if (URL.includes(PROD_REF) || kref === PROD_REF) refuse("this is the PRODUCTION project.");
if (!URL.includes(DEV_REF)) refuse(`endpoint ${URL} is not the dev project.`);
if (kref && kref !== DEV_REF) refuse(`the service_role key belongs to project "${kref}", not dev.`);

const db = createClient(URL, SERVICE_ROLE, { auth: { persistSession: false } });

// ---- tiny deterministic RNG (so reseeds look stable) ------------------------
let _s = 0xC0FFEE;
function rnd() { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 0xFFFFFFFF; }
const rint = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];
function sample(a, n) {
  const c = [...a];
  for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; }
  return c.slice(0, n);
}
const daysAgo = (d, jitterH = 0) =>
  new Date(Date.now() - d * 86400000 - rint(0, jitterH) * 3600000).toISOString();

function unwrap(label, { data, error }) {
  if (error) { console.error(`  ✗ ${label}: ${error.message}`); throw error; }
  return data;
}

// ---- fake cast --------------------------------------------------------------
const AVATAR = (name) =>
  `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(name)}`;

const CAST = [
  { name: "Priya Raman",     bio: "Two books going at all times. Annotates in pen, sorry." },
  { name: "Marcus Webb",     bio: "Here for the twists. Will gasp audibly." },
  { name: "Dana Okafor",     bio: "Sci-fi apologist. Cried at a spaceship once." },
  { name: "Theo Lindqvist",  bio: "Slow reader, strong opinions." },
  { name: "Joon-ho Park",    bio: "Reads the last page first. Don't @ me." },
  { name: "Camila Reyes",    bio: "Romance is plot. Fight me in the reactions." },
  { name: "Nadia Hassan",    bio: "Library-card maximalist. 14 holds deep." },
  { name: "Eli Brandt",      bio: "DNF king turned completionist." },
  { name: "Wei Chen",        bio: "Margin-note philosopher." },
  { name: "Grace Mbeki",     bio: "Audiobook at 1.75x, no regrets." },
];

// ---- book pool (metadata fetched live from Open Library) --------------------
// First entry becomes the CURRENT book; the rest become finished history.
const BOOKS = [
  { q: "project hail mary andy weir",            title: "Project Hail Mary",            author: "Andy Weir" },
  { q: "the left hand of darkness le guin",      title: "The Left Hand of Darkness",    author: "Ursula K. Le Guin" },
  { q: "piranesi susanna clarke",                title: "Piranesi",                     author: "Susanna Clarke" },
  { q: "klara and the sun ishiguro",             title: "Klara and the Sun",            author: "Kazuo Ishiguro" },
  { q: "the house in the cerulean sea klune",    title: "The House in the Cerulean Sea", author: "TJ Klune" },
  { q: "circe madeline miller",                  title: "Circe",                        author: "Madeline Miller" },
];

// ---- content pools ----------------------------------------------------------
const REACTIONS = [
  "Okay THAT chapter wrecked me. Had to put it down for a sec.",
  "Did not see that coming. Genuinely gasped on the train.",
  "I love how the prose just slows right down here.",
  "Anyone else suspicious of this character? Something's off.",
  "This is the part I'll be thinking about all week.",
  "Re-read this page three times. So good.",
  "Calling it now: this detail comes back later.",
  "The dialogue here is doing a LOT with very little.",
  "Cried. On a Tuesday. Over a book. Worth it.",
  "Pacing finally clicked for me around here.",
  "The worldbuilding payoff is unreal.",
  "Hmm, found this stretch a little slow honestly.",
  "Whoever picked this — thank you. Obsessed.",
  "The way that reveal recontextualizes everything earlier??",
  "Quietly devastating. Le Guin would be proud.",
  "Laughed out loud and then immediately felt bad about it.",
  "This is the kind of chapter you text a friend about.",
  "Underlined basically the whole page. Sorry, future me.",
  "Not me staying up til 2am because of this section.",
  "Okay the foreshadowing earlier makes SO much sense now.",
  "The restraint in this scene is the whole point I think.",
  "I changed my mind about this character completely.",
  "A++ no notes, this passage lives in my head now.",
  "Felt that one in my chest. Brutal in the best way.",
];
const REVIEWS = [
  "Stuck the landing. The kind of ending that makes you flip back to the start.",
  "Loved the ideas, the middle dragged a touch, but that finale earns it.",
  "Quietly one of my favorites this year. Will be pressing it on everyone.",
  "Smart and warm without being soft. Glad the club picked it.",
  "Beautiful prose, slightly cold characters. Still thinking about it though.",
  "Did exactly what it set out to do and broke my heart on schedule.",
  "A reread for sure. Caught a dozen things I missed the first time.",
  "Not perfect but wildly ambitious, and I'll take that every time.",
];

// ---- Open Library lookup ----------------------------------------------------
async function olLookup({ q, title, author }) {
  try {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}` +
      `&limit=1&fields=key,title,author_name,cover_i,number_of_pages_median`;
    const res = await fetch(url);
    const d = (await res.json()).docs?.[0] || {};
    return {
      title, author,
      open_library_id: d.key || null,
      cover_url: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
      page_count: d.number_of_pages_median || rint(280, 460),
    };
  } catch {
    return { title, author, open_library_id: null, cover_url: null, page_count: rint(280, 460) };
  }
}

// ---- ensure the fake auth users + their profiles ----------------------------
async function ensureCast() {
  // Build an email -> id map of existing auth users (paginate).
  const byEmail = new Map();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) byEmail.set((u.email || "").toLowerCase(), u.id);
    if (data.users.length < 1000) break;
  }

  const members = [];
  for (let i = 0; i < CAST.length; i++) {
    const c = CAST[i];
    const email = `malcolm.olexa24+seed${i + 1}@gmail.com`;
    let id = byEmail.get(email.toLowerCase());
    if (!id) {
      const { data, error } = await db.auth.admin.createUser({
        email, password: `S-${randomUUID()}`, email_confirm: true,
        user_metadata: { full_name: c.name, avatar_url: AVATAR(c.name) },
      });
      if (error) throw error;
      id = data.user.id;
    }
    // Make sure the public profile reads nicely (trigger may have defaulted it).
    unwrap(`profile ${c.name}`, await db.from("profiles").upsert({
      id, display_name: c.name, avatar_url: AVATAR(c.name), bio: c.bio,
    }, { onConflict: "id" }).select().single());
    members.push({ id, ...c });
  }

  const ownerId = byEmail.get(OWNER_EMAIL.toLowerCase()) || null;
  return { members, ownerId };
}

// ---- find or (re)create the demo club ---------------------------------------
async function ensureClub(ownerId, fallbackOwnerId) {
  const creator = ownerId || fallbackOwnerId;
  const existing = unwrap("find club",
    await db.from("clubs").select("*").eq("name", CLUB_NAME).limit(1)).at(0);

  let club;
  if (existing) {
    club = existing;
    // RESET: drop all activity but keep the club row (stable id + join code).
    unwrap("wipe books",      await db.from("books").delete().eq("club_id", club.id));
    unwrap("wipe selections", await db.from("selections").delete().eq("club_id", club.id));
    console.log(`  ↺ reset existing demo club (${club.join_code})`);
  } else {
    club = unwrap("create club", await db.from("clubs").insert({
      name: CLUB_NAME, description: CLUB_DESC, accent: "yarn-mauve",
      created_by: creator, deadlines_enabled: true, default_deadline_days: 21,
    }).select().single());
    console.log(`  ✓ created demo club (${club.join_code})`);
  }
  return club;
}

// ---- membership -------------------------------------------------------------
async function ensureMembers(club, members, ownerId) {
  const rows = members.map((m) => ({ club_id: club.id, user_id: m.id, role: "member" }));
  if (ownerId) rows.push({ club_id: club.id, user_id: ownerId, role: "creator" });
  unwrap("members", await db.from("club_members")
    .upsert(rows, { onConflict: "club_id,user_id" }));
}

// ---- the main seed ----------------------------------------------------------
async function main() {
  console.log(`\nThe Reading Room — feed seeder (dev)\n`);

  const { members, ownerId } = await ensureCast();
  console.log(`  ✓ ${members.length} fake readers ready` +
    (ownerId ? `, owner ${OWNER_EMAIL} found` : `, owner not found (sign in once on dev first)`));

  const club = await ensureClub(ownerId, members[0].id);
  await ensureMembers(club, members, ownerId);

  // Everyone who can post: fakes + (optionally) the real owner.
  const cast = ownerId ? [...members, { id: ownerId, name: "You" }] : members;

  // Resolve book metadata from Open Library.
  const meta = [];
  for (const b of BOOKS) meta.push(await olLookup(b));

  let nReactions = 0, nReviews = 0, nProgress = 0;

  for (let bi = 0; bi < meta.length; bi++) {
    const m = meta[bi];
    const isCurrent = bi === 0;
    const ageDays = isCurrent ? 12 : 30 + bi * 22; // history spreads into the past
    const picker = pick(members);

    const book = unwrap(`book ${m.title}`, await db.from("books").insert({
      club_id: club.id, title: m.title, author: m.author,
      cover_url: m.cover_url, open_library_id: m.open_library_id, page_count: m.page_count,
      picked_by: picker.id, status: isCurrent ? "current" : "finished",
      deadline: isCurrent ? daysAgo(-9) : null, // current book due in ~9 days
      created_at: daysAgo(ageDays),
      started_at: daysAgo(ageDays),
      finished_at: isCurrent ? null : daysAgo(ageDays - 18),
    }).select().single());

    const pages = m.page_count;

    // ---- reading progress: a believable spread across the club -------------
    const progressByUser = new Map();
    for (const u of cast) {
      let page, status, statusReading;
      if (u.id === ownerId) {
        // Make sure YOU see everything: deep on current, finished on history.
        page = isCurrent ? pages : pages;
        status = isCurrent ? "reading" : "finished";
      } else if (isCurrent) {
        const roll = rnd();
        if (roll < 0.12) { page = 0; status = "not_started"; }
        else if (roll < 0.78) { page = rint(Math.floor(pages * 0.2), Math.floor(pages * 0.85)); status = "reading"; }
        else { page = pages; status = "finished"; }
      } else {
        // Finished books: most finished, a few abandoned partway.
        if (rnd() < 0.85) { page = pages; status = "finished"; }
        else { page = rint(Math.floor(pages * 0.3), Math.floor(pages * 0.7)); status = "reading"; }
      }
      progressByUser.set(u.id, page);
      if (status === "not_started") continue;

      const updated = daysAgo(isCurrent ? rint(0, 9) : ageDays - rint(16, 20));
      unwrap("progress", await db.from("reading_progress").upsert({
        book_id: book.id, user_id: u.id, current_page: page, status,
        started_at: daysAgo(ageDays - 1),
        finished_at: status === "finished" ? updated : null,
        updated_at: updated,
      }, { onConflict: "book_id,user_id" }));
      nProgress++;
    }

    // ---- reactions: page-tagged, only from people who've read that far -----
    const count = isCurrent ? rint(18, 26) : rint(9, 14);
    for (let r = 0; r < count; r++) {
      // Choose a page, then an author who has actually read at least that far
      // (keeps the data internally consistent with the spoiler gate).
      const page = rint(5, pages);
      const eligible = cast.filter((u) => (progressByUser.get(u.id) || 0) >= page && u.id !== ownerId);
      if (!eligible.length) continue;
      const author = pick(eligible);
      unwrap("reaction", await db.from("reactions").insert({
        book_id: book.id, user_id: author.id, page, body: pick(REACTIONS),
        created_at: daysAgo(isCurrent ? rint(0, 11) : ageDays - rint(14, 22)),
      }));
      nReactions++;
    }

    // ---- reviews: finished books only, from finishers ----------------------
    if (!isCurrent) {
      const finishers = cast.filter((u) => progressByUser.get(u.id) === pages && u.id !== ownerId);
      for (const u of sample(finishers, rint(3, Math.max(3, finishers.length)))) {
        unwrap("review", await db.from("reviews").upsert({
          book_id: book.id, user_id: u.id, rating: rint(3, 5), body: pick(REVIEWS),
          created_at: daysAgo(ageDays - rint(12, 16)),
        }, { onConflict: "book_id,user_id" }));
        nReviews++;
      }
    }
  }

  // ---- picker history: a couple decided picks + one open vote --------------
  const decider = ownerId || members[0].id;
  for (const method of ["wheel", "pick"]) {
    unwrap("selection", await db.from("selections").insert({
      club_id: club.id, method, created_by: decider, status: "decided",
      result_user: pick(members).id,
      created_at: daysAgo(rint(25, 50)), decided_at: daysAgo(rint(25, 50)),
    }));
  }
  const vote = unwrap("vote", await db.from("selections").insert({
    club_id: club.id, method: "vote", created_by: decider, status: "open",
    created_at: daysAgo(2),
  }).select().single());
  const candidates = sample(members, 3);
  for (const voter of [...members, ...(ownerId ? [{ id: ownerId }] : [])]) {
    unwrap("cast vote", await db.from("selection_votes").upsert({
      selection_id: vote.id, voter_id: voter.id, candidate_id: pick(candidates).id,
    }, { onConflict: "selection_id,voter_id" }));
  }

  // ---- summary -------------------------------------------------------------
  console.log(`\n──────────────────────────────────────`);
  console.log(`  Club:       ${CLUB_NAME}`);
  console.log(`  Join code:  ${club.join_code}`);
  console.log(`  Members:    ${members.length} fake${ownerId ? " + you (owner)" : ""}`);
  console.log(`  Books:      1 current + ${meta.length - 1} finished`);
  console.log(`  Progress:   ${nProgress} rows`);
  console.log(`  Reactions:  ${nReactions}`);
  console.log(`  Reviews:    ${nReviews}`);
  console.log(`  Picker:     2 decided + 1 open vote`);
  if (ownerId) {
    console.log(`\n  → Sign in as ${OWNER_EMAIL} on the dev site and open "${CLUB_NAME}".`);
    console.log(`    Your progress is set deep, so the whole spoiler-gated feed is unlocked.`);
  } else {
    console.log(`\n  ⚠ ${OWNER_EMAIL} has never signed in to dev, so it isn't a real user yet.`);
    console.log(`    Sign in once via Google on the dev site, then rerun: npm run seed`);
    console.log(`    (or just join the club with the code above).`);
  }
  console.log(``);
}

main().catch((e) => { console.error("\nSeed failed:", e.message, "\n"); process.exit(1); });
