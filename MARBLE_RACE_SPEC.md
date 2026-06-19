# Marble Race — Book Club Decider
## Full Build Specification for Claude Opus

---

## Project Overview

A single-file static web app (`index.html`) hosted on GitHub Pages. A book club uses this to decide who picks the next book by running a physics-based marble race. Marbles represent people, each with a name, optional photo, and optional theme song (YouTube link). The marble in the lead has their song playing live during the race. The winner gets a 10-second celebration before a podium screen.

No backend. No login. No build step. Everything persists in `localStorage`.

---

## Tech Stack

- **HTML / CSS / JS** — single `index.html` file, no frameworks
- **Matter.js** — physics engine (load from CDN)
- **YouTube IFrame Player API** — hidden iframes, audio-only playback
- **localStorage** — marble persistence (name, color, base64 image, YouTube URL)
- **Hosting** — GitHub Pages (static, no server needed)

---

## Visual Design System — "Deranged Granny Square"

The aesthetic is inspired by a crochet granny square blanket. Each UI section is its own distinct patch with thick colored borders, slightly irregular sizing, and deliberately non-uniform layout. Organized chaos — everything findable, nothing sterile.

### Color Palette (Dull / Desaturated — named like yarn colors)

```css
:root {
  --bg:           #d6d0c4;   /* warm grey parchment — page background */
  --surface:      #e8e3d9;   /* slightly lighter — card/panel backgrounds */
  --text-primary: #2a2520;   /* near-black brown */
  --text-muted:   #7a7068;   /* mid grey-brown */

  /* Card border/accent colors */
  --yarn-ochre:   #b8a058;   /* dull golden yellow */
  --yarn-sage:    #7a9068;   /* muted olive green */
  --yarn-rust:    #a05838;   /* dusty terracotta */
  --yarn-slate:   #587888;   /* desaturated teal */
  --yarn-mauve:   #886878;   /* muted dusty purple */
  --yarn-bark:    #483828;   /* dark warm brown */
  --yarn-moss:    #607050;   /* deep moss green */
  --yarn-clay:    #987860;   /* warm clay / camel */

  /* Semantic */
  --positive:     #5a7a50;   /* muted green */
  --negative:     #8a4838;   /* muted red */
  --warning:      #9a8040;   /* dull amber */
}
```

### Typography

- **Display / Headings**: `Crimson Pro` or `Libre Baskerville` (Google Fonts) — feels like a hand-typed ledger
- **Numbers / Labels**: `DM Mono` or `Space Mono` (Google Fonts) — monospace, slightly quirky
- Avoid Inter, Roboto, Arial, system fonts entirely

### UI Style Rules

- Thick borders (3–5px) on cards/panels, each panel gets a distinct `--yarn-*` color border
- Slightly off-kilter card sizing — not everything the same width
- Rough/textured feel — use CSS `box-shadow` with slight offsets to simulate depth
- Buttons look like fabric patches: rounded corners, thick border, muted color fill
- No drop shadows that look "material design" — keep shadows warm and offset
- Subtle grain overlay on the background using an SVG noise filter or CSS
- Section headers look hand-stamped — slightly oversized, letter-spaced, dark ink on parchment

---

## App Screens / Flow

### 1. Main Menu

The landing page. Granny-square layout with:

- Big hand-stamped title: **"THE MARBLE RACE"** (subtext: "Book Club Edition")
- Three main action patches/cards:
  - **"Manage Marbles"** — go to marble roster
  - **"Start a Race"** — go to race setup
  - **"How to Play"** — small modal or inline accordion explaining the game
- Footer: small text listing how many marbles are currently saved

### 2. Marble Management Screen

Shows all saved marbles as a grid of cards. Each card displays:
- The marble's avatar (photo or colored circle with initials)
- Their name
- A small music note icon if they have a YouTube song linked
- **Edit** and **Delete** buttons

Top of screen: **"Create New Marble"** button → opens marble creation form (inline or modal).

#### Marble Creation / Edit Form

Fields:
- **Name** (text input, required)
- **Avatar** — file upload for photo (stored as base64 in localStorage). If none, auto-generate a solid-color circle using a color derived from their name hash, with their initials in white `DM Mono` text.
- **Theme Song** — YouTube URL input (optional). Validate that it's a recognizable YouTube URL format (`youtube.com/watch?v=` or `youtu.be/`). Show a small inline preview/confirm once pasted (just display the video title if possible via oEmbed, or just show the URL is accepted).
- **Save** / **Cancel** buttons

Marble data shape stored in localStorage:
```json
{
  "id": "uuid-or-timestamp",
  "name": "Sarah",
  "color": "#7a9068",
  "imageBase64": "data:image/jpeg;base64,...",
  "youtubeUrl": "https://www.youtube.com/watch?v=abc123",
  "youtubeVideoId": "abc123"
}
```

### 3. Race Setup Screen

- **Select Marbles** — checklist of all saved marbles. Check the ones racing today. Minimum 2, no stated maximum (but physics gets chaotic above ~8).
- **Select Map** — three map options displayed as illustrated patch cards:
  - 🏔️ **The Gauntlet** — narrow zigzag canyon, punishing walls
  - 🎿 **Alpine Drop** — wide open slopes with mogul-style bumps
  - 🎰 **Pinball Alley** — dense bumper field, highly chaotic
  - 🎲 **Random** — picks one of the three at random
- **Start Race** button (disabled until ≥2 marbles selected and a map chosen)

### 4. Race Screen

The main event. Full-screen canvas using Matter.js physics.

#### Layout
- Canvas takes ~80% of screen height
- Thin sidebar or top bar showing:
  - Live leaderboard (marble name + position rank, updated in real time)
  - Current "lead" marble name with a 🎵 icon
  - Muted/unmute button for audio

#### Physics Setup (Matter.js)

Use `Matter.Engine`, `Matter.Render` (canvas), `Matter.Runner`, `Matter.World`.

Each marble:
- Is a `Matter.Bodies.circle` with radius ~18px
- Has a label matching the marble's name for tracking
- Renders with the marble's color or image texture
- Starts at the top of the map in a randomized horizontal position within a spawn zone

Walls and platforms are static `Matter.Bodies.rectangle` bodies.

"Lead" is determined every 500ms by finding the marble with the highest Y position (furthest down the canvas, since gravity pulls down).

#### Maps — Detailed Layout

All maps are vertical drop maps (~2000px tall canvas, viewport scrolls or camera follows the lead marble). Target average race duration: **~45 seconds**.

Tune this via:
- Marble restitution (bounciness): ~0.4 default
- Friction: ~0.01
- Gravity: `engine.gravity.y = 1.5` (slightly heavier than default)

---

##### Map 1: The Gauntlet 🏔️

Narrow zigzag canyon. Platforms alternate left-right forcing marbles to bounce between walls. Very tight passages create bottlenecks and dramatic lead changes.

Structure:
- Canvas: 600px wide, 2200px tall
- Thick left and right walls the full height
- Alternating diagonal shelf platforms every ~180px, angled 20–30 degrees, staggered left/right
- 3–4 "pinch points" — gaps only slightly wider than 2 marbles
- Finish line at the bottom: a funnel into a single exit hole

Pacing: fast in open sections, chaotic at pinch points.

---

##### Map 2: Alpine Drop 🎿

Wide open slope with mogul-style bumps. Feels like a ski slope. More room to spread out, so lead is often clear. Speed is high.

Structure:
- Canvas: 800px wide, 2000px tall
- No side walls in the middle — only soft boundary walls
- Gentle overall slope (world gravity does most work)
- Rows of small round bumper circles (~30px radius static bodies) arranged in a mogul pattern
- 2–3 larger "jump ramps" — angled platforms that launch marbles upward briefly
- Wide finish gate at the bottom

Pacing: fast and spread out, fewer dramatic lead changes, clear winner usually emerges early.

---

##### Map 3: Pinball Alley 🎰

Dense field of bumpers in a wide chamber. Highly chaotic — the lead changes constantly. Slowest map due to energy absorption from bumper collisions.

Structure:
- Canvas: 700px wide, 2400px tall
- High-restitution circular bumpers (restitution: 0.9) arranged in irregular rows
- Bumpers have alternating sizes (small ~20px, large ~45px radius)
- 4 "lanes" separated by vertical dividers that have gaps — marbles can switch lanes
- Funnel at bottom into finish
- Overall this map should feel like a pachinko machine

Pacing: slow and chaotic, dramatic, lead changes every few seconds.

---

#### Power-ups & Nerfs

Orbs spawn randomly on the canvas during the race. Each orb is a glowing circle (~20px radius) with a distinct color and icon/symbol. When a marble collides with an orb, the effect applies to that marble only for a set duration, then the orb respawns in a new random position.

Spawn rules:
- First orb spawns 5 seconds into the race
- New orb spawns 4–8 seconds after the previous one is collected
- Max 3 orbs visible at once
- Orbs do not spawn within 100px of the top or bottom

| Orb | Color | Name | Effect | Duration |
|-----|-------|------|--------|----------|
| 🔵 | Deep blue | **Heavy** | `gravity.y` multiplied ×3 for this marble (implemented via `Matter.Body.applyForce` downward every frame) | 4s |
| 🟢 | Pale green | **Feather** | Gravity effectively ×0.2 — marble floats slowly | 5s |
| 🔴 | Bright red | **Hyper Bounce** | `restitution` set to 0.98 — marble pinballs violently | 6s |
| 🟡 | Golden yellow | **Speed Burst** | Applies a strong random-direction velocity impulse immediately | Instant |
| ⚫ | Dark grey | **Freeze** | Sets velocity to near-zero and applies heavy damping | 3s |
| 🟠 | Orange | **Ghost** | Marble becomes a sensor (no collision) for one obstacle pass, then resets | 4s |
| 🟣 | Purple | **Magnet** | Every frame, applies a small attractive force toward nearby marbles within 150px radius | 5s |

Visual feedback:
- When a marble has an active effect, draw a colored halo ring around it matching the orb color
- Show a small floating label above the marble with the effect name that fades out after 1.5s
- Orbs pulse/glow with a CSS animation or canvas sine-wave scale effect

Implementation note: Since Matter.js doesn't natively support per-body gravity, implement Heavy/Feather by tracking affected marbles in a JS object and applying compensating forces each engine tick via `Matter.Events.on(engine, 'beforeUpdate', ...)`.

---

#### Audio — YouTube IFrame API

**Setup:**
Load the YouTube IFrame Player API script. Create one hidden `<div>` container per marble that has a YouTube song. Initialize a `YT.Player` instance for each, with:
- `width: 1, height: 1` (invisible)
- `playerVars: { autoplay: 0, controls: 0 }`

**Playback logic:**
- Track `currentLeader` (marble name string), updated every 500ms
- When `currentLeader` changes:
  - Fade out current playing player (reduce volume from 100 to 0 over 800ms via `setVolume()` polling)
  - Call `stopVideo()` on old player
  - Call `playVideo()` on new leader's player
  - Fade in new player (0 to 100 over 800ms)
- If lead marble has no YouTube URL, pause all audio
- On race finish: let winner's song play through the celebration screen (10s), then stop all audio before podium

**Mute toggle:**
- Global mute button in race UI
- Stores mute state, pauses/resumes current player accordingly

**Error handling:**
- If a video has embedding disabled (`onError` event), show a small toast: "⚠️ [Name]'s song couldn't load — embedding may be disabled" and skip that marble's audio silently.

---

### 5. Results Screen — Celebration + Podium

#### Phase 1: Winner Celebration (10 seconds)

Full screen takeover:
- Background: --bg color with confetti particle system (CSS canvas or JS confetti library from CDN)
- Center: Winner's marble avatar (large, ~120px) bouncing in place + spinning
  - Bouncing: CSS `@keyframes` — translate Y up/down ±20px, timing ~0.4s ease-in-out infinite
  - Spinning: CSS `rotate` 360deg, timing ~1.2s linear infinite
  - Particle sparkles radiating outward from marble (small colored circles, JS canvas)
- Winner's name in large display font
- Subtext: "PICKS THE NEXT BOOK"
- Winner's YouTube song plays during this entire phase (if they have one)
- 10-second countdown bar at the bottom (thin progress bar depleting)
- Skip button: "Show Podium →"

#### Phase 2: Podium (static, no music)

Classic podium layout:
- 🥇 1st place — center, tallest block
- 🥈 2nd place — left, medium block
- 🥉 3rd place — right, shortest block

Each podium spot shows:
- Marble avatar
- Name
- Finishing time or position number

Below podium:
- Full finishing order list (4th, 5th, etc.) if more than 3 marbles raced
- Two buttons: **"Race Again"** (same marbles, same map) and **"Back to Menu"**

---

## localStorage Schema

Key: `marbleRace_marbles`
Value: JSON array of marble objects

```json
[
  {
    "id": "1713000000000",
    "name": "Sarah",
    "color": "#7a9068",
    "imageBase64": null,
    "youtubeUrl": "https://www.youtube.com/watch?v=abc123",
    "youtubeVideoId": "abc123"
  },
  {
    "id": "1713000000001",
    "name": "Marcus",
    "color": "#a05838",
    "imageBase64": "data:image/jpeg;base64,...",
    "youtubeUrl": null,
    "youtubeVideoId": null
  }
]
```

Helper functions to implement:
- `loadMarbles()` — parse from localStorage, return array
- `saveMarbles(arr)` — stringify and write to localStorage
- `addMarble(marble)` — append and save
- `updateMarble(id, changes)` — find by id, merge, save
- `deleteMarble(id)` — filter out and save
- `extractVideoId(url)` — parse YouTube URL and return video ID string

---

## File Structure

This is a **single file** deployment:

```
index.html        ← entire app: HTML structure + <style> + <script>
```

GitHub Pages serves `index.html` from the repo root. No `npm`, no build, no dependencies to install. All libraries loaded from CDN inside `index.html`:

```html
<!-- Matter.js physics -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js"></script>

<!-- YouTube IFrame API (loaded async as required by Google) -->
<script src="https://www.youtube.com/iframe_api"></script>

<!-- Optional: canvas-confetti for celebration screen -->
<script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js"></script>

<!-- Google Fonts -->
<link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
```

---

## Implementation Notes for Claude Opus

1. **Screen routing**: Implement as a simple JS screen manager — hide/show `<section>` elements with `data-screen` attributes. No router library needed.

2. **Canvas rendering**: Matter.js `Render` draws to a canvas. For marble avatars (images), use `render.options.wireframes = false` and set body `render.sprite` with the base64 image. For color-only marbles, use `render.fillStyle`.

3. **Camera follow**: The race canvas is taller than the viewport. Use `Matter.Render.lookAt()` to follow the lead marble, keeping it centered vertically.

4. **Lead detection**: Every 500ms, loop through all marble bodies, find the one with the highest `.position.y` (largest Y = furthest down). Compare to previous leader — if changed, trigger audio crossfade.

5. **Finish detection**: Place a static sensor body at the bottom of the map. Use `Matter.Events.on(engine, 'collisionStart', ...)` to detect when a marble touches it. Record finish order. When all marbles have finished (or after a 90-second timeout), end race.

6. **Power-up collision**: Similarly use `collisionStart` events. Tag orb bodies with a custom `label` like `"orb_freeze"`. When a marble body collides with an orb body, apply the effect and remove/reposition the orb.

7. **Per-marble gravity**: Matter.js has a single global gravity. For Heavy/Feather effects, use `beforeUpdate` event to apply a counteracting or amplifying force each tick: `Matter.Body.applyForce(body, body.position, { x: 0, y: forceDelta })`.

8. **YouTube API timing**: `YT.Player` instances must be created after `onYouTubeIframeAPIReady` fires. Create all players at race start (not on page load) so they're ready when needed.

9. **Mobile consideration**: The app will primarily be used on desktop (book club gathering around a laptop), but basic responsiveness is appreciated. The canvas can scroll on mobile.

10. **No frameworks**: Pure vanilla JS. Use `class` syntax for organization if desired (e.g. `class MarbleRace`, `class AudioManager`, `class PowerUpManager`).

---

## Summary Checklist for Build

- [ ] Single `index.html` file, all CSS and JS inline
- [ ] Granny Square design system applied throughout
- [ ] Crimson Pro + DM Mono fonts
- [ ] Screen manager: Main Menu → Marble Manager → Race Setup → Race → Results
- [ ] localStorage marble CRUD (name, color, base64 image, YouTube video ID)
- [ ] Auto-generate colored circle avatar with initials if no image uploaded
- [ ] YouTube IFrame API: one hidden player per marble with song
- [ ] Audio crossfade on lead change (800ms fade out/in)
- [ ] Matter.js physics engine
- [ ] 3 maps: The Gauntlet, Alpine Drop, Pinball Alley (+ Random option)
- [ ] ~45 second average race duration tuning
- [ ] 7 power-up/nerf orbs with visual halos and labels
- [ ] Per-body gravity via `beforeUpdate` force application
- [ ] Finish sensor + finish order tracking
- [ ] 90-second race timeout fallback
- [ ] Winner celebration: 10s bounce+spin+confetti+song
- [ ] Podium screen: top 3 + full order list
- [ ] Race Again + Back to Menu buttons
- [ ] Mute toggle during race
- [ ] Embedding-disabled YouTube error toast
