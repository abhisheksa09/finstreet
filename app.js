// FinStreet PWA — vanilla JS, no build step.
// All feed text is rendered with textContent (never innerHTML): headlines come from third parties.
(() => {
  "use strict";

  const API = window.APP_CONFIG.apiBase.replace(/\/$/, "");
  const PAGE_SIZE = 50;

  // ── Storage (may be unavailable: private mode, blocked site data) ──────────
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
    },
  };

  const state = {
    region: store.get("region", "india"),
    sector: null,
    followed: new Set(store.get("watchlist", [])), // key kept from v1 so existing picks survive
    meta: null,
    feed: { stories: [], nextBefore: null, loading: false },
    mine: { stories: [], nextBefore: null, loading: false },
    picking: false,
  };

  // ── Helpers ────────────────────────────────────────────────────────────────
  const $ = sel => document.querySelector(sel);

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  }

  const isWebUrl = u => /^https?:\/\//i.test(u);

  function timeAgo(unix) {
    const s = Math.max(0, Date.now() / 1000 - unix);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  async function api(path) {
    const res = await fetch(API + path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  const companyName = sym => state.meta?.companies.find(c => c.symbol === sym)?.name ?? sym;

  function saveFollowed() {
    store.set("watchlist", [...state.followed]);
  }

  // ── Theme: auto (system) → light → dark ────────────────────────────────────
  const THEMES = ["auto", "light", "dark"];
  const THEME_LABEL = { auto: "◐ Auto", light: "☀ Light", dark: "☾ Dark" };

  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === "auto") delete root.dataset.theme;
    else root.dataset.theme = theme;
    const btn = $("#themeBtn");
    btn.textContent = THEME_LABEL[theme];
    btn.setAttribute("aria-label", `Theme: ${theme}. Tap to change.`);
    const dark = theme === "dark" || (theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.querySelector('meta[name="theme-color"]').content = dark ? "#141a21" : "#0f766e";
  }

  // ── Story rendering (shared by Feed and My Stocks) ─────────────────────────
  function storyItem(story, { showFollowed = false } = {}) {
    const links = story.links.filter(l => isWebUrl(l.url));
    const first = links[0];
    const label = l => (l.section ? `${l.publisher} · ${l.section}` : l.publisher);

    const title = first
      ? el("a", { class: "title", href: first.url, target: "_blank", rel: "noopener noreferrer", text: story.title })
      : el("span", { class: "title", text: story.title });

    const item = el("li", { class: "story" });

    if (showFollowed) {
      const mine = story.companies.filter(c => state.followed.has(c));
      item.append(el("div", { class: "story-stocks" },
        ...mine.map(c => el("span", { class: "stock-tag", title: companyName(c), text: c })),
        el("span", { class: "region-tag", text: story.region === "india" ? "India" : "Global" }),
      ));
    }

    const meta = el("div", { class: "meta" },
      el("span", { class: "publisher", text: first ? label(first) : "" }),
      el("span", { text: ` · ${timeAgo(story.first_seen_at)}` }),
      ...story.sectors.map(s => el("span", { class: "tag", text: s })),
    );
    item.append(title, meta);

    if (links.length > 1) {
      const more = el("ul", { class: "more-sources", hidden: true },
        ...links.slice(1).map(l => el("li", {},
          el("a", { href: l.url, target: "_blank", rel: "noopener noreferrer", text: label(l) }))));
      const btn = el("button", {
        class: "sources-btn",
        "aria-expanded": "false",
        text: `+${links.length - 1} source${links.length > 2 ? "s" : ""}`,
        onclick: () => {
          more.hidden = !more.hidden;
          btn.setAttribute("aria-expanded", String(!more.hidden));
        },
      });
      item.append(btn, more);
    }
    return item;
  }

  async function loadInto(list, params, { append, statusEl }) {
    if (list.loading) return;
    list.loading = true;
    statusEl.textContent = append ? "Loading more…" : "Loading…";
    try {
      if (append && list.nextBefore) params.set("before", list.nextBefore);
      params.set("limit", PAGE_SIZE);
      const data = await api(`/api/feed?${params}`);
      list.stories = append ? list.stories.concat(data.stories) : data.stories;
      list.nextBefore = data.next_before;
      statusEl.textContent = "";
    } catch (e) {
      statusEl.textContent = navigator.onLine
        ? `Couldn't load headlines (${e.message}). Pull down to retry.`
        : "You're offline. Showing the last headlines loaded.";
    } finally {
      list.loading = false;
    }
  }

  // ── Feed tab ───────────────────────────────────────────────────────────────
  async function loadCounts() {
    try {
      const params = new URLSearchParams();
      if (state.sector) params.set("sector", state.sector);
      const counts = await api(`/api/counts?${params}`);
      document.querySelectorAll("[data-count]").forEach(b => (b.textContent = counts[b.dataset.count] ?? ""));
    } catch {
      document.querySelectorAll("[data-count]").forEach(b => (b.textContent = ""));
    }
  }

  async function loadFeed({ append = false } = {}) {
    if (!append) loadCounts();
    const params = new URLSearchParams({ region: state.region });
    if (state.sector) params.set("sector", state.sector);
    await loadInto(state.feed, params, { append, statusEl: $("#feedStatus") });
    renderFeed();
  }

  function renderFeed() {
    document.querySelectorAll(".tab").forEach(t =>
      t.setAttribute("aria-selected", String(t.dataset.region === state.region)));
    document.querySelectorAll("#sectorChips .chip").forEach(c =>
      c.classList.toggle("on", (c.dataset.sector || null) === state.sector));

    $("#storyList").replaceChildren(...state.feed.stories.map(s => storyItem(s)));
    const status = $("#feedStatus");
    if (!state.feed.loading && !status.textContent && !state.feed.stories.length) {
      status.textContent = "No headlines yet.";
    }
    $("#loadMore").hidden = !state.feed.nextBefore;
  }

  function renderSectorChips() {
    const chips = [el("button", { class: "chip", "data-sector": "", text: "All sectors" })]
      .concat((state.meta?.sectors ?? []).map(s => el("button", { class: "chip", "data-sector": s, text: s })));
    $("#sectorChips").replaceChildren(...chips);
  }

  // ── My Stocks tab ──────────────────────────────────────────────────────────
  async function loadMyStocks({ append = false } = {}) {
    if (!state.followed.size) {
      state.mine = { stories: [], nextBefore: null, loading: false };
      renderMyStocks();
      return;
    }
    const params = new URLSearchParams({ companies: [...state.followed].join(",") });
    await loadInto(state.mine, params, { append, statusEl: $("#myStatus") });
    renderMyStocks();
  }

  function renderMyStocks() {
    const none = !state.followed.size;
    $("#pickerPanel").hidden = !state.picking;
    $("#myStocksBody").hidden = state.picking;
    $("#manageBtn").hidden = state.picking || none;
    $("#myEmpty").hidden = !none;

    $("#followedChips").replaceChildren(...[...state.followed].sort().map(sym =>
      el("span", { class: "chip on static", title: companyName(sym), text: sym })));

    $("#myStoryList").replaceChildren(...state.mine.stories.map(s => storyItem(s, { showFollowed: true })));
    const status = $("#myStatus");
    if (!none && !state.mine.loading && !status.textContent && !state.mine.stories.length) {
      status.textContent = "No headlines about your stocks in the last 48 hours.";
    }
    if (none) status.textContent = "";
    $("#myLoadMore").hidden = none || !state.mine.nextBefore;
  }

  function openPicker() {
    state.picking = true;
    $("#companySearch").value = "";
    renderPicker();
    renderMyStocks();
  }

  function closePicker() {
    state.picking = false;
    renderMyStocks();
    loadMyStocks();
  }

  function renderPicker() {
    const q = $("#companySearch").value.trim().toLowerCase();
    const companies = (state.meta?.companies ?? [])
      .filter(c => !q || c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q))
      // Followed first, then alphabetical.
      .sort((a, b) => (state.followed.has(b.symbol) - state.followed.has(a.symbol)) || a.name.localeCompare(b.name));

    $("#companyList").replaceChildren(...companies.map(c => {
      const id = `co-${c.symbol}`;
      const box = el("input", {
        type: "checkbox", id, checked: state.followed.has(c.symbol),
        onchange: e => {
          e.target.checked ? state.followed.add(c.symbol) : state.followed.delete(c.symbol);
          saveFollowed();
          updatePickerCount();
        },
      });
      return el("li", {}, box, el("label", { for: id },
        el("span", { class: "co-main" },
          el("span", { class: "co-name", text: c.name }),
          el("span", { class: "co-industry", text: c.industry || "" })),
        el("span", { class: "co-sym", text: c.symbol })));
    }));
    updatePickerCount();
  }

  function updatePickerCount() {
    const n = state.followed.size;
    $("#pickerDone").textContent = n ? `Done · ${n} stock${n === 1 ? "" : "s"}` : "Done";
  }

  // ── About ──────────────────────────────────────────────────────────────────
  async function renderAbout() {
    const contact = window.APP_CONFIG.contactEmail;
    $("#contactLink").href = `mailto:${contact}?subject=${encodeURIComponent("FinStreet feedback")}`;
    $("#lastRun").textContent = state.meta?.last_run_at
      ? `Headlines last collected ${timeAgo(state.meta.last_run_at)}.` : "";
    try {
      const sources = await api("/api/sources");
      $("#sourceList").replaceChildren(...sources.map(s => {
        const name = s.section ? `${s.publisher} · ${s.section}` : s.publisher;
        return el("li", {}, el("span", { text: name }),
          el("span", { class: "muted", text: s.region === "india" ? " India" : " Global" }));
      }));
    } catch {
      $("#sourceList").replaceChildren(el("li", { class: "muted", text: "Couldn't load sources." }));
    }
  }

  // ── Routing ────────────────────────────────────────────────────────────────
  let currentView = null;

  function route() {
    let view = location.hash.replace("#/", "") || "feed";
    if (view === "watchlist") view = "mystocks"; // old links / installed shortcuts
    if (!["feed", "mystocks", "about"].includes(view)) view = "feed";
    currentView = view;
    document.querySelectorAll(".view").forEach(v => (v.hidden = v.id !== `view-${view}`));
    document.querySelectorAll(".bottomnav a").forEach(a =>
      a.setAttribute("aria-current", a.dataset.view === view ? "page" : "false"));
    if (view === "feed") renderFeed();
    if (view === "mystocks") { state.picking = false; renderMyStocks(); loadMyStocks(); }
    if (view === "about") renderAbout();
  }

  function refreshCurrent() {
    if (currentView === "mystocks") loadMyStocks();
    else loadFeed();
  }

  // ── Pull to refresh (simple: pull down at the top of the page) ─────────────
  function setupPullToRefresh() {
    let startY = null;
    const hint = $("#pullHint");
    window.addEventListener("touchstart", e => { startY = window.scrollY === 0 ? e.touches[0].clientY : null; }, { passive: true });
    window.addEventListener("touchmove", e => {
      if (startY !== null) hint.hidden = e.touches[0].clientY - startY < 70;
    }, { passive: true });
    window.addEventListener("touchend", () => {
      if (startY !== null && !hint.hidden) refreshCurrent();
      hint.hidden = true;
      startY = null;
    });
  }

  // ── Wire up ────────────────────────────────────────────────────────────────
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
    state.region = t.dataset.region;
    store.set("region", state.region);
    loadFeed();
  }));
  $("#sectorChips").addEventListener("click", e => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    state.sector = chip.dataset.sector || null;
    loadFeed();
  });
  $("#loadMore").addEventListener("click", () => loadFeed({ append: true }));
  $("#myLoadMore").addEventListener("click", () => loadMyStocks({ append: true }));
  $("#refreshBtn").addEventListener("click", refreshCurrent);
  $("#manageBtn").addEventListener("click", openPicker);
  $("#emptyPickBtn").addEventListener("click", openPicker);
  $("#pickerDone").addEventListener("click", closePicker);
  $("#companySearch").addEventListener("input", renderPicker);

  let theme = store.get("theme", "auto");
  if (!THEMES.includes(theme)) theme = "auto";
  applyTheme(theme);
  $("#themeBtn").addEventListener("click", () => {
    theme = THEMES.at((THEMES.indexOf(theme) + 1) % THEMES.length);
    store.set("theme", theme);
    applyTheme(theme);
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(theme));

  window.addEventListener("hashchange", route);
  setupPullToRefresh();

  (async () => {
    try { state.meta = await api("/api/meta"); } catch { state.meta = { sectors: [], companies: [] }; }
    // Drop followed symbols that are no longer in the company list (e.g. left the Nifty 100).
    if (state.meta.companies.length) {
      const known = new Set(state.meta.companies.map(c => c.symbol));
      const before = state.followed.size;
      state.followed = new Set([...state.followed].filter(s => known.has(s)));
      if (state.followed.size !== before) saveFollowed();
    }
    renderSectorChips();
    route();
    loadFeed();
  })();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
