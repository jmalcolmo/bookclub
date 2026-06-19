// Minimal hash router. Routes are matched in order; the first match wins.
// A route handler receives { params } and renders into #app.
import { toast } from "./ui.js";

const routes = [];
let notFound = () => { document.getElementById("app").innerHTML = "<p>Not found.</p>"; };

export function route(pattern, handler) {
  // pattern like "/club/:id/book/:bookId"
  const keys = [];
  const rx = new RegExp(
    "^" + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return "([^/]+)"; }) + "$"
  );
  routes.push({ rx, keys, handler });
}

export function setNotFound(fn) { notFound = fn; }

export function navigate(path) {
  if (("#" + path) === window.location.hash) { resolve(); }
  else window.location.hash = path;
}

export function currentPath() {
  return window.location.hash.replace(/^#/, "") || "/clubs";
}

export async function resolve() {
  const path = currentPath();
  const app = document.getElementById("app");
  for (const r of routes) {
    const m = path.match(r.rx);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      try {
        app.scrollTo?.(0, 0);
        window.scrollTo(0, 0);
        await r.handler({ params });
      } catch (err) {
        console.error(err);
        toast(err.message || "Something went wrong", "error");
        app.innerHTML = `<div class="screen-pad"><p class="faint">Couldn't load this page.</p>
          <pre class="err-pre">${(err.message || err)}</pre></div>`;
      }
      return;
    }
  }
  notFound();
}

export function startRouter() {
  window.addEventListener("hashchange", resolve);
}

// Convenience: set #app content and run an optional after-render callback.
export function render(html, after) {
  const app = document.getElementById("app");
  app.innerHTML = html;
  if (after) after(app);
}
