// MarketWire PWA — vanilla JS, no build step.
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
    mine: store.get("mine", false),
    sector: null,
    watchlist: new Set(store.get("watchlist", [])),
    meta: null,
    stories: [],
    nextBefore: null,
    loading: false,
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

  // ── Tab counts (follow the sector filter) ──────────────────────────────────
  async function loadCounts() {
    try {
      const params = new URLSearchParams();
      if (state.sector) params.set("sector", state.sector);
      const counts = await api(`/api/counts?${params}`);
      document.querySelectorAll("[data-count]").forEach(b => {
        b.textContent = counts[b.dataset.count] ?? "";
      });
    } catch {
      document.querySelectorAll("[data-count]").forEach(b => (b.textContent = ""));
    }
  }

  // ── Feed ───────────────────────────────────────────────────────────────────
  async function loadFeed({ append = false } = {}) {
    if (!append) loadCounts();
    if (state.loading) return;
    state.loading = true;
    const status = $("#feedStatus");
    status.textContent = append ? "Loading more…" : "Loading…";
    try {
      const params = new URLSearchParams({ region: state.region, limit: PAGE_SIZE });
      if (state.sector) params.set("sector", state.sector);
      if (append && state.nextBefore) params.set("before", state.nextBefore);
      const data = await api(`/api/feed?${params}`);
      state.stories = append ? state.stories.concat(data.stories) : data.stories;
      state.nextBefore = data.next_before;
      status.textContent = "";
    } catch (e) {
      status.textContent = navigator.onLine
        ? `Couldn't load headlines (${e.message}). Pull down to retry.`
        : "You're offline. Showing the last headlines loaded.";
    } finally {
      state.loading = false;
      renderFeed();
    }
  }

  function visibleStories() {
    if (!state.mine) return state.stories;
    return state.stories.filter(s => s.companies.some(c => state.watchlist.has(c)));
  }

  function renderFeed() {
    document.querySelectorAll(".tab").forEach(t =>
      t.setAttribute("aria-selected", String(t.dataset.region === state.region)));
    document.querySelectorAll(".toggle button").forEach(b =>
      b.classList.toggle("on", (b.dataset.mine === "true") === state.mine));
    document.querySelectorAll("#sectorChips .chip").forEach(c =>
      c.classList.toggle("on", (c.dataset.sector || null) === state.sector));

    const list = $("#storyList");
    list.replaceChildren(...visibleStories().map(storyItem));

    const status = $("#feedStatus");
    if (!state.loading && !status.textContent && !list.children.length) {
      status.textContent = state.mine
        ? (state.watchlist.size ? "No headlines about your stocks right now." : "Add stocks in Watchlist to use My stocks.")
        : "No headlines yet.";
    }
    $("#loadMore").hidden = !state.nextBefore;
  }

  function storyItem(story) {
    const links = story.links.filter(l => isWebUrl(l.url));
    const first = links[0];
    const label = l => (l.section ? `${l.publisher} · ${l.section}` : l.publisher);

    const title = first
      ? el("a", { class: "title", href: first.url, target: "_blank", rel: "noopener noreferrer", text: story.title })
      : el("span", { class: "title", text: story.title });

    const meta = el("div", { class: "meta" },
      el("span", { class: "publisher", text: first ? label(first) : "" }),
      el("span", { text: ` · ${timeAgo(story.first_seen_at)}` }),
      ...story.sectors.map(s => el("span", { class: "tag", text: s })),
    );

    const item = el("li", { class: "story" }, title, meta);

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

  function renderSectorChips() {
    const chips = [el("button", { class: "chip", "data-sector": "", text: "All sectors" })]
      .concat((state.meta?.sectors ?? []).map(s => el("button", { class: "chip", "data-sector": s, text: s })));
    $("#sectorChips").replaceChildren(...chips);
  }

  // ── Watchlist ──────────────────────────────────────────────────────────────
  function renderWatchlist() {
    const q = $("#companySearch").value.trim().toLowerCase();
    const companies = (state.meta?.companies ?? [])
      .filter(c => !q || c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q));
    $("#companyList").replaceChildren(...companies.map(c => {
      const id = `co-${c.symbol}`;
      const box = el("input", {
        type: "checkbox", id, checked: state.watchlist.has(c.symbol),
        onchange: e => {
          e.target.checked ? state.watchlist.add(c.symbol) : state.watchlist.delete(c.symbol);
          store.set("watchlist", [...state.watchlist]);
        },
      });
      return el("li", {}, box, el("label", { for: id },
        el("span", { class: "co-name", text: c.name }), el("span", { class: "co-sym", text: c.symbol })));
    }));
  }

  // ── About ──────────────────────────────────────────────────────────────────
  async function renderAbout() {
    const contact = window.APP_CONFIG.contactEmail;
    $("#contactLink").href = `mailto:${contact}?subject=${encodeURIComponent("MarketWire feedback")}`;
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
  function route() {
    const view = (location.hash.replace("#/", "") || "feed");
    const known = ["feed", "watchlist", "about"].includes(view) ? view : "feed";
    document.querySelectorAll(".view").forEach(v => (v.hidden = v.id !== `view-${known}`));
    document.querySelectorAll(".bottomnav a").forEach(a =>
      a.setAttribute("aria-current", a.dataset.view === known ? "page" : "false"));
    if (known === "watchlist") renderWatchlist();
    if (known === "about") renderAbout();
    if (known === "feed") renderFeed();
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
      if (startY !== null && !hint.hidden) loadFeed();
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
  document.querySelectorAll(".toggle button").forEach(b => b.addEventListener("click", () => {
    state.mine = b.dataset.mine === "true";
    store.set("mine", state.mine);
    renderFeed();
  }));
  $("#sectorChips").addEventListener("click", e => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    state.sector = chip.dataset.sector || null;
    loadFeed();
  });
  $("#loadMore").addEventListener("click", () => loadFeed({ append: true }));
  $("#refreshBtn").addEventListener("click", () => loadFeed());
  let theme = store.get("theme", "auto");
  if (!THEMES.includes(theme)) theme = "auto";
  applyTheme(theme);
  $("#themeBtn").addEventListener("click", () => {
    theme = THEMES.at((THEMES.indexOf(theme) + 1) % THEMES.length);
    store.set("theme", theme);
    applyTheme(theme);
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(theme));
  $("#companySearch").addEventListener("input", renderWatchlist);
  window.addEventListener("hashchange", route);
  setupPullToRefresh();

  (async () => {
    try { state.meta = await api("/api/meta"); } catch { state.meta = { sectors: [], companies: [] }; }
    renderSectorChips();
    route();
    loadFeed();
  })();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
