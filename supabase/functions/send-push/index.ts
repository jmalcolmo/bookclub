// send-push — Supabase Edge Function that delivers an APNs push in two cases:
//
//   1. PROGRESS UPDATE. Fire it as a Database Webhook on INSERT/UPDATE of
//      public.reading_progress. The webhook posts the changed row; we notify the
//      OTHER members of that book's club that someone made progress.
//
//   2. NEAR-DEADLINE / UNFINISHED CHECK. Invoke it on a schedule (pg_cron or the
//      dashboard scheduler) with body {"mode":"deadline-check"}. It finds books
//      whose deadline is within the next 24h and notifies members who have NOT
//      finished them.
//
// Auth to the DB uses the service-role key (bypasses RLS) so we can read every
// member's device token — that key is a Supabase-provided secret, never RLS.
// APNs auth uses the .p8 provider key from env (see _shared/apns.ts). Nothing is
// hardcoded; if secrets are missing the function returns a clear error.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apnsConfigFromEnv, sendPush } from "../_shared/apns.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// Look up every device token for a set of user ids, then fan a push out to each.
async function pushToUsers(
  db: ReturnType<typeof admin>,
  userIds: string[],
  payload: { title: string; body: string },
) {
  if (userIds.length === 0) return { sent: 0, results: [] as unknown[] };
  const { data: tokens, error } = await db
    .from("device_tokens")
    .select("token, environment")
    .in("user_id", Array.from(new Set(userIds)));
  if (error) throw error;

  const cfg = apnsConfigFromEnv();
  const results = [];
  for (const t of tokens ?? []) {
    const env = t.environment === "production" ? "production" : "sandbox";
    results.push(await sendPush(cfg, t.token, payload, env));
  }
  return { sent: results.filter((r: any) => r.ok).length, results };
}

// --- mode 1: a reading_progress row changed (DB webhook) ---------------------
async function handleProgressWebhook(record: any) {
  const db = admin();
  // The book's club, so we can find co-members to notify (everyone but the actor).
  const { data: book } = await db
    .from("books")
    .select("id, club_id, title")
    .eq("id", record.book_id)
    .single();
  if (!book) return { skipped: "book not found" };

  const { data: members } = await db
    .from("club_members")
    .select("user_id")
    .eq("club_id", book.club_id);

  const recipients = (members ?? [])
    .map((m: any) => m.user_id)
    .filter((uid: string) => uid !== record.user_id);

  const title = "Reading Room";
  const body = record.status === "finished"
    ? `Someone finished “${book.title}”.`
    : `Someone made progress on “${book.title}”.`;

  return await pushToUsers(db, recipients, { title, body });
}

// --- mode 2: near-deadline / unfinished check (scheduled) --------------------
async function handleDeadlineCheck() {
  const db = admin();
  const now = new Date();
  const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const { data: books } = await db
    .from("books")
    .select("id, club_id, title, deadline")
    .not("deadline", "is", null)
    .gte("deadline", now.toISOString())
    .lte("deadline", soon.toISOString());

  let totalSent = 0;
  const perBook = [];
  for (const book of books ?? []) {
    const { data: members } = await db
      .from("club_members")
      .select("user_id")
      .eq("club_id", book.club_id);

    const { data: finished } = await db
      .from("reading_progress")
      .select("user_id")
      .eq("book_id", book.id)
      .eq("status", "finished");
    const finishedSet = new Set((finished ?? []).map((r: any) => r.user_id));

    const laggards = (members ?? [])
      .map((m: any) => m.user_id)
      .filter((uid: string) => !finishedSet.has(uid));

    const { sent } = await pushToUsers(db, laggards, {
      title: "Reading Room",
      body: `“${book.title}” is due soon — you haven't finished yet.`,
    });
    totalSent += sent;
    perBook.push({ book: book.id, notified: laggards.length, sent });
  }
  return { mode: "deadline-check", books: (books ?? []).length, totalSent, perBook };
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json().catch(() => ({}));

    // Scheduled deadline sweep.
    if (payload?.mode === "deadline-check") {
      return json(await handleDeadlineCheck());
    }

    // Database Webhook shape: { type, table, record, old_record, ... }.
    if (payload?.table === "reading_progress" && payload?.record) {
      return json(await handleProgressWebhook(payload.record));
    }

    return json({ error: "unrecognized payload; expected a reading_progress webhook or {\"mode\":\"deadline-check\"}" }, 400);
  } catch (err) {
    return json({ error: String((err as Error).message ?? err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
