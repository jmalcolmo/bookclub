// Circular / rounded-square image cropper. Lets the user pan, zoom, and frame an
// image before it's saved, then BAKES the framing into a square JPEG so display
// code stays unchanged (avatars are CSS circles with background-size:cover, club
// icons are rounded squares — both just show the top-left-to-cover square we emit).
//
// Usage:
//   const blob = await cropImage(file, { shape: "circle" }); // or "rounded"
//   if (blob) { /* upload blob */ }
// Resolves to a 512×512 JPEG Blob, or null if the user cancels.

const VIEWPORT = 280;   // on-screen editing square (CSS px)
const OUTPUT = 512;     // baked image size (px, square)
const MAX_ZOOM = 4;     // multiples of the cover ("fit") scale

export function cropImage(file, { shape = "circle" } = {}) {
  return new Promise((resolve) => {
    if (!file || !file.type?.startsWith("image/")) { resolve(null); return; }

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.onload = () => {
      const back = buildUI(img, shape, (blob) => {
        URL.revokeObjectURL(url);
        back.remove();
        document.removeEventListener("keydown", onKey);
        resolve(blob);
      });
      function onKey(e) { if (e.key === "Escape") back.querySelector("[data-crop-cancel]").click(); }
      document.addEventListener("keydown", onKey);
    };
    img.src = url;
  });
}

function buildUI(img, shape, done) {
  const radius = shape === "rounded" ? "16%" : "50%";

  const back = document.createElement("div");
  back.className = "cropper-backdrop";
  back.dataset.cropper = "true";
  back.innerHTML = `
    <div class="cropper" role="dialog" aria-label="Position your photo">
      <h3>Frame your photo</h3>
      <p class="faint cropper-hint">Drag to reposition · scroll or pinch to zoom</p>
      <div class="cropper-stage" style="width:${VIEWPORT}px;height:${VIEWPORT}px">
        <canvas class="cropper-canvas" width="${VIEWPORT}" height="${VIEWPORT}"></canvas>
        <div class="cropper-mask" style="border-radius:${radius}"></div>
      </div>
      <label class="cropper-zoom">
        <span class="cropper-zoom-icon">−</span>
        <input type="range" min="1" max="${MAX_ZOOM}" step="0.01" value="1" data-crop-zoom>
        <span class="cropper-zoom-icon">＋</span>
      </label>
      <div class="cropper-actions">
        <button type="button" class="btn-ghost" data-crop-cancel>Cancel</button>
        <button type="button" class="btn-primary" data-crop-save>Save photo</button>
      </div>
    </div>`;
  document.body.appendChild(back);

  const canvas = back.querySelector(".cropper-canvas");
  const ctx = canvas.getContext("2d");
  const zoomEl = back.querySelector("[data-crop-zoom]");

  const iw = img.naturalWidth, ih = img.naturalHeight;
  const baseScale = Math.max(VIEWPORT / iw, VIEWPORT / ih); // "cover": image always fills viewport
  let zoom = 1;                 // slider multiplier (1 = cover)
  let offX = 0, offY = 0;       // image top-left within the viewport (≤ 0)

  const effScale = () => baseScale * zoom;

  function clamp() {
    const w = iw * effScale(), h = ih * effScale();
    offX = Math.min(0, Math.max(VIEWPORT - w, offX));
    offY = Math.min(0, Math.max(VIEWPORT - h, offY));
  }

  function draw() {
    clamp();
    ctx.clearRect(0, 0, VIEWPORT, VIEWPORT);
    ctx.drawImage(img, offX, offY, iw * effScale(), ih * effScale());
  }

  // Zoom while keeping the viewport center anchored on the same image point.
  function setZoom(next) {
    next = Math.min(MAX_ZOOM, Math.max(1, next));
    const cx = (VIEWPORT / 2 - offX) / effScale();
    const cy = (VIEWPORT / 2 - offY) / effScale();
    zoom = next;
    offX = VIEWPORT / 2 - cx * effScale();
    offY = VIEWPORT / 2 - cy * effScale();
    zoomEl.value = String(zoom);
    draw();
  }

  // ---- pan (pointer) + pinch (two pointers) ----
  const pts = new Map();
  let last = null, pinchDist = 0;
  const stage = back.querySelector(".cropper-stage");

  stage.addEventListener("pointerdown", (e) => {
    stage.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) pinchDist = pairDist();
    else last = { x: e.clientX, y: e.clientY };
  });
  stage.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const d = pairDist();
      if (pinchDist > 0) setZoom(zoom * (d / pinchDist));
      pinchDist = d;
    } else if (last) {
      offX += e.clientX - last.x;
      offY += e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      draw();
    }
  });
  function endPointer(e) {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinchDist = 0;
    if (pts.size === 0) last = null;
    else last = [...pts.values()][0];
  }
  stage.addEventListener("pointerup", endPointer);
  stage.addEventListener("pointercancel", endPointer);
  function pairDist() {
    const [a, b] = [...pts.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.08 : 0.92));
  }, { passive: false });

  zoomEl.addEventListener("input", () => setZoom(parseFloat(zoomEl.value)));

  back.querySelector("[data-crop-cancel]").addEventListener("click", () => done(null));
  back.addEventListener("click", (e) => { if (e.target === back) done(null); });
  back.querySelector("[data-crop-save]").addEventListener("click", () => {
    clamp();
    const out = document.createElement("canvas");
    out.width = OUTPUT; out.height = OUTPUT;
    const f = OUTPUT / VIEWPORT;
    const octx = out.getContext("2d");
    octx.imageSmoothingQuality = "high";
    octx.fillStyle = "#fff"; // flatten any transparency for JPEG
    octx.fillRect(0, 0, OUTPUT, OUTPUT);
    octx.drawImage(img, offX * f, offY * f, iw * effScale() * f, ih * effScale() * f);
    out.toBlob((blob) => done(blob), "image/jpeg", 0.9);
  });

  draw();
  return back;
}
