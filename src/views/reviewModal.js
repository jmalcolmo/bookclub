// Instant review modal - opens right after a reader marks a book finished
// (both My Progress and the book page call this) and from the "★ review"
// button on a finished progress card. Same star row + textarea as the
// book-page review form, saved through api.saveReview. Reviews stay
// finished-gated server-side; this modal only opens for readers whose own
// status is finished, and RLS rejects the write if that ever isn't true.
// Dismissing is always fine - the book-page form remains the fallback.
import { esc, toast } from "../ui.js";
import * as api from "../api.js";
import { openModal, closeModal } from "./clubs.js";

export async function openReviewModal(book, { onSaved } = {}) {
  let existing = null;
  try { existing = await api.myReview(book.id); } catch { /* fresh form */ }

  const r = existing?.rating || 0;
  const stars = [1, 2, 3, 4, 5].map((n) =>
    `<button type="button" class="star ${n <= r ? "on" : ""}" data-star="${n}"
      aria-label="${n} star${n === 1 ? "" : "s"}" aria-pressed="${n <= r}">★</button>`).join("");

  openModal(`
    <h3>${existing ? "Your review" : "You finished it! 🎉"}</h3>
    <form data-form class="modal-body review-form">
      <p class="faint">${existing
        ? `Update your take on <strong>${esc(book.title)}</strong>.`
        : `How was <strong>${esc(book.title)}</strong>? Rate it and leave your overall take.`}</p>
      <div class="star-row" data-stars>${stars}<input type="hidden" name="rating" value="${r}"></div>
      <textarea name="body" rows="3" maxlength="1200"
        placeholder="your overall take on the book…">${esc(existing?.body || "")}</textarea>
      <div class="modal-actions">
        <button type="button" class="btn-ghost" data-close>maybe later</button>
        <button type="submit" class="btn-primary">${existing ? "Update review" : "Post review"}</button>
      </div>
    </form>
  `, (m) => {
    const starsHost = m.querySelector("[data-stars]");
    starsHost.querySelectorAll("[data-star]").forEach((s) => s.addEventListener("click", () => {
      const v = Number(s.dataset.star);
      starsHost.querySelector("[name='rating']").value = v;
      starsHost.querySelectorAll("[data-star]").forEach((x) => {
        const on = Number(x.dataset.star) <= v;
        x.classList.toggle("on", on);
        x.setAttribute("aria-pressed", String(on));
      });
    }));
    m.querySelector("[data-form]").addEventListener("submit", async (e) => {
      e.preventDefault();
      const rating = Number(e.target.rating.value) || null;
      const body = e.target.body.value.trim();
      // Nothing entered = same as "maybe later"; don't upsert an empty review.
      if (!rating && !body) { closeModal(); return; }
      try {
        await api.saveReview(book.id, rating, body);
        closeModal();
        toast("Review saved", "success");
        onSaved?.();
      } catch (err) { toast(err.message, "error"); }
    });
  });
}
