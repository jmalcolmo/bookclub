import { render } from "../router.js";
import { signInWithGoogle } from "../auth.js";
import { toast } from "../ui.js";

export function renderLogin() {
  render(`
    <div class="login-screen">
      <div class="login-card patch">
        <span class="login-mark">📚</span>
        <h1 class="stamp-title">THE READING ROOM</h1>
        <p class="subtitle">a book club, stitched together</p>
        <p class="login-blurb">
          Join a club, track what everyone's reading, drop spoiler-safe reactions,
          and let fate (or a vote) pick who chooses the next book.
        </p>
        <button class="btn-primary big google-btn" data-action="google">
          <span class="g-mark">G</span> Continue with Google
        </button>
        <p class="login-fine faint">your reactions stay hidden from anyone who hasn't read that far.</p>
        <a class="login-fine faint transparency-link" href="transparency.html">AI transparency statement</a>
      </div>
    </div>
  `, (root) => {
    root.querySelector("[data-action='google']").addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      try { await signInWithGoogle(); }
      catch (err) { toast(err.message || "Sign-in failed", "error"); e.currentTarget.disabled = false; }
    });
  });
}
