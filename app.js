import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* ---------------------------------------------------------------- setup */

const cfg = window.SONGBOOK_CONFIG || {};
const BUCKET = "music";
const SIGN_TTL = 60 * 60 * 12; // signed file links last 12 hours
const MAX_AUDIO_MB = 50;       // Supabase free plan per-file limit

const $app = document.getElementById("app");
const $modal = document.getElementById("modal-root");
const $toast = document.getElementById("toast");
const audio = document.getElementById("audio");

const COLORS = ["#f4a6c0", "#f7b98b", "#f3d77a", "#9fd8b8", "#9cc8f0", "#b8a2e8", "#e59ad8", "#8f7a8a"];

const svg = (inner, stroke) => stroke
  ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`
  : `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${inner}</svg>`;
const I = {
  play: svg('<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>'),
  pause: svg('<rect x="6" y="5" width="4.5" height="14" rx="1.5"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.5"/>'),
  prev: svg('<path d="M5 5h2.2v14H5zM19 6.2v11.6a1 1 0 0 1-1.53.85L9.5 13.4a1.6 1.6 0 0 1 0-2.8l7.97-5.25A1 1 0 0 1 19 6.2z"/>'),
  next: svg('<path d="M16.8 5H19v14h-2.2zM5 6.2v11.6a1 1 0 0 0 1.53.85l7.97-5.25a1.6 1.6 0 0 0 0-2.8L6.53 5.35A1 1 0 0 0 5 6.2z"/>'),
  heart: svg('<path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8.1 3.6 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.6 0 5.7 3.6 4.5 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/>'),
  shuffle: svg('<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>', 1),
  repeat: svg('<path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>', 1),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', 1),
  up: svg('<path d="m6 15 6-6 6 6"/>', 1),
  down: svg('<path d="m6 9 6 6 6-6"/>', 1),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>', 1),
  lyrics: svg('<path d="M4 6h16M4 12h16M4 18h10"/>', 1),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 1),
  back: svg('<path d="M19 12H5M12 19l-7-7 7-7"/>', 1),
  note: svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>', 1),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 1),
};

const state = {
  session: null,
  isSinger: false,
  booted: false,
  profile: {},
  releases: [],
  tracks: [],
  hearts: new Set(),
  requests: [],
  reqDraft: "",
  urls: new Map(),        // storage path -> { url, exp }
  queue: [],
  qi: -1,
  repeat: "off",          // off | all | one
  openLyrics: new Set(),
  channel: null,
};

let sb = null;
if (!cfg.supabaseUrl || cfg.supabaseUrl.startsWith("YOUR_") || !cfg.supabaseAnonKey || cfg.supabaseAnonKey.startsWith("YOUR_")) {
  renderSetupNeeded();
} else {
  sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  start();
}

/* ---------------------------------------------------------------- helpers */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : COLORS[0]);
const fmtTime = (s) => {
  if (!isFinite(s) || s < 0) return "0:00";
  s = Math.round(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const fmtLong = (s) => {
  const m = Math.round((s || 0) / 60);
  return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`;
};
const fmtDate = (d) => {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};
const yearOf = (d) => (d ? d.slice(0, 4) : "");
const relById = (id) => state.releases.find((r) => r.id === id);
const tracksOf = (id) => state.tracks.filter((t) => t.release_id === id);
const urlFor = (p) => (p ? state.urls.get(p)?.url : null);
const listenerName = () => state.profile.listener_name?.trim() || "";

let toastTimer;
function toast(msg, ms = 2600) {
  $toast.textContent = msg;
  $toast.classList.add("show");
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => $toast.classList.remove("show"), ms);
}

function coverHTML(rel, cls = "") {
  const color = safeColor(rel?.color);
  const u = urlFor(rel?.cover_path);
  if (u) return `<div class="cover ${cls}" style="--c:${color}"><img src="${esc(u)}" alt="" loading="lazy"></div>`;
  const letter = (rel?.title || "♪").trim().charAt(0).toUpperCase() || "♪";
  return `<div class="cover cover-blank ${cls}" style="--c:${color}"><span>${esc(letter)}</span>${I.note}</div>`;
}

/* ---------------------------------------------------------------- auth + boot */

function start() {
  sb.auth.onAuthStateChange((event, session) => {
    const wasIn = !!state.session;
    state.session = session;
    if (!session) {
      teardown();
      renderLogin();
      return;
    }
    // Defer: calling Supabase inside this callback can deadlock.
    if (!wasIn) setTimeout(boot, 0);
  });
}

async function boot() {
  $app.innerHTML = `<div class="loading">tuning the strings…</div>`;
  try {
    const [singer, member] = await Promise.all([sb.rpc("is_singer"), sb.rpc("is_member")]);
    if (singer.error) throw singer.error;
    if (!member.data) return renderNotInvited();
    state.isSinger = !!singer.data;
    await loadAll();
    subscribe();
    if (!state.booted) {
      state.booted = true;
      window.addEventListener("hashchange", () => route());
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && state.session) scheduleRefresh();
      });
    }
    route();
  } catch (err) {
    console.error(err);
    $app.innerHTML = `<div class="login"><div class="login-card"><div class="login-art">🥺</div>
      <h1>Something's off</h1><p>${esc(err.message || err)}</p>
      <button class="btn" data-act="reload">Try again</button></div></div>`;
  }
}

function teardown() {
  if (state.channel) { sb.removeChannel(state.channel); state.channel = null; }
  audio.pause();
  audio.removeAttribute("src");
  state.queue = []; state.qi = -1;
  document.getElementById("player").hidden = true;
}

async function loadAll() {
  const [p, r, t, h, q] = await Promise.all([
    sb.from("profile").select("*").eq("id", 1).maybeSingle(),
    sb.from("releases").select("*").order("released_on", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }),
    sb.from("tracks").select("*").order("position").order("created_at"),
    sb.from("hearts").select("track_id"),
    sb.from("requests").select("*").order("created_at"),
  ]);
  for (const x of [p, r, t, h, q]) if (x.error) throw x.error;
  state.profile = p.data || { name: "My Music" };
  state.releases = r.data;
  state.tracks = t.data;
  state.hearts = new Set(h.data.map((x) => x.track_id));
  state.requests = q.data;
  await signPaths([state.profile.avatar_path, ...state.releases.map((x) => x.cover_path), ...state.tracks.map((x) => x.audio_path)]);
  syncQueue();
}

async function signPaths(paths) {
  const now = Date.now();
  const need = [...new Set(paths.filter(Boolean))].filter((p) => {
    const c = state.urls.get(p);
    return !c || c.exp < now + 20 * 60 * 1000;
  });
  for (let i = 0; i < need.length; i += 100) {
    const chunk = need.slice(i, i + 100);
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(chunk, SIGN_TTL);
    if (error) { console.warn(error); continue; }
    for (const d of data) if (d.signedUrl) state.urls.set(d.path, { url: d.signedUrl, exp: now + SIGN_TTL * 1000 });
  }
}

function subscribe() {
  if (state.channel) return;
  const ch = sb.channel("songbook");
  for (const table of ["profile", "releases", "tracks", "hearts", "requests"]) {
    ch.on("postgres_changes", { event: "*", schema: "public", table }, scheduleRefresh);
  }
  ch.subscribe();
  state.channel = ch;
}

let refreshTimer;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 350);
}
async function refresh() {
  if (!state.session) return;
  try {
    await loadAll();
    route(true);
    updatePlayerUI();
  } catch (e) { console.error(e); }
}

/* ---------------------------------------------------------------- screens */

function renderSetupNeeded() {
  $app.innerHTML = `<div class="login"><div class="login-card"><div class="login-art">🛠️</div>
    <h1>Almost there</h1>
    <p>Open <b>config.js</b> and paste in your Supabase URL and anon key. The README walks you through it.</p></div></div>`;
}

function renderLogin() {
  $app.innerHTML = `<div class="login"><div class="login-card">
    <div class="login-art">🎀</div>
    <h1>${esc(cfg.siteTitle || "Our Little Songbook")}</h1>
    <p>sign in to listen ♡</p>
    <form id="login-form">
      <input type="email" name="email" placeholder="email" autocomplete="email" required>
      <input type="password" name="password" placeholder="password" autocomplete="current-password" required>
      <button class="btn primary" style="justify-content:center">Come in</button>
      <p class="err" id="login-err"></p>
    </form></div></div>`;
  const form = document.getElementById("login-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button");
    btn.disabled = true;
    const fd = new FormData(form);
    const { error } = await sb.auth.signInWithPassword({ email: fd.get("email").trim(), password: fd.get("password") });
    btn.disabled = false;
    if (error) document.getElementById("login-err").textContent = error.message === "Invalid login credentials" ? "Hmm, that email or password isn't right." : error.message;
  });
}

function renderNotInvited() {
  $app.innerHTML = `<div class="login"><div class="login-card"><div class="login-art">🔒</div>
    <h1>This place is private</h1><p>This account isn't on the guest list.</p>
    <button class="btn" data-act="signout">Sign out</button></div></div>`;
}

function route(soft = false) {
  if (!state.session || !state.booted) return;
  const m = location.hash.match(/^#\/release\/([\w-]+)/);
  const rel = m && relById(m[1]);
  if (rel) renderRelease(rel); else renderHome();
  if (!soft) window.scrollTo(0, 0);
  markPlaying();
}

function renderHome() {
  const p = state.profile;
  const S = state.isSinger;
  const albums = state.releases.filter((r) => r.kind === "album");
  const singles = state.releases.filter((r) => r.kind === "single");
  const favs = orderedAll().filter((t) => state.hearts.has(t.id));
  const avatarUrl = urlFor(p.avatar_path);
  const who = listenerName();
  const nothing = !state.releases.length;

  $app.innerHTML = `
    <header class="hero">
      <div class="avatar">${avatarUrl ? `<img src="${esc(avatarUrl)}" alt="">` : esc((p.name || "♪").charAt(0).toUpperCase())}</div>
      <div>
        <p class="eyebrow">${who ? `songs for ${esc(who)} ♡` : "a tiny music place ♡"}</p>
        <h1>${esc(p.name || "My Music")}</h1>
        ${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ""}
        <div class="hero-actions">
          ${state.tracks.length ? `<button class="btn primary" data-act="shuffle" data-ctx="all">${I.shuffle} Shuffle everything</button>` : ""}
          ${S ? `<button class="btn" data-act="edit-profile">${I.edit} Edit profile</button>` : ""}
        </div>
      </div>
    </header>
    ${p.welcome ? `<div class="note-card">${esc(p.welcome)}</div>` : ""}
    ${nothing && !S ? `<p class="empty">Songs are on their way… ♡</p>` : ""}
    ${shelf("Albums", albums, "album")}
    ${shelf("Singles", singles, "single")}
    ${favs.length ? `
      <section class="shelf">
        <div class="shelf-head"><h2>${S ? (who ? `${esc(who)}'s favorites` : "Her favorites") : "Your favorites"} <small>♡ ${favs.length}</small></h2>
          <button class="btn small" data-act="play-ctx" data-ctx="favs">${I.play} Play</button></div>
        <ol class="tracklist">${favs.map((t, i) => trackRow(t, i, { ctx: "favs", thumb: true })).join("")}</ol>
      </section>` : ""}
    ${requestsShelf()}
    ${footer()}`;
  bindRequestForm();
}

/* Song requests: she writes and ticks them off; the singer can only read. */
function requestsShelf() {
  const S = state.isSinger;
  const who = listenerName();
  const list = [...state.requests].sort((a, b) => a.done - b.done);
  const open = state.requests.filter((r) => !r.done).length;
  return `<section class="shelf">
    <div class="shelf-head"><h2>${S ? (who ? `${esc(who)}'s requests` : "Her requests") : "Song requests"}${state.requests.length ? ` <small>${open} to sing</small>` : ""}</h2></div>
    ${S ? "" : `<form class="req-add" id="req-form">
      <input type="text" name="title" placeholder="a song you'd love to hear me sing…" maxlength="120" autocomplete="off">
      <button class="btn primary">${I.plus} Add</button>
    </form>`}
    ${list.length
      ? `<ul class="tracklist reqlist">${list.map(requestRow).join("")}</ul>`
      : `<p class="empty">${S ? "No requests yet ♡" : "Nothing here yet — add a song you'd like to hear!"}</p>`}
  </section>`;
}

function requestRow(r) {
  const S = state.isSinger;
  const box = S
    ? `<span class="req-box ${r.done ? "on" : ""}" role="img" aria-label="${r.done ? "Done" : "Not done yet"}">${I.check}</span>`
    : `<button class="req-box ${r.done ? "on" : ""}" data-act="req-toggle" data-id="${r.id}" role="checkbox" aria-checked="${r.done}" aria-label="Mark “${esc(r.title)}” ${r.done ? "not done" : "done"}">${I.check}</button>`;
  return `<li class="track req ${r.done ? "is-done" : ""}">
    ${box}
    <span class="t-text">
      <span class="t-title">${esc(r.title)}</span>
      ${r.note ? `<span class="t-note">${esc(r.note)}</span>` : ""}
    </span>
    ${S ? "" : `<button class="icon-btn" data-act="req-edit" data-id="${r.id}" title="Edit request">${I.edit}</button>`}
  </li>`;
}

function bindRequestForm() {
  const form = document.getElementById("req-form");
  if (!form) return;
  const input = form.elements.title;
  input.value = state.reqDraft;
  input.addEventListener("input", () => (state.reqDraft = input.value));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title) return input.focus();
    const btn = form.querySelector("button");
    btn.disabled = true;
    const { error } = await sb.from("requests").insert({ title });
    btn.disabled = false;
    if (error) return toast("Oops: " + error.message, 5000);
    state.reqDraft = "";
    await refresh();
    document.querySelector("#req-form input")?.focus();
    toast("Request added ♡");
  });
}

async function toggleRequest(id) {
  const r = state.requests.find((x) => x.id === id);
  if (!r) return;
  r.done = !r.done;
  route(true);
  const { error } = await sb.from("requests").update({ done: r.done }).eq("id", id);
  if (error) { r.done = !r.done; route(true); throw error; }
}

function editRequest(r) {
  if (!r) return;
  modal({
    title: "Edit request",
    danger: "Remove",
    body: `
      ${field("Song", `<input type="text" name="title" value="${esc(r.title)}" required maxlength="120">`)}
      ${field("Note", `<input type="text" name="note" value="${esc(r.note)}" maxlength="200" placeholder="optional — e.g. the acoustic version">`)}
      <label class="check-field"><input type="checkbox" name="done" ${r.done ? "checked" : ""}> Done</label>`,
    onSubmit: async (fd) => {
      const title = fd.get("title").trim();
      if (!title) throw new Error("Add a song name first.");
      const { error } = await sb.from("requests").update({ title, note: fd.get("note").trim(), done: fd.get("done") === "on" }).eq("id", r.id);
      if (error) throw error;
      await refresh();
      toast("Saved ♡");
    },
    onDanger: async () => {
      const { error } = await sb.from("requests").delete().eq("id", r.id);
      if (error) throw error;
      await refresh();
      toast("Request removed");
    },
  });
}

function shelf(title, list, kind) {
  const S = state.isSinger;
  if (!list.length && !S) return "";
  return `<section class="shelf">
    <div class="shelf-head"><h2>${title}</h2>
      ${S ? `<button class="btn small" data-act="new-release" data-kind="${kind}">${I.plus} New ${kind}</button>` : ""}</div>
    ${list.length ? `<div class="grid">${list.map(card).join("")}</div>` : `<p class="empty">No ${kind}s yet — add your first one!</p>`}
  </section>`;
}

function card(rel) {
  const n = tracksOf(rel.id).length;
  const sub = rel.kind === "album" ? `${n} song${n === 1 ? "" : "s"}` : "Single";
  return `<a class="card" href="#/release/${rel.id}">
    <div style="position:relative">${coverHTML(rel)}
      ${n ? `<button class="card-play" data-act="play-ctx" data-ctx="rel:${rel.id}" aria-label="Play ${esc(rel.title)}">${I.play}</button>` : ""}
    </div>
    <h3>${esc(rel.title)}</h3>
    <p>${sub}${rel.released_on ? ` · ${yearOf(rel.released_on)}` : ""}</p>
  </a>`;
}

function renderRelease(rel) {
  const S = state.isSinger;
  const list = tracksOf(rel.id);
  const total = list.reduce((a, t) => a + (t.duration || 0), 0);
  $app.innerHTML = `
    <a class="back" href="#/">${I.back} back</a>
    <section class="release-hero" style="--c:${safeColor(rel.color)}">
      ${coverHTML(rel, "big")}
      <div>
        <p class="eyebrow">${rel.kind === "album" ? "album" : "single"}</p>
        <h1>${esc(rel.title)}</h1>
        <p class="meta">${esc(state.profile.name || "")}${rel.released_on ? ` · ${fmtDate(rel.released_on)}` : ""}${list.length ? ` · ${list.length} song${list.length === 1 ? "" : "s"}, ${fmtLong(total)}` : ""}</p>
        ${rel.description ? `<p class="desc">${esc(rel.description)}</p>` : ""}
        <div class="hero-actions">
          ${list.length ? `<button class="btn primary" data-act="play-ctx" data-ctx="rel:${rel.id}">${I.play} Play</button>` : ""}
          ${list.length > 1 ? `<button class="btn" data-act="shuffle" data-ctx="rel:${rel.id}">${I.shuffle} Shuffle</button>` : ""}
          ${S ? `<button class="btn" data-act="add-songs" data-id="${rel.id}">${I.plus} Add songs</button>
                 <button class="btn" data-act="edit-release" data-id="${rel.id}">${I.edit} Edit</button>` : ""}
        </div>
      </div>
    </section>
    ${list.length
      ? `<ol class="tracklist">${list.map((t, i) => trackRow(t, i, { ctx: `rel:${rel.id}`, editable: S, first: i === 0, last: i === list.length - 1 })).join("")}</ol>`
      : `<p class="empty">${S ? "No songs yet — tap “Add songs” to upload some." : "Songs coming soon ♡"}</p>`}
    ${footer()}`;
}

function trackRow(t, i, o) {
  const S = state.isSinger;
  const hearted = state.hearts.has(t.id);
  const rel = relById(t.release_id);
  const open = state.openLyrics.has(t.id);
  const who = listenerName() || "she";
  let heart = "";
  if (S) heart = hearted ? `<span class="heart-flag" title="${esc(who)} loves this">${I.heart}</span>` : "";
  else heart = `<button class="icon-btn heart ${hearted ? "on" : ""}" data-act="heart" data-id="${t.id}" aria-label="${hearted ? "Unfavorite" : "Favorite"}" aria-pressed="${hearted}">${I.heart}</button>`;

  return `<li class="track" data-track="${t.id}">
    <button class="t-main" data-act="play-track" data-id="${t.id}" data-ctx="${o.ctx}">
      ${o.thumb ? coverHTML(rel, "t-thumb") : `<span class="t-num">${i + 1}</span><span class="eq"><i></i><i></i><i></i></span>`}
      <span class="t-text">
        <span class="t-title">${esc(t.title)}</span>
        ${o.thumb && rel ? `<span class="t-note">${esc(rel.title)}</span>` : t.note ? `<span class="t-note">${esc(t.note)}</span>` : ""}
      </span>
    </button>
    <span class="t-dur">${t.duration ? fmtTime(t.duration) : ""}</span>
    ${t.lyrics ? `<button class="icon-btn" data-act="lyrics" data-id="${t.id}" title="Lyrics" aria-expanded="${open}">${I.lyrics}</button>` : ""}
    ${heart}
    ${o.editable ? `
      <button class="icon-btn" data-act="move" data-dir="-1" data-id="${t.id}" title="Move up" ${o.first ? "disabled style=visibility:hidden" : ""}>${I.up}</button>
      <button class="icon-btn" data-act="move" data-dir="1" data-id="${t.id}" title="Move down" ${o.last ? "disabled style=visibility:hidden" : ""}>${I.down}</button>
      <button class="icon-btn" data-act="edit-track" data-id="${t.id}" title="Edit song">${I.edit}</button>` : ""}
  </li>
  ${t.lyrics && open ? `<li class="lyrics">${esc(t.lyrics)}</li>` : ""}`;
}

function footer() {
  const email = state.session?.user?.email || "";
  return `<footer class="foot">made with ♡ · signed in as ${esc(email)}${state.isSinger ? " (singer)" : ""} · <button data-act="signout">sign out</button></footer>`;
}

/* ---------------------------------------------------------------- clicks */

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.closest("#modal-root")) return;
  e.preventDefault();
  e.stopPropagation();
  const { act, id, ctx, kind } = el.dataset;
  try {
    switch (act) {
      case "play-track": {
        const q = queueFor(ctx);
        const idx = q.findIndex((t) => t.id === id);
        const cur = state.queue[state.qi];
        if (cur && cur.id === id) togglePlay();
        else playQueue(q, Math.max(0, idx));
        break;
      }
      case "play-ctx": playQueue(queueFor(ctx), 0); break;
      case "shuffle": playQueue(shuffle(queueFor(ctx)), 0); break;
      case "heart": await toggleHeart(id); break;
      case "lyrics":
        state.openLyrics.has(id) ? state.openLyrics.delete(id) : state.openLyrics.add(id);
        route(true);
        break;
      case "edit-profile": editProfile(); break;
      case "new-release": editRelease(null, kind); break;
      case "edit-release": editRelease(relById(id)); break;
      case "add-songs": pickSongs(relById(id)); break;
      case "edit-track": editTrack(state.tracks.find((t) => t.id === id)); break;
      case "req-toggle": await toggleRequest(id); break;
      case "req-edit": editRequest(state.requests.find((r) => r.id === id)); break;
      case "move": await moveTrack(id, Number(el.dataset.dir)); break;
      case "signout": await sb.auth.signOut(); location.hash = ""; break;
      case "reload": location.reload(); break;
    }
  } catch (err) {
    console.error(err);
    toast("Oops: " + (err.message || err), 5000);
  }
});

function orderedAll() {
  return state.releases.flatMap((r) => tracksOf(r.id));
}
function queueFor(ctx) {
  if (ctx === "all") return orderedAll();
  if (ctx === "favs") return orderedAll().filter((t) => state.hearts.has(t.id));
  if (ctx?.startsWith("rel:")) return tracksOf(ctx.slice(4));
  return [];
}
function shuffle(a) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

async function toggleHeart(id) {
  const on = state.hearts.has(id);
  on ? state.hearts.delete(id) : state.hearts.add(id);
  route(true); updatePlayerUI();
  const res = on ? await sb.from("hearts").delete().eq("track_id", id) : await sb.from("hearts").insert({ track_id: id });
  if (res.error) {
    on ? state.hearts.add(id) : state.hearts.delete(id);
    route(true); updatePlayerUI();
    throw res.error;
  }
  if (!on) toast("Added to your favorites ♡");
}

/* ---------------------------------------------------------------- player */

const $player = document.getElementById("player");
const $range = document.getElementById("p-range");
const $play = document.getElementById("p-play");
const $repeat = document.getElementById("p-repeat");
const $pheart = document.getElementById("p-heart");
document.getElementById("p-prev").innerHTML = I.prev;
document.getElementById("p-next").innerHTML = I.next;
$play.innerHTML = I.play;
$pheart.innerHTML = I.heart;
let seeking = false;

function playQueue(list, idx) {
  if (!list.length) return toast("No songs here yet");
  state.queue = list;
  state.qi = idx;
  loadCurrent(true);
}

function loadCurrent(autoplay) {
  const t = state.queue[state.qi];
  if (!t) return;
  const url = urlFor(t.audio_path);
  const go = (u) => {
    audio.src = u;
    if (autoplay) audio.play().catch(() => {});
    updatePlayerUI(); setMediaSession(); markPlaying();
  };
  if (url) go(url);
  else signPaths([t.audio_path]).then(() => urlFor(t.audio_path) ? go(urlFor(t.audio_path)) : toast("Couldn't load that song"));
}

function togglePlay() {
  if (!audio.src) return;
  audio.paused ? audio.play().catch(() => {}) : audio.pause();
}
function next(auto) {
  if (!state.queue.length) return;
  if (auto && state.repeat === "one") { audio.currentTime = 0; audio.play(); return; }
  if (state.qi < state.queue.length - 1) state.qi++;
  else if (state.repeat === "all" || !auto) state.qi = 0;
  else { audio.pause(); audio.currentTime = 0; return; }
  loadCurrent(true);
}
function prev() {
  if (audio.currentTime > 3 || state.qi <= 0) { audio.currentTime = 0; return; }
  state.qi--;
  loadCurrent(true);
}

function syncQueue() {
  if (!state.queue.length) return;
  const byId = new Map(state.tracks.map((t) => [t.id, t]));
  state.queue = state.queue.map((t) => byId.get(t.id) || t);
}

function updatePlayerUI() {
  const t = state.queue[state.qi];
  $player.hidden = !t;
  if (!t) return;
  const rel = relById(t.release_id);
  document.getElementById("p-art").innerHTML = coverHTML(rel);
  document.getElementById("p-title").textContent = t.title;
  document.getElementById("p-sub").textContent = [rel?.title, state.profile.name].filter(Boolean).join(" · ");
  const hearted = state.hearts.has(t.id);
  $pheart.classList.toggle("on", hearted);
  $pheart.hidden = state.isSinger;
  $pheart.setAttribute("aria-pressed", hearted);
  $repeat.innerHTML = I.repeat + (state.repeat === "one" ? "<sup>1</sup>" : "");
  $repeat.className = "p-btn " + (state.repeat === "off" ? "off" : "on");
  $repeat.title = { off: "Repeat: off", all: "Repeat: all", one: "Repeat: this song" }[state.repeat];
}

function markPlaying() {
  const t = state.queue[state.qi];
  document.querySelectorAll(".track").forEach((li) => li.classList.toggle("is-playing", !!t && li.dataset.track === t.id));
}

function setMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const t = state.queue[state.qi];
  const rel = relById(t.release_id);
  const art = urlFor(rel?.cover_path);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title, artist: state.profile.name || "", album: rel?.title || "",
    artwork: art ? [{ src: art, sizes: "512x512" }] : [],
  });
}
if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler("play", () => audio.play());
  ms.setActionHandler("pause", () => audio.pause());
  ms.setActionHandler("previoustrack", prev);
  ms.setActionHandler("nexttrack", () => next(false));
  try { ms.setActionHandler("seekto", (d) => { audio.currentTime = d.seekTime; }); } catch {}
}

$play.addEventListener("click", togglePlay);
document.getElementById("p-prev").addEventListener("click", prev);
document.getElementById("p-next").addEventListener("click", () => next(false));
$repeat.addEventListener("click", () => {
  state.repeat = { off: "all", all: "one", one: "off" }[state.repeat];
  updatePlayerUI();
  toast($repeat.title);
});
$pheart.addEventListener("click", () => {
  const t = state.queue[state.qi];
  if (t) toggleHeart(t.id).catch((e) => toast("Oops: " + e.message, 4000));
});
document.getElementById("p-art").addEventListener("click", () => {
  const t = state.queue[state.qi];
  if (t) location.hash = `#/release/${t.release_id}`;
});

audio.addEventListener("play", () => { document.body.classList.remove("is-paused"); $play.innerHTML = I.pause; });
audio.addEventListener("pause", () => { document.body.classList.add("is-paused"); $play.innerHTML = I.play; });
audio.addEventListener("ended", () => next(true));
audio.addEventListener("loadedmetadata", () => { document.getElementById("p-dur").textContent = fmtTime(audio.duration); });
audio.addEventListener("timeupdate", () => {
  if (seeking || !audio.duration) return;
  const p = audio.currentTime / audio.duration;
  $range.value = Math.round(p * 1000);
  $range.style.setProperty("--p", p * 100 + "%");
  document.getElementById("p-cur").textContent = fmtTime(audio.currentTime);
});
audio.addEventListener("error", async () => {
  // Most likely an expired link: re-sign once and resume.
  const t = state.queue[state.qi];
  if (!t || audio.dataset.retried === t.id) return;
  audio.dataset.retried = t.id;
  state.urls.delete(t.audio_path);
  await signPaths([t.audio_path]);
  const pos = audio.currentTime;
  if (urlFor(t.audio_path)) { audio.src = urlFor(t.audio_path); audio.currentTime = pos; audio.play().catch(() => {}); }
});
$range.addEventListener("input", () => {
  seeking = true;
  const p = $range.value / 1000;
  $range.style.setProperty("--p", p * 100 + "%");
  document.getElementById("p-cur").textContent = fmtTime(p * (audio.duration || 0));
});
$range.addEventListener("change", () => {
  if (audio.duration) audio.currentTime = ($range.value / 1000) * audio.duration;
  seeking = false;
});
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !e.target.closest("input, textarea, button, [contenteditable]") && audio.src) {
    e.preventDefault(); togglePlay();
  }
});

/* ---------------------------------------------------------------- modals */

function modal({ title, body, submit = "Save", danger, onSubmit, onDanger, onOpen, onClose }) {
  $modal.innerHTML = `<div class="modal-back"><form class="modal" novalidate>
    <h2>${title}</h2>
    ${body}
    <p class="err" data-m="err"></p>
    <div class="m-actions">
      ${danger ? `<button type="button" class="btn danger" data-m="danger">${I.trash} ${danger}</button>` : ""}
      <span class="grow"></span>
      <button type="button" class="btn" data-m="cancel">Cancel</button>
      <button type="submit" class="btn primary">${submit}</button>
    </div></form></div>`;
  const back = $modal.firstElementChild;
  const form = back.querySelector("form");
  const errEl = form.querySelector('[data-m="err"]');
  let busy = false;
  const close = () => {
    if (busy) return;
    if ($modal.firstElementChild === back) $modal.innerHTML = "";
    document.removeEventListener("keydown", onKey);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
  form.querySelector('[data-m="cancel"]').addEventListener("click", close);
  const run = async (fn, btn) => {
    busy = true; errEl.textContent = "";
    form.querySelectorAll("button").forEach((b) => (b.disabled = true));
    const label = btn.innerHTML;
    btn.textContent = "Saving…";
    try {
      const keepOpen = await fn(new FormData(form), form);
      busy = false;
      if (keepOpen !== true) close();
    } catch (err) {
      console.error(err);
      busy = false;
      errEl.textContent = err.message || String(err);
      btn.innerHTML = label;
      form.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }
  };
  form.addEventListener("submit", (e) => { e.preventDefault(); run(onSubmit, form.querySelector('[type="submit"]')); });
  if (danger) form.querySelector('[data-m="danger"]').addEventListener("click", (e) => run(onDanger, e.currentTarget));
  onOpen?.(form);
  setTimeout(() => form.querySelector("input[type=text], textarea")?.focus(), 30);
}

function confirmBox(title, text, yes = "Delete") {
  return new Promise((resolve) => {
    modal({
      title, body: `<p>${esc(text)}</p>`, submit: yes,
      onSubmit: () => resolve(true),
      onClose: () => resolve(false), // no-op if already resolved true
    });
  });
}

const field = (label, inner, hint = "") => `<label class="field"><span>${label}</span>${inner}${hint ? `<em>${hint}</em>` : ""}</label>`;

function imagePreview(form, inputName, imgSel) {
  form.querySelector(`[name=${inputName}]`).addEventListener("change", (e) => {
    const f = e.target.files[0];
    const img = form.querySelector(imgSel);
    if (f && img) { img.src = URL.createObjectURL(f); img.hidden = false; }
  });
}

/* profile */
function editProfile() {
  const p = state.profile;
  const av = urlFor(p.avatar_path);
  modal({
    title: "Your profile",
    body: `
      ${field("Your name (as the singer)", `<input type="text" name="name" value="${esc(p.name)}" required maxlength="80">`)}
      ${field("Bio", `<textarea name="bio" maxlength="600">${esc(p.bio)}</textarea>`)}
      ${field("Who are these songs for?", `<input type="text" name="listener_name" value="${esc(p.listener_name)}" maxlength="40" placeholder="her name or a nickname">`, "Shows as “songs for …” on the home page.")}
      ${field("A little note on the home page", `<textarea name="welcome" maxlength="1000" placeholder="optional">${esc(p.welcome)}</textarea>`)}
      ${field("Profile picture", `<input type="file" name="avatar" accept="image/*"><img class="preview-img" ${av ? `src="${esc(av)}"` : "hidden"} alt="">`)}`,
    onOpen: (form) => imagePreview(form, "avatar", ".preview-img"),
    onSubmit: async (fd) => {
      const name = fd.get("name").trim();
      if (!name) throw new Error("Add a name first.");
      const patch = { name, bio: fd.get("bio").trim(), listener_name: fd.get("listener_name").trim(), welcome: fd.get("welcome").trim(), updated_at: new Date().toISOString() };
      const file = fd.get("avatar");
      let old = null;
      if (file && file.size) { patch.avatar_path = await uploadImage(file, "avatars"); old = p.avatar_path; }
      const { error } = await sb.from("profile").update(patch).eq("id", 1);
      if (error) throw error;
      if (old) removeFiles([old]);
      await refresh();
      toast("Profile saved ♡");
    },
  });
}

/* release */
function editRelease(rel, kind = "album") {
  const isNew = !rel;
  const k = rel?.kind || kind;
  const color = safeColor(rel?.color || COLORS[Math.floor(Math.random() * COLORS.length)]);
  const cover = urlFor(rel?.cover_path);
  const today = new Date().toISOString().slice(0, 10);
  modal({
    title: isNew ? `New ${k}` : `Edit ${rel.title}`,
    danger: isNew ? null : `Delete ${rel.kind}`,
    submit: isNew ? "Create" : "Save",
    body: `
      <div class="field"><span>Type</span><div class="seg">
        <label><input type="radio" name="kind" value="album" ${k === "album" ? "checked" : ""}><span>Album</span></label>
        <label><input type="radio" name="kind" value="single" ${k === "single" ? "checked" : ""}><span>Single</span></label>
      </div></div>
      ${field("Title", `<input type="text" name="title" value="${esc(rel?.title)}" required maxlength="120">`)}
      ${field("Description", `<textarea name="description" maxlength="2000" placeholder="what this one is about…">${esc(rel?.description)}</textarea>`)}
      ${field("Release date", `<input type="date" name="released_on" value="${esc(rel?.released_on || today)}">`)}
      <div class="field"><span>Color</span><div class="swatches">
        ${COLORS.map((c) => `<label><input type="radio" name="color" value="${c}" ${c === color ? "checked" : ""}><i style="background:${c}"></i></label>`).join("")}
        <input type="color" name="custom_color" value="${color}" title="Pick any color">
      </div></div>
      ${field("Cover art", `<input type="file" name="cover" accept="image/*"><img class="preview-img" ${cover ? `src="${esc(cover)}"` : "hidden"} alt="">`, "Square images look best.")}
      ${isNew ? field("Songs (optional)", `<input type="file" name="songs" accept="audio/*" multiple>`, `Pick one or more audio files (mp3, m4a, wav…), up to ${MAX_AUDIO_MB} MB each. You can add more later.`) : ""}`,
    onOpen: (form) => {
      imagePreview(form, "cover", ".preview-img");
      const custom = form.querySelector("[name=custom_color]");
      custom.addEventListener("input", () => form.querySelectorAll("[name=color]").forEach((r) => (r.checked = false)));
    },
    onSubmit: async (fd) => {
      const title = fd.get("title").trim();
      if (!title) throw new Error("Give it a title first.");
      const row = {
        kind: fd.get("kind"), title,
        description: fd.get("description").trim(),
        released_on: fd.get("released_on") || null,
        color: safeColor(fd.get("color") || fd.get("custom_color")),
      };
      const file = fd.get("cover");
      let oldCover = null;
      if (file && file.size) { row.cover_path = await uploadImage(file, "covers"); oldCover = rel?.cover_path; }
      let id = rel?.id;
      if (isNew) {
        const { data, error } = await sb.from("releases").insert(row).select().single();
        if (error) throw error;
        id = data.id;
      } else {
        const { error } = await sb.from("releases").update(row).eq("id", id);
        if (error) throw error;
      }
      if (oldCover) removeFiles([oldCover]);
      const songs = fd.getAll("songs").filter((f) => f && f.size);
      await refresh();
      location.hash = `#/release/${id}`;
      if (songs.length) await addSongs(relById(id), songs, row.kind === "single" && songs.length === 1 ? title : null);
      else toast(isNew ? `${row.kind === "album" ? "Album" : "Single"} created ♡` : "Saved ♡");
    },
    onDanger: async () => {
      const ok = await confirmBox(`Delete “${rel.title}”?`, `This removes the ${rel.kind} and all ${tracksOf(rel.id).length} of its songs for good.`);
      if (!ok) return;
      const files = [rel.cover_path, ...tracksOf(rel.id).map((t) => t.audio_path)];
      const { error } = await sb.from("releases").delete().eq("id", rel.id);
      if (error) throw error;
      removeFiles(files);
      if (state.queue[state.qi]?.release_id === rel.id) teardownPlayerOnly();
      location.hash = "#/";
      await refresh();
      toast("Deleted");
    },
  });
}

function teardownPlayerOnly() {
  audio.pause(); audio.removeAttribute("src");
  state.queue = []; state.qi = -1;
  $player.hidden = true;
}

/* songs */
function pickSongs(rel) {
  const input = document.createElement("input");
  input.type = "file"; input.accept = "audio/*"; input.multiple = true;
  input.addEventListener("change", () => {
    const files = [...input.files];
    if (files.length) addSongs(rel, files).catch((e) => toast("Upload failed: " + e.message, 6000));
  });
  input.click();
}

function titleFromFile(name) {
  return name.replace(/\.[^.]+$/, "").replace(/^\s*\d{1,3}\s*[-_.)\s]\s*/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim() || "Untitled";
}

async function addSongs(rel, files, forcedTitle = null) {
  const good = files.filter((f) => f.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm)$/i.test(f.name));
  const tooBig = good.filter((f) => f.size > MAX_AUDIO_MB * 1024 * 1024);
  const list = good.filter((f) => !tooBig.includes(f));
  if (!list.length) { toast(tooBig.length ? `Files over ${MAX_AUDIO_MB} MB can't be uploaded on the free plan` : "Those don't look like audio files", 5000); return; }
  let pos = Math.max(-1, ...tracksOf(rel.id).map((t) => t.position ?? 0)) + 1;
  let done = 0;
  for (const f of list) {
    toast(`Uploading ${done + 1} of ${list.length}: ${f.name}`, 0);
    const [path, duration] = await Promise.all([uploadFile(f, "audio"), audioDuration(f)]);
    const { error } = await sb.from("tracks").insert({
      release_id: rel.id, title: forcedTitle || titleFromFile(f.name), audio_path: path, duration, position: pos++,
    });
    if (error) { removeFiles([path]); throw error; }
    done++;
  }
  await refresh();
  toast(`${done} song${done === 1 ? "" : "s"} added ♡${tooBig.length ? ` (${tooBig.length} skipped — over ${MAX_AUDIO_MB} MB)` : ""}`, 4000);
}

function editTrack(t) {
  if (!t) return;
  modal({
    title: "Edit song",
    danger: "Delete song",
    body: `
      ${field("Title", `<input type="text" name="title" value="${esc(t.title)}" required maxlength="120">`)}
      ${field("Little note", `<input type="text" name="note" value="${esc(t.note)}" maxlength="140" placeholder="e.g. wrote this on a rainy night">`, "Shows under the title.")}
      ${field("Lyrics", `<textarea name="lyrics" style="min-height:160px" placeholder="optional">${esc(t.lyrics)}</textarea>`)}
      ${field("Replace audio file", `<input type="file" name="audio" accept="audio/*">`, "Leave empty to keep the current recording.")}`,
    onSubmit: async (fd) => {
      const title = fd.get("title").trim();
      if (!title) throw new Error("Give it a title first.");
      const patch = { title, note: fd.get("note").trim(), lyrics: fd.get("lyrics").trim() };
      const f = fd.get("audio");
      let old = null;
      if (f && f.size) {
        if (f.size > MAX_AUDIO_MB * 1024 * 1024) throw new Error(`That file is over ${MAX_AUDIO_MB} MB.`);
        const [path, duration] = await Promise.all([uploadFile(f, "audio"), audioDuration(f)]);
        Object.assign(patch, { audio_path: path, duration });
        old = t.audio_path;
      }
      const { error } = await sb.from("tracks").update(patch).eq("id", t.id);
      if (error) throw error;
      if (old) removeFiles([old]);
      await refresh();
      toast("Saved ♡");
    },
    onDanger: async () => {
      const ok = await confirmBox(`Delete “${t.title}”?`, "This removes the song for good.");
      if (!ok) return;
      const { error } = await sb.from("tracks").delete().eq("id", t.id);
      if (error) throw error;
      removeFiles([t.audio_path]);
      await refresh();
      toast("Song deleted");
    },
  });
}

async function moveTrack(id, dir) {
  const t = state.tracks.find((x) => x.id === id);
  const list = tracksOf(t.release_id);
  const i = list.findIndex((x) => x.id === id);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  const updates = list.map((x, k) => ({ x, k })).filter(({ x, k }) => x.position !== k);
  // Optimistic local reorder
  updates.forEach(({ x, k }) => (x.position = k));
  state.tracks.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  route(true);
  const results = await Promise.all(updates.map(({ x, k }) => sb.from("tracks").update({ position: k }).eq("id", x.id)));
  const bad = results.find((r) => r.error);
  if (bad) { await refresh(); throw bad.error; }
}

/* ---------------------------------------------------------------- uploads */

const extOf = (name, fallback) => (/\.([a-z0-9]{1,5})$/i.exec(name)?.[1] || fallback).toLowerCase();

async function uploadFile(blob, folder, ext) {
  const path = `${folder}/${crypto.randomUUID()}.${ext || extOf(blob.name || "", "bin")}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, {
    contentType: blob.type || undefined, cacheControl: "31536000", upsert: false,
  });
  if (error) throw error;
  return path;
}

async function uploadImage(file, folder) {
  if (file.type === "image/gif") return uploadFile(file, folder);
  try {
    const small = await shrinkImage(file, 1400);
    return await uploadFile(small, folder, "jpg");
  } catch {
    return uploadFile(file, folder);
  }
}

function shrinkImage(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const u = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("resize failed"))), "image/jpeg", 0.88);
    };
    img.onerror = () => { URL.revokeObjectURL(u); reject(new Error("not an image")); };
    img.src = u;
  });
}

function audioDuration(file) {
  return new Promise((resolve) => {
    const a = new Audio();
    const u = URL.createObjectURL(file);
    const done = (v) => { URL.revokeObjectURL(u); resolve(v); };
    a.preload = "metadata";
    a.onloadedmetadata = () => done(isFinite(a.duration) ? a.duration : null);
    a.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    a.src = u;
  });
}

function removeFiles(paths) {
  const p = paths.filter(Boolean);
  if (!p.length) return;
  sb.storage.from(BUCKET).remove(p).then(({ error }) => error && console.warn("cleanup", error));
  p.forEach((x) => state.urls.delete(x));
}
