"use strict";

const OWNER = "Tomás";
const MOTTO = "Know the world before you set out to change it.";

// Order = how the Today page reads: the fields closest to the LLM first.
const TOPICS = [
  { id: "PIL", label: "PIL", long: "Public International Law" },
  { id: "ICL", label: "ICL", long: "International Criminal Law" },
  { id: "IHL", label: "IHL", long: "Humanitarian Law" },
  { id: "IHRL", label: "IHRL", long: "Human Rights" },
  { id: "IDS", label: "IDS", long: "Dispute Settlement" },
  { id: "LOS", label: "LOS", long: "Law of the Sea" },
  { id: "GEO", label: "World", long: "The World" },
];
const TOPIC = Object.fromEntries(TOPICS.map((t) => [t.id, t]));
const LAW_FIELDS = TOPICS.filter((t) => t.id !== "GEO");
const COURTS = {
  icj: { abbr: "ICJ", c: "PIL" },
  iccforum: { abbr: "ICC", c: "ICL" },
  itlos: { abbr: "ITLOS", c: "LOS" },
  irmct: { abbr: "IRMCT", c: "ICL" },
  icsid: { abbr: "ICSID", c: "IDS" },
};
const TYPES = { scholarly: "Scholarship", institution: "Institutions", analysis: "Analysis", media: "Media", ngo: "NGOs", voices: "Scholars on Bluesky" };
const LAW_SOURCE_TYPES = new Set(["scholarly", "institution", "ngo"]);
const PAGE = 40;

/* ---------- storage (wrapped: private mode can throw) ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem("jg:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("jg:" + k, JSON.stringify(v)); } catch {} },
};

const state = {
  data: null,
  tab: store.get("tab", "brief"),
  topic: "ALL",
  type: "ALL",
  q: "",
  shown: PAGE,
  saved: store.get("saved", {}),
  read: new Set(store.get("read", [])),
  muted: new Set(store.get("muted", [])),
  hideRead: store.get("hideRead", false),
  theme: store.get("theme", "auto"),
  since: store.get("lastVisit", null),
  fetchedAt: 0,
};
store.set("lastVisit", new Date().toISOString());

const $ = (s, el = document) => el.querySelector(s);
const view = $("#view");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function applyTheme() {
  if (state.theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", state.theme);
}
applyTheme();

/* ---------- time ---------- */
function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 3600) return Math.max(1, Math.floor(s / 60)) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  if (s < 86400 * 7) return Math.floor(s / 86400) + "d";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function dayLabel(iso) {
  const d = new Date(iso), t = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(t) - start(d)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}
function greeting() {
  const h = new Date().getHours();
  return (h < 12 ? "Buenos días" : h < 20 ? "Buenas tardes" : "Buenas noches") + ", " + OWNER + ".";
}

/* ---------- data ---------- */
async function load(manual = false) {
  const btn = $("#refresh");
  btn.classList.add("spin");
  try {
    const r = await fetch("data/news.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    state.data = await r.json();
    state.fetchedAt = Date.now();
    state.srcById = Object.fromEntries(state.data.sources.map((s) => [s.id, s]));
    if (manual) toast("Up to date");
  } catch (e) {
    if (!state.data) view.innerHTML = `<div class="empty"><b>No connection.</b>Couldn't reach the news. Tap refresh when you're back online.</div>`;
    else if (manual) toast("Offline · showing last copy");
  } finally {
    btn.classList.remove("spin");
  }
  if (state.data) {
    $("#updated").textContent = "Updated " + ago(state.data.generated) + " ago";
    render();
  }
}

const visibleItems = () => state.data.items.filter((i) => !state.muted.has(i.source));
const isNew = (i) => state.since && i.date > state.since;
const srcName = (i) => state.srcById?.[i.source]?.name || i.sourceName || i.source;

/* ---------- pieces ---------- */
const ICON = {
  save: '<svg viewBox="0 0 24 24"><path d="M7 4h10v16l-5-3.5L7 20z"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6"/></svg>',
};

const domain = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
function voice(i) {
  const tags = i.topics.map((t) => `<span class="tag" style="--c:var(--t-${t})">${esc(TOPIC[t]?.label || t)}</span>`).join("");
  return `<article class="story voice${state.read.has(i.id) ? " read" : ""}" data-id="${esc(i.id)}">
    <div class="kick">
      ${isNew(i) ? '<span class="new">New</span>' : ""}
      <span class="src">${esc(srcName(i))}</span><span class="when">· Bluesky · ${ago(i.date)}</span>
    </div>
    <div class="actions">
      <button data-act="save" class="${state.saved[i.id] ? "on" : ""}" aria-label="Save">${ICON.save}</button>
      <button data-act="share" aria-label="Share">${ICON.share}</button>
    </div>
    <a class="post-text" href="${esc(i.link)}" target="_blank" rel="noopener" data-act="read">${esc(i.title)}</a>
    ${i.extUrl ? `<a class="ext" href="${esc(i.extUrl)}" target="_blank" rel="noopener" data-act="read"><span class="ext-t">${esc(i.extTitle || i.extUrl)}</span><span class="ext-d">${esc(domain(i.extUrl))} ↗</span></a>` : ""}
    <div class="tags">${tags}</div>
  </article>`;
}

function story(i) {
  if (i.kind === "post") return voice(i);
  const tags = i.topics.map((t) => `<span class="tag" style="--c:var(--t-${t})">${esc(TOPIC[t]?.label || t)}</span>`).join("");
  const law = i.lawAngle ? `<span class="tag law">Law × politics</span>` : "";
  return `<article class="story${state.read.has(i.id) ? " read" : ""}" data-id="${esc(i.id)}">
    <div class="kick">
      ${isNew(i) ? '<span class="new">New</span>' : ""}
      <span class="src">${esc(srcName(i))}</span><span class="when">· ${ago(i.date)}</span>
    </div>
    <div class="actions">
      <button data-act="save" class="${state.saved[i.id] ? "on" : ""}" aria-label="Save">${ICON.save}</button>
      <button data-act="share" aria-label="Share">${ICON.share}</button>
    </div>
    <h3><a href="${esc(i.link)}" target="_blank" rel="noopener" data-act="read">${esc(i.title)}</a></h3>
    ${i.summary ? `<p class="sum" data-act="expand">${esc(i.summary)}</p>` : ""}
    <div class="tags">${law}${tags}</div>
  </article>`;
}

function docket(i) {
  const c = COURTS[i.source];
  const ref = /press release|ITLOS\/Press/i.test(i.summary) && i.summary.length < 60 ? i.summary : "Press release";
  return `<a class="docket" href="${esc(i.link)}" target="_blank" rel="noopener" data-act="read" data-id="${esc(i.id)}" style="--c:var(--t-${c.c})">
    <div class="court"><span class="badge">${c.abbr}</span><small>${esc(new Date(i.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }))}</small></div>
    <h3>${esc(i.title)}</h3>
    <div class="ref">${esc(ref)}</div>
  </a>`;
}

function sh({ kicker, title, num, color, goto, lede }) {
  return `<div class="sh">
    ${kicker ? `<div class="kicker">${esc(kicker)}</div>` : ""}
    <div class="row"><h2${color ? ` style="--c:${color}"` : ""}>${color ? '<span class="dot"></span>' : ""}${esc(title)}</h2>
    ${goto ? `<button class="see" data-goto="${goto}">See all →</button>` : ""}</div>
    ${lede ? `<p class="lede">${esc(lede)}</p>` : ""}
  </div>`;
}

/* ---------- Today ---------- */
function renderBrief() {
  const all = visibleItems();
  const items = all.filter((i) => i.kind !== "post");
  const posts = all.filter((i) => i.kind === "post");
  const cutoff = Date.now() - 36 * 3600 * 1000;
  const fresh = items.filter((i) => new Date(i.date) > cutoff);
  const newCount = items.filter(isNew).length;
  const used = new Set();
  const take = (list, n) => { const out = list.filter((i) => !used.has(i.id)).slice(0, n); out.forEach((i) => used.add(i.id)); return out; };

  const counts = LAW_FIELDS.map((t) => ({ t, n: fresh.filter((i) => i.topics.includes(t.id)).length }));
  const total = counts.reduce((a, b) => a + b.n, 0) || 1;
  const worldN = fresh.filter((i) => i.topics.includes("GEO")).length;
  const dateline = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  let html = `<section class="masthead">
    <div class="dateline">${esc(dateline)}</div>
    <h2 class="greet">${esc(greeting())}</h2>
    <p class="motto">${esc(MOTTO)}</p>
    <p class="newline">${newCount ? `${newCount} new since you last looked` : "Nothing new since you last looked"}</p>
    <div class="pulse" aria-hidden="true">${counts.filter((x) => x.n).map((x) => `<i style="--c:var(--t-${x.t.id});flex:${x.n / total}"></i>`).join("")}</div>
    <div class="legend">${counts.map((x) => `<button data-goto="${x.t.id}" style="--c:var(--t-${x.t.id})"><span class="dot"></span>${x.t.label}<b>${x.n}</b></button>`).join("")}</div>
    <p class="world-note">Last 36 hours, by field · plus <button data-goto="GEO">${worldN} world stories</button></p>
  </section>`;

  const bench = take(items.filter((i) => COURTS[i.source] && Date.now() - new Date(i.date) < 45 * 86400000), 6);
  if (bench.length) {
    html += sh({ kicker: "Courts & tribunals", title: "From the bench" });
    html += `<div class="bench">${bench.map(docket).join("")}</div>`;
  }

  const ctx = take(items.filter((i) => i.lawAngle), 3);
  if (ctx.length) {
    html += sh({ kicker: "Law × politics", title: "Law in context", goto: "LAW", lede: "The politics around the law, from the newsrooms and the think tanks." });
    html += `<div class="context"><div class="list">${ctx.map(story).join("")}</div></div>`;
  }

  LAW_FIELDS.forEach((t) => {
    const pool = items.filter((i) => i.topics.includes(t.id));
    const core = pool.filter((i) => LAW_SOURCE_TYPES.has(state.srcById[i.source]?.type));
    const list = take(core, 2);
    if (list.length < 2) list.push(...take(pool, 2 - list.length));
    if (!list.length) return;
    list.sort((a, b) => (a.date < b.date ? 1 : -1));
    html += sh({ title: t.long, color: `var(--t-${t.id})`, goto: t.id });
    html += `<div class="list">${list.map(story).join("")}</div>`;
  });

  const world = take(items.filter((i) => i.topics.includes("GEO") && !i.lawAngle), 3);
  if (world.length) {
    html += sh({ title: "The World", color: "var(--t-GEO)", goto: "GEO", lede: "What's moving the geopolitics the law has to live in." });
    html += `<div class="list">${world.map(story).join("")}</div>`;
  }

  const voices = [];
  for (const p of posts) { if (voices.length === 3) break; if (!voices.some((v) => v.source === p.source)) voices.push(p); }
  if (voices.length) {
    html += sh({ kicker: "Voices", title: "Scholars on Bluesky", goto: "VOICES", lede: "What international lawyers are saying, in their own words. Personal views, not edited journalism." });
    html += `<div class="list">${voices.map(voice).join("")}</div>`;
  }

  html += sh({ kicker: "Para pensar", title: "Questions to sit with", lede: "Open questions across the fields, each paired with today's stories." });
  html += `<div class="questions" id="questions">${questionsHTML(items, fresh)}</div>`;
  html += `<p class="signoff">That's the world today. Now go change it.</p>`;
  view.innerHTML = html;
}

/* ---------- Questions to sit with ---------- */
let qOffset = 0;
function pickQuestions(fresh, n = 3) {
  const bank = window.JG_QUESTIONS || [];
  if (!bank.length) return [];
  const heat = {};
  for (const i of fresh) for (const t of i.topics) heat[t] = (heat[t] || 0) + (t === "GEO" ? 0.15 : 1);
  const day = Math.floor(Date.now() / 86400000);
  // Deterministic per day: score by how busy the question's fields are, plus a daily shuffle.
  const rnd = (k) => { const x = Math.sin((day + qOffset * 7.3) * 99.1 + k * 12.9898) * 43758.5453; return x - Math.floor(x); };
  return bank
    .map((q, k) => ({ q, s: q.f.reduce((a, f) => a + Math.sqrt(heat[f] || 0), 0) / q.f.length + rnd(k) * 3 }))
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.q);
}
const STOP = new Set("about after again against being between could does every other their there these those today today's under until where which while whose would should still what when with from into than that this they them were have will your more most only same make made like just over also each very much many such world international state states story stories news people".split(" "));
const stem = (w) => w.toLowerCase().replace(/[^a-z]/g, "").replace(/(ing|ions?|ies|es|s)$/, "");
// Pair a question with the recent stories that share its vocabulary and fields.
function readAlongside(q, items) {
  const words = new Set(q.q.split(/\s+/).map(stem).filter((w) => w.length >= 4 && !STOP.has(w)));
  const now = Date.now();
  const scored = items
    .filter((i) => i.kind !== "post" && now - new Date(i.date) < 10 * 86400000 && i.topics.some((t) => q.f.includes(t)))
    .map((i) => {
      const hits = new Set((i.title + " " + i.summary).split(/\s+/).map(stem).filter((w) => words.has(w))).size;
      const fields = i.topics.filter((t) => q.f.includes(t) && t !== "GEO").length;
      const quality = LAW_SOURCE_TYPES.has(state.srcById[i.source]?.type) || i.lawAngle ? 1 : 0;
      return { i, s: hits * 3 + fields * 1.5 + quality - (now - new Date(i.date)) / 86400000 * 0.2 };
    })
    .sort((a, b) => b.s - a.s);
  const out = [];
  for (const { i } of scored) {
    if (out.length === 2) break;
    if (!out.some((o) => o.source === i.source)) out.push(i);
  }
  return out;
}
function questionsHTML(items, fresh) {
  const qs = pickQuestions(fresh);
  return qs.map((q, n) => {
    const reads = readAlongside(q, items);
    const fields = q.f.map((f) => `<span style="--c:var(--t-${f})">${esc(TOPIC[f]?.label || f)}</span>`).join("");
    const links = reads.map((i) => `<a href="${esc(i.link)}" target="_blank" rel="noopener" data-act="read" data-id="${esc(i.id)}">${esc(i.title)} <span>· ${esc(srcName(i))}</span></a>`).join("");
    return `<article class="q">
      <div class="q-top"><div class="q-fields">${fields}</div><span class="q-num">${["i", "ii", "iii"][n]}</span></div>
      <p class="q-text">${esc(q.q)}</p>
      ${links ? `<div class="q-read"><div class="lbl">Read alongside</div>${links}</div>` : ""}
    </article>`;
  }).join("") + `<button class="q-more" data-act="moreq">Other questions</button>`;
}

/* ---------- All (feed) ---------- */
function feedFiltered() {
  const terms = state.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return visibleItems().filter((i) => {
    if (state.topic === "LAW" ? !i.lawAngle : state.topic !== "ALL" && !i.topics.includes(state.topic)) return false;
    if (state.type !== "ALL") {
      const t = state.srcById[i.source]?.type;
      if (state.type === "media" ? !(t === "media" || t === "analysis") : t !== state.type) return false;
    }
    if (state.hideRead && state.read.has(i.id)) return false;
    if (terms.length) {
      const hay = (i.title + " " + i.summary + " " + srcName(i)).toLowerCase();
      return terms.every((w) => hay.includes(w));
    }
    return true;
  });
}

function renderFeed(keepControls = false) {
  const chip = (id, label, mark, on) => `<button class="chip${on ? " on" : ""}" data-topic="${id}">${mark}${esc(label)}</button>`;
  const topicChips = [chip("ALL", "All", "", state.topic === "ALL"), chip("LAW", "Law × politics", '<span class="ring"></span>', state.topic === "LAW")]
    .concat(TOPICS.map((t) => chip(t.id, t.label, `<span class="dot" style="--c:var(--t-${t.id})"></span>`, state.topic === t.id))).join("");
  const typeOpts = [["ALL", "All sources"], ["scholarly", "Scholarship"], ["institution", "Institutions"], ["media", "Media & analysis"], ["ngo", "NGOs"], ["voices", "Scholars"]];
  const typeChips = typeOpts.map(([id, l]) => `<button class="chip${state.type === id ? " on" : ""}" data-type="${id}">${l}</button>`).join("");

  if (!keepControls || !$(".controls")) {
    view.innerHTML = `<div class="controls">
        <input class="search" type="search" placeholder="Search · Gambia v. Myanmar, ITLOS…" value="${esc(state.q)}" enterkeyhint="search" autocomplete="off">
        <div class="chips" id="topicChips">${topicChips}</div>
        <div class="chips small" id="typeChips">${typeChips}</div>
      </div><div id="results"></div>`;
  } else {
    $("#topicChips").innerHTML = topicChips;
    $("#typeChips").innerHTML = typeChips;
  }
  document.querySelectorAll(".chips .chip.on").forEach((c) => {
    const row = c.parentElement;
    row.scrollLeft = c.offsetLeft - row.clientWidth / 2 + c.clientWidth / 2;
  });

  const list = feedFiltered();
  let html = `<p class="count">${list.length} ${list.length === 1 ? "story" : "stories"}</p>`;
  if (!list.length) {
    html += `<div class="empty"><b>Nothing here.</b>Try another field, or loosen the search.</div>`;
  } else {
    let lastDay = "";
    html += list.slice(0, state.shown).map((i) => {
      const d = dayLabel(i.date);
      const h = d !== lastDay ? `<div class="day-h">${esc(d)}</div>` : "";
      lastDay = d;
      return h + story(i);
    }).join("");
    if (list.length > state.shown) html += `<button class="more" data-act="more">Show more · ${list.length - state.shown} left</button>`;
  }
  $("#results").innerHTML = html;
}

/* ---------- Reading list ---------- */
function renderSaved() {
  const list = Object.values(state.saved).sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  view.innerHTML = sh({ kicker: "Kept for later", title: "Reading list" }) + (list.length
    ? `<div class="list">${list.map(story).join("")}</div>`
    : `<div class="empty"><b>Nothing saved yet.</b>Bookmark a story and it waits here, even after it leaves the feed. Good for the ones worth a footnote.</div>`);
}

/* ---------- Sources ---------- */
function renderSources() {
  const groups = {};
  for (const s of state.data.sources) (groups[s.type] ||= []).push(s);
  const seg = (k, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-pref="${k}" data-val="${v}" class="${String(state[k]) === v ? "on" : ""}">${l}</button>`).join("")}</div>`;
  let html = sh({ kicker: "Settings", title: "Preferences" }) + `<div class="group">
    <div class="pref"><span>Appearance</span>${seg("theme", [["auto", "Auto"], ["light", "Day"], ["dark", "Night"]])}</div>
    <div class="pref"><span>Hide stories I've opened</span><button class="switch" role="switch" aria-checked="${state.hideRead}" data-act="hideRead" aria-label="Hide read stories"></button></div></div>`;
  for (const type of Object.keys(TYPES)) {
    if (!groups[type]) continue;
    html += sh({ kicker: `${groups[type].length} sources`, title: TYPES[type] });
    html += `<div class="group">` + groups[type].sort((a, b) => a.name.localeCompare(b.name)).map((s) => {
      const tags = (s.topics || []).map((t) => TOPIC[t]?.label || t).join(" · ");
      const status = s.ok ? (s.bio ? `${esc(s.bio)} · ${s.count} recent` : `${s.count} recent`) : `<span class="err">unreachable right now</span>`;
      return `<div class="src-row">
        <div class="info"><div class="name"><a href="${esc(s.site)}" target="_blank" rel="noopener">${esc(s.name)}</a></div>
        <div class="sub">${status}${tags ? " · " + esc(tags) : ""}</div></div>
        <button class="switch" role="switch" aria-checked="${!state.muted.has(s.id)}" data-src="${esc(s.id)}" aria-label="Show ${esc(s.name)}"></button>
      </div>`;
    }).join("") + `</div>`;
  }
  html += `<div class="note">
      <p class="sig">“By knowing about politics, you can learn much more about the context in which the law is embedded.”</p>
      <p><b>How it works.</b> Every two hours the app reads the outlets above (their RSS feeds, or the courts' own press-release pages) and links straight to the original. Nothing is rewritten.</p>
      <p>Fields are tagged from each outlet's specialism plus keywords, so the odd tag will be off. <b>Law × Politics</b> marks a news or think-tank piece that raises a legal question.</p>
      <p><b>Scholars on Bluesky</b> shows each scholar's own posts from the last two weeks, and only those touching international law. Replies, reposts and the rest are left out. These are personal views, not edited journalism.</p>
      <p class="meta">Data refreshed ${esc(new Date(state.data.generated).toLocaleString("en-GB"))}</p>
    </div>`;
  view.innerHTML = html;
}

function render() {
  if (!state.data) return;
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  ({ brief: renderBrief, feed: renderFeed, saved: renderSaved, sources: renderSources })[state.tab]();
}
function go(tab) {
  state.tab = tab;
  store.set("tab", tab);
  render();
  window.scrollTo(0, 0);
}

/* ---------- interactions ---------- */
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}
function markRead(id) {
  if (!id || state.read.has(id)) return;
  state.read.add(id);
  store.set("read", [...state.read].slice(-3000));
}
const itemById = (id) => state.data?.items.find((i) => i.id === id) || state.saved[id];

document.querySelector(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (b) go(b.dataset.tab);
});
$("#refresh").addEventListener("click", () => load(true));

view.addEventListener("click", async (e) => {
  const goto = e.target.closest("[data-goto]");
  if (goto) {
    const g = goto.dataset.goto;
    state.topic = g === "VOICES" ? "ALL" : g; state.type = g === "VOICES" ? "voices" : "ALL"; state.q = ""; state.shown = PAGE;
    return go("feed");
  }
  const tchip = e.target.closest("[data-topic]");
  if (tchip) { state.topic = tchip.dataset.topic; state.shown = PAGE; return renderFeed(true); }
  const ychip = e.target.closest("[data-type]");
  if (ychip) { state.type = ychip.dataset.type; state.shown = PAGE; return renderFeed(true); }

  const pref = e.target.closest("[data-pref]");
  if (pref) {
    state[pref.dataset.pref] = pref.dataset.val; store.set(pref.dataset.pref, pref.dataset.val);
    applyTheme(); return renderSources();
  }
  const srcSw = e.target.closest("[data-src]");
  if (srcSw) {
    const id = srcSw.dataset.src;
    state.muted.has(id) ? state.muted.delete(id) : state.muted.add(id);
    store.set("muted", [...state.muted]);
    srcSw.setAttribute("aria-checked", String(!state.muted.has(id)));
    return;
  }

  const act = e.target.closest("[data-act]");
  if (!act) return;
  const el = act.closest(".story, .docket, .q-read a");
  const id = el?.dataset.id;
  switch (act.dataset.act) {
    case "read":
      markRead(id);
      if (el?.classList.contains("story")) setTimeout(() => el.classList.add("read"), 400);
      break;
    case "expand":
      el.classList.toggle("open");
      break;
    case "save": {
      if (state.saved[id]) { delete state.saved[id]; act.classList.remove("on"); toast("Removed from reading list"); }
      else {
        const it = itemById(id);
        state.saved[id] = { ...it, sourceName: srcName(it), savedAt: new Date().toISOString() };
        act.classList.add("on"); toast("Added to reading list");
      }
      store.set("saved", state.saved);
      if (state.tab === "saved") renderSaved();
      break;
    }
    case "share": {
      const it = itemById(id);
      try {
        if (navigator.share) await navigator.share({ title: it.title, url: it.link });
        else { await navigator.clipboard.writeText(it.link); toast("Link copied"); }
      } catch {}
      break;
    }
    case "moreq":
      qOffset++;
      $("#questions").innerHTML = questionsHTML(visibleItems(), visibleItems().filter((i) => Date.now() - new Date(i.date) < 36 * 3600 * 1000));
      break;
    case "more":
      state.shown += PAGE; renderFeed(true);
      break;
    case "hideRead":
      state.hideRead = !state.hideRead; store.set("hideRead", state.hideRead);
      act.setAttribute("aria-checked", String(state.hideRead));
      break;
  }
});

let searchTimer;
view.addEventListener("input", (e) => {
  if (!e.target.matches(".search")) return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.q = e.target.value; state.shown = PAGE; renderFeed(true); }, 180);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - state.fetchedAt > 20 * 60 * 1000) load();
  if (document.visibilityState === "hidden") store.set("lastVisit", new Date().toISOString());
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

load();
