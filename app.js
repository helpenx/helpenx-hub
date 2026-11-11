(function () {
  "use strict";

  var ACCENTS = { studio: "#0a7494", oss: "#6d4bf0", tools: "#087a43", demo: "#4d6484", content: "#96650a" };
  var PLANNED_ACCENT = "#8b98a9";
  var DEFAULT_ACCENT = "#0a7494";
  var STATUS_LABEL = { planned: "规划中", design: "设计中", dev: "开发中", test: "测试中", live: "已上线", iterating: "迭代中", archived: "已归档" };

  function el(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // 多关键词：空格 / 逗号 / 顿号 分词，词与词之间是「与」关系
  function tokensOf(q) {
    return String(q || "").toLowerCase().split(/[\s,，、;；|]+/).filter(function (t) { return t.length; });
  }

  function highlight(text, query) {
    var safe = escapeHtml(text);
    var toks = tokensOf(query);
    if (!toks.length) return safe;
    return safe.replace(new RegExp("(" + toks.map(escapeRe).join("|") + ")", "gi"), "<mark>$1</mark>");
  }

  function hostOf(url) {
    try { return new URL(url).hostname; } catch (e) { return url; }
  }

  var state = { data: null, query: "", category: "all" };

  /* sites.json 优先；file:// 打开时回退到页面内嵌数据 */
  function loadData() {
    return fetch("./sites.json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch(function () {
        var node = el("sites-embed");
        if (node) return JSON.parse(node.textContent);
        throw new Error("缺少站点数据");
      });
  }

  function accentFor(site) { return ACCENTS[site.category] || DEFAULT_ACCENT; }

  function iconGlyph(site) {
    return site.icon
      ? '<svg class="card__glyph" viewBox="0 0 24 24" aria-hidden="true"><use href="#hx-i-' + escapeHtml(site.icon) + '"></use></svg>'
      : escapeHtml((site.name || "?").trim().charAt(0).toUpperCase());
  }

  function categoryName(id) {
    var cats = state.data.categories || [];
    for (var i = 0; i < cats.length; i++) if (cats[i].id === id) return cats[i].name;
    return "";
  }

  /* ---------- 搜索引擎：分词 + 字段加权评分 + 拉丁模糊匹配 ---------- */
  function fieldText(list, fn) {
    return (list || []).map(fn).join(" ").toLowerCase();
  }

  function buildIndex() {
    state.index = (state.data.sites || []).map(function (site, i) {
      return {
        site: site,
        order: i,
        fields: [
          { text: String(site.name || "").toLowerCase(), w: 40 },
          { text: String(site.tagline || "").toLowerCase(), w: 26 },
          { text: fieldText(site.keywords, identity), w: 34 },
          { text: (hostOf(site.url) + " " + String(site.url || "")).toLowerCase(), w: 22, exactOnly: true },
          { text: categoryName(site.category).toLowerCase(), w: 18 },
          { text: fieldText(site.features, identity), w: 15 },
          { text: fieldText(site.pipeline, identity), w: 13 },
          { text: String(site.description || "").toLowerCase(), w: 9 }
        ]
      };
    });

    // 能力 / 环节 / 分类词条：搜索框联想里作为「二级入口」
    var caps = [];
    function push(label, kind, site) {
      var key = String(label || "").toLowerCase();
      if (!key) return;
      for (var i = 0; i < caps.length; i++) if (caps[i].key === key) return;
      caps.push({ label: label, kind: kind, key: key, site: site });
    }
    (state.data.categories || []).forEach(function (c) { push(c.name, "分类", null); });
    (state.data.sites || []).forEach(function (site) {
      push(site.tagline, "定位", site);
      (site.features || []).forEach(function (f) { push(f, "能力", site); });
      (site.pipeline || []).forEach(function (p) { push(p, "环节", site); });
    });
    state.caps = caps;
  }

  function identity(s) { return s; }

  function isLatin(t) { return /^[\x21-\x7e]+$/.test(t); }

  function isSubsequence(hay, tok) {
    var i = 0;
    for (var j = 0; j < hay.length && i < tok.length; j++) {
      if (hay.charAt(j) === tok.charAt(i)) i++;
    }
    return i === tok.length;
  }

  // 每个词都要命中（AND），取该词命中字段里的最高权重；漏词则整条排除
  function scoreEntry(entry, tokens) {
    var total = 0;
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i], best = 0;
      for (var j = 0; j < entry.fields.length; j++) {
        var f = entry.fields[j], hit = 0;
        if (!f.text) continue;
        if (f.text.indexOf(tok) !== -1) {
          hit = f.w + (j === 0 && f.text.indexOf(tok) === 0 ? 12 : 0);
        } else if (tok.length >= 3 && isLatin(tok) && f.w >= 13 && !f.exactOnly && isSubsequence(f.text, tok)) {
          // 模糊子序列只在短字段上生效：长描述和 URL（https、.cn 等）里零散字母几乎能拼出任何查询词
          hit = f.w * 0.5;
        }
        if (hit > best) best = hit;
      }
      if (!best) return 0;
      total += best;
    }
    return total;
  }

  // 返回 [{entry, score}]，已按相关度排序
  function searchSites(query, category) {
    var tokens = tokensOf(query), hits = [];
    for (var i = 0; i < state.index.length; i++) {
      var entry = state.index[i];
      if (category !== "all" && entry.site.category !== category) continue;
      var score = tokens.length ? scoreEntry(entry, tokens) : 1;
      if (score > 0) hits.push({ entry: entry, score: score });
    }
    hits.sort(function (a, b) { return b.score - a.score || a.entry.order - b.entry.order; });
    return hits;
  }

  function searchCaps(query, limit) {
    var tokens = tokensOf(query), out = [];
    for (var i = 0; i < state.caps.length; i++) {
      var cap = state.caps[i], score = 0, ok = true;
      for (var j = 0; j < tokens.length; j++) {
        var tok = tokens[j];
        if (cap.key.indexOf(tok) === 0) score += 12;
        else if (cap.key.indexOf(tok) !== -1) score += 7;
        else if (tok.length >= 3 && isLatin(tok) && isSubsequence(cap.key, tok)) score += 3;
        else { ok = false; break; }
      }
      if (ok) out.push({ cap: cap, score: score + Math.max(0, 6 - cap.key.length / 4) });
    }
    out.sort(function (a, b) { return b.score - a.score || a.cap.key.length - b.cap.key.length; });
    return out.slice(0, limit);
  }

  function visibleSites() {
    return searchSites(state.query, state.category).map(function (h) { return h.entry.site; });
  }

  function heroSite() {
    var sites = state.data.sites || [];
    for (var i = 0; i < sites.length; i++) if (sites[i].size === "hero") return sites[i];
    return null;
  }

  /* 展示区只在「未搜索且分类命中」时置顶，否则该产品回到网格里正常参与筛选 */
  function showcaseVisible() {
    var hs = heroSite();
    return !!hs && !state.query && (state.category === "all" || state.category === hs.category);
  }

  var GITHUB_ICON = '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
    '<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>';

  function flowHtml(site, query) {
    var steps = (site.pipeline || []).map(function (step, i) {
      return (i ? '<span class="card__flow-sep" aria-hidden="true">→</span>' : "") +
        '<span class="card__flow-step">' + highlight(step, query) + "</span>";
    }).join("");
    return steps ? '<div class="card__flow">' + steps + "</div>" : "";
  }

  function featuresHtml(site, query) {
    var items = (site.features || []).map(function (f) {
      return "<li>" + highlight(f, query) + "</li>";
    }).join("");
    return items ? '<ul class="card__features">' + items + "</ul>" : "";
  }

  function renderCard(site, index) {
    var query = state.query;
    var host = hostOf(site.url);
    var status = site.status || "live";
    var isHero = site.size === "hero" && !query;
    // 生命周期阶段与部署解耦：只有地址尚未部署（deployed:false）的服务不跳转，以灰底 + 阶段标签呈现
    var planned = site.deployed === false;

    var card = document.createElement(planned ? "div" : "a");
    card.className = "card" + (isHero ? " card--hero" : "") +
      (site.span === "full" ? " card--wide" : "") + (planned ? " card--planned" : "");
    if (!planned) {
      card.href = site.url;
      card.target = "_blank";
      card.rel = "noopener";
    }
    card.style.setProperty("--accent", planned ? PLANNED_ACCENT : accentFor(site));
    card.style.animationDelay = Math.min(index, 8) * 50 + "ms";

    var repo = site.repo
      ? '<span class="card__repo">' + GITHUB_ICON + "源码仓库</span>"
      : "";
    var badge = '<span class="status-tag status-tag--' + status + '">' +
      (STATUS_LABEL[status] || "规划中") + "</span>";

    var idBlock =
      '<div class="card__id">' +
        '<span class="card__icon" aria-hidden="true">' + iconGlyph(site) + "</span>" +
        '<span class="card__idtext">' +
          '<span class="card__titlerow">' +
            '<span class="card__name">' + highlight(site.name, query) + "</span>" +
            badge +
          "</span>" +
          '<span class="card__domain">' + highlight(host, query) + "</span>" +
        "</span>" +
      "</div>";

    var thumb = site.image && site.span === "full"
      ? '<span class="card__thumb"><img src="' + escapeHtml(site.image) + '" alt="' +
        escapeHtml(site.imageAlt || site.name + " 示意图") + '" decoding="async"></span>'
      : "";
    var lead = thumb ? '<div class="card__lead">' + idBlock + thumb + "</div>" : idBlock;

    card.innerHTML = lead +
      '<div class="card__main">' +
        '<span class="card__tagline">' + highlight(site.tagline || "", query) + "</span>" +
        flowHtml(site, query) +
        '<p class="card__desc">' + highlight(site.description || "", query) + "</p>" +
        featuresHtml(site, query) +
        repo +
      "</div>" +
      (planned ? "" : '<span class="card__arrow" aria-hidden="true">&#8599;</span>');

    var repoNode = card.querySelector(".card__repo");
    if (repoNode) {
      repoNode.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        window.open(site.repo, "_blank", "noopener");
      });
    }
    return card;
  }

  function renderShowcase() {
    var box = el("showcase");
    var hs = heroSite();
    var visible = !!hs && showcaseVisible();
    // 定位引言与六段流水线只属于 AIGC 类目：按其他类目筛选或搜索时随旗舰卡一起收起
    var story = el("story");
    if (story) story.hidden = !visible;
    box.textContent = "";
    if (!visible) { box.hidden = true; return; }
    box.hidden = false;

    var status = hs.status || "live";
    var card = document.createElement("article");
    card.className = "showcase__card";
    card.style.setProperty("--accent", accentFor(hs));

    var media = hs.image
      ? '<a class="showcase__media" href="' + escapeHtml(hs.url) + '" target="_blank" rel="noopener">' +
          '<img src="' + escapeHtml(hs.image) + '" alt="' + escapeHtml(hs.name + " 生产链路示意") + '" fetchpriority="high">' +
        "</a>"
      : "";

    card.innerHTML =
      '<div class="showcase__head">' +
        '<div class="showcase__idline">' +
          '<span class="showcase__name">' + escapeHtml(hs.name) + "</span>" +
          '<span class="status-tag status-tag--' + status + '">' + (STATUS_LABEL[status] || "") + "</span>" +
          '<span class="showcase__domain">' + escapeHtml(hostOf(hs.url)) + "</span>" +
        "</div>" +
        '<a class="btn btn-primary" href="' + escapeHtml(hs.url) + '" target="_blank" rel="noopener">' +
          escapeHtml(hs.ctaLabel || "进入") + ' <span class="btn__arrow" aria-hidden="true">&rarr;</span></a>' +
      "</div>" +
      '<div class="showcase__main">' +
        '<div class="showcase__text">' +
          '<span class="showcase__tagline">' + escapeHtml(hs.tagline || "") + "</span>" +
          '<p class="showcase__desc">' + escapeHtml(hs.description || "") + "</p>" +
        "</div>" +
        media +
      "</div>" +
      '<div class="showcase__bands">' + flowHtml(hs, "") + featuresHtml(hs, "") + "</div>";

    var mediaNode = card.querySelector(".showcase__media");
    if (mediaNode) {
      mediaNode.querySelector("img").addEventListener("error", function () {
        // 图挂了就把右侧 340px 轨道一起收掉，避免留下空白列
        card.classList.add("no-media");
      });
    }
    box.appendChild(card);
  }

  function renderChips() {
    var chips = el("chips");
    chips.textContent = "";
    var sites = state.data.sites || [];
    var defs = [{ id: "all", name: "全部" }]
      .concat(state.data.categories || [])
      .filter(function (c) {
        return c.id === "all" || sites.some(function (s) { return s.category === c.id; });
      });

    defs.forEach(function (c) {
      var count = c.id === "all"
        ? sites.length
        : sites.filter(function (s) { return s.category === c.id; }).length;
      var btn = document.createElement("button");
      btn.className = "chip";
      btn.type = "button";
      btn.setAttribute("aria-pressed", String(state.category === c.id));
      btn.innerHTML = escapeHtml(c.shortName || c.name) +
        '<span class="chip__count">' + count + "</span>";
      btn.addEventListener("click", function () {
        state.category = c.id;
        renderChips();
        renderShowcase();
        renderGrid();
      });
      chips.appendChild(btn);
    });
  }

  function dividerNode(label, note) {
    var d = document.createElement("div");
    d.className = "grid__divider";
    d.setAttribute("role", "separator");
    d.innerHTML =
      (label ? '<span class="grid__divider-label">' + escapeHtml(label) + "</span>" : "") +
      (note ? '<span class="grid__divider-note">' + escapeHtml(note) + "</span>" : "") +
      '<span class="grid__divider-rule" aria-hidden="true"></span>';
    return d;
  }

  function renderGrid() {
    var grid = el("grid");
    grid.textContent = "";
    var inShowcase = showcaseVisible();
    var sites = visibleSites();
    if (inShowcase) sites = sites.filter(function (s) { return s.size !== "hero"; });

    // 分隔条来自 sites.json 的 dividerBefore；搜索或已按分类筛选时不插，避免分隔线错位
    var mayDivide = !state.query && state.category === "all";

    sites.forEach(function (site, i) {
      var dv = site.dividerBefore;
      if (mayDivide && dv && i > 0) {
        var cfg = dv === true ? {} : dv;
        var note = cfg.note || "";
        if (cfg.countCategory) {
          var n = sites.filter(function (s) { return s.category === cfg.countCategory; }).length;
          note = (note ? note + " · " : "") + n;
        }
        grid.appendChild(dividerNode(cfg.label || "", note));
      }
      grid.appendChild(renderCard(site, i));
    });

    // 展示区已承载全部结果时，隐藏下方列表，避免出现「· 0」与空状态
    var board = el("board");
    board.hidden = inShowcase && sites.length === 0;
    el("empty").hidden = sites.length > 0;

    var title = el("board-title");
    if (state.query) title.textContent = "搜索「" + state.query + "」· " + sites.length;
    else if (state.category !== "all") title.textContent = categoryName(state.category) + " · " + sites.length;
    else title.textContent = "更多服务 · " + sites.length;
  }

  /* ---------- 联想面板与搜索交互 ---------- */
  var RECENT_KEY = "helpenx.portal.recent";
  var ui = { items: [], active: -1, open: false };

  function readRecents() {
    try {
      var raw = window.localStorage.getItem(RECENT_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(function (x) { return typeof x === "string" && x; }) : [];
    } catch (e) { return []; }
  }

  function remember(text) {
    var q = String(text || "").trim();
    if (!q) return;
    var list = readRecents().filter(function (x) { return x !== q; });
    list.unshift(q);
    try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6))); } catch (e) { /* 隐私模式忽略 */ }
  }

  function siteOption(site) {
    var host = hostOf(site.url);
    return '<div class="opt__icon">' + escapeHtml((site.name || "?").trim().charAt(0).toUpperCase()) + "</div>" +
      '<div class="opt__text">' +
        '<span class="opt__title">' + highlight(site.name, state.query) + "</span>" +
        '<span class="opt__sub">' + highlight(host, state.query) +
          (site.tagline ? " · " + highlight(site.tagline, state.query) : "") + "</span>" +
      "</div>" +
      '<span class="opt__go">打开 ↗</span>';
  }

  function keywordOption(item) {
    return '<div class="opt__icon opt__icon--key">#</div>' +
      '<div class="opt__text">' +
        '<span class="opt__title">' + highlight(item.label, state.query) + "</span>" +
        '<span class="opt__sub">' + escapeHtml(item.kind || "关键词") +
          (item.site ? " · " + escapeHtml(item.site.name) : "") + "</span>" +
      "</div>" +
      '<span class="opt__go">筛选</span>';
  }

  function renderSuggest() {
    var list = el("suggest-list"), meta = el("suggest-meta");
    var sites = state.data.sites || [];
    var items = [];

    if (!tokensOf(state.query).length) {
      var recents = readRecents();
      if (recents.length) {
        items.push({ type: "label", text: "最近搜索" });
        recents.forEach(function (r) { items.push({ type: "keyword", label: r, kind: "历史" }); });
      }
      items.push({ type: "label", text: state.category === "all" ? "快速进入" : categoryName(state.category) + " · 快速进入" });
      searchSites("", state.category).forEach(function (h) { items.push({ type: "site", site: h.entry.site }); });
      meta.textContent = sites.length + " 项服务可用 · 输入关键词即时筛选";
    } else {
      var siteHits = searchSites(state.query, state.category);
      var capHits = searchCaps(state.query, 4);
      meta.textContent = siteHits.length + " 个服务 · " + capHits.length + " 个相关能力" +
        (state.category === "all" ? "" : " · 已限定「" + categoryName(state.category) + "」");
      if (siteHits.length) {
        items.push({ type: "label", text: "服务" });
        siteHits.slice(0, 5).forEach(function (h) { items.push({ type: "site", site: h.entry.site }); });
      }
      if (capHits.length) {
        items.push({ type: "label", text: "能力与环节" });
        capHits.forEach(function (h) {
          items.push({ type: "keyword", label: h.cap.label, kind: h.cap.kind, site: h.cap.site });
        });
      }
      if (!items.length) items.push({ type: "none", text: "没有匹配，换个关键词或放宽筛选" });
      else if (siteHits.length) items.push({ type: "all" });
    }

    ui.items = items;
    ui.active = -1;
    list.textContent = "";
    items.forEach(function (item, i) {
      if (item.type === "label") {
        var p = document.createElement("p");
        p.className = "suggest__label";
        p.textContent = item.text;
        list.appendChild(p);
        return;
      }
      var node = document.createElement("div");
      if (item.type === "none") {
        node.className = "suggest__none";
        node.textContent = item.text;
        list.appendChild(node);
        return;
      }
      node.className = "opt";
      node.id = "sug-" + i;
      node.setAttribute("role", "option");
      node.setAttribute("aria-selected", "false");
      node.innerHTML = item.type === "site" ? siteOption(item.site)
        : item.type === "keyword" ? keywordOption(item)
        : '<div class="opt__icon opt__icon--key">&rarr;</div>' +
          '<div class="opt__text"><span class="opt__title">在下方列表查看全部 ' + siteHitsCount() + ' 条结果</span></div>' +
          '<span class="opt__go">Enter</span>';
      list.appendChild(node);
    });
  }

  function siteHitsCount() {
    return searchSites(state.query, state.category).length;
  }

  function isOpenable(i) {
    var t = ui.items[i] && ui.items[i].type;
    return t === "site" || t === "keyword" || t === "all";
  }

  function setActive(i) {
    var input = el("search"), list = el("suggest-list");
    for (var j = 0; j < ui.items.length; j++) {
      var node = document.getElementById("sug-" + j);
      if (!node) continue;
      var on = j === i;
      node.className = on ? "opt is-active" : "opt";
      node.setAttribute("aria-selected", String(on));
    }
    ui.active = i;
    input.setAttribute("aria-activedescendant", i >= 0 ? "sug-" + i : "");
    if (i >= 0) {
      var cur = document.getElementById("sug-" + i);
      var delta = cur.getBoundingClientRect().top - list.getBoundingClientRect().top;
      if (delta < 0) list.scrollTop += delta;
      else if (delta + cur.offsetHeight > list.clientHeight) {
        list.scrollTop += delta + cur.offsetHeight - list.clientHeight;
      }
    }
  }

  function moveActive(step) {
    var n = ui.items.length;
    // 尚未选中任何一项时：↓ 从第一条开始，↑ 从最后一条开始
    var i = ui.active === -1 && step < 0 ? n : ui.active;
    for (var k = 0; k < n; k++) {
      i = (i + step + n) % n;
      if (isOpenable(i)) { setActive(i); return; }
    }
    setActive(-1);
  }

  function openSuggest() {
    el("suggest").hidden = false;
    el("search").setAttribute("aria-expanded", "true");
    ui.open = true;
  }

  function closeSuggest() {
    el("suggest").hidden = true;
    el("search").setAttribute("aria-expanded", "false");
    el("search").setAttribute("aria-activedescendant", "");
    ui.open = false;
    ui.active = -1;
  }

  function activate(i) {
    var item = ui.items[i];
    if (!item) return;
    var input = el("search");
    if (item.type === "site") {
      remember(state.query);
      closeSuggest();
      window.open(item.site.url, "_blank", "noopener");
    } else if (item.type === "keyword") {
      remember(item.label);
      input.value = item.label;
      applyQuery(item.label);
      renderSuggest();
      openSuggest();
      input.focus();
    } else if (item.type === "all") {
      remember(state.query);
      closeSuggest();
      el("board").scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }

  function applyQuery(value) {
    state.query = String(value || "").trim();
    el("search-box").classList.toggle("is-busy", !!state.query);
    el("search-clear").hidden = !state.query;
    renderShowcase();
    renderGrid();
  }

  function resetAll() {
    el("search").value = "";
    state.category = "all";
    applyQuery("");
    renderChips();
    renderSuggest();
  }

  function bindSearch() {
    var input = el("search");
    var clear = el("search-clear");

    input.addEventListener("input", function () {
      applyQuery(input.value);
      renderSuggest();
      openSuggest();
    });
    input.addEventListener("focus", function () {
      renderSuggest();
      openSuggest();
    });
    input.addEventListener("blur", function () {
      closeSuggest();
    });
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        if (!ui.open) { renderSuggest(); openSuggest(); setActive(-1); }
        moveActive(ev.key === "ArrowDown" ? 1 : -1);
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        if (ui.open && ui.active >= 0) activate(ui.active);
        else if (state.query) {
          remember(state.query);
          closeSuggest();
          el("board").scrollIntoView({ block: "start", behavior: "smooth" });
        }
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        if (state.query) {
          input.value = "";
          applyQuery("");
          renderSuggest();
        } else {
          closeSuggest();
          input.blur();
        }
      } else if (ev.key === "Tab") {
        closeSuggest();
      }
    });

    // 面板内点击不应让输入框失焦
    el("suggest").addEventListener("mousedown", function (ev) { ev.preventDefault(); });
    el("suggest-list").addEventListener("click", function (ev) {
      var opt = ev.target.closest ? ev.target.closest(".opt") : null;
      if (opt) activate(Number(opt.id.slice(4)));
    });
    el("suggest-list").addEventListener("mousemove", function (ev) {
      var opt = ev.target.closest ? ev.target.closest(".opt") : null;
      if (!opt) return;
      var idx = Number(opt.id.slice(4));
      if (idx !== ui.active) setActive(idx);
    });

    clear.addEventListener("click", function () {
      input.value = "";
      applyQuery("");
      renderSuggest();
      openSuggest();
      input.focus();
    });
    el("empty-reset").addEventListener("click", function () {
      resetAll();
      input.focus();
    });

    document.addEventListener("keydown", function (ev) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (ev.key === "Escape" && !typing && (state.query || state.category !== "all")) {
        resetAll();
      } else if ((ev.key === "/" || (ev.key === "k" && (ev.ctrlKey || ev.metaKey))) && !typing) {
        ev.preventDefault();
        input.focus();
        input.select();
      }
    });
  }

  /* 滚动后给吸顶页眉一条边界，避免搜索面板与内容糊在一起 */
  function bindStickyHeader() {
    var header = document.querySelector(".site-header");
    var onScroll = function () { header.classList.toggle("is-stuck", window.scrollY > 4); };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* 数据流：点选连线上的工具展开对应环节；图例聚焦某类连线；支持暂停 / 播放 */
  function bindFlow() {
    var flow = document.querySelector("[data-flow]");
    if (!flow) return;
    var pool = flow.closest(".flow-pool") || flow;
    var tools = [].slice.call(flow.querySelectorAll(".flow-tool"));
    var panels = [].slice.call(flow.querySelectorAll(".flow__panel"));
    var dock = flow.querySelector(".flow__dock");
    var edges = [].slice.call(flow.querySelectorAll(".flow__edge, .flow__pulse"));
    var label = pool.querySelector(".flow-pool__label");
    var hintText = pool.querySelector(".flow-pool__hinttext");
    var note = pool.querySelector(".flow-pool__note");
    var chips = [].slice.call(pool.querySelectorAll(".flow-legend__chip"));
    var active = null;
    var activeTool = null;
    var hoverTool = null;
    var focusKind = null;
    var paused = false;
    var wasRunning = null;
    var captionTimer = null;
    var captionIndex = 0;
    var idleNote = note ? note.getAttribute("data-idle") || note.textContent : "";
    var captions = [];
    if (note) {
      try { captions = JSON.parse(note.getAttribute("data-captions") || "[]"); } catch (e) { captions = []; }
    }

    function wide() { return !window.matchMedia("(max-width: 1060px)").matches; }

    /* 单选焦点：图例聚焦某类连线时忽略工具焦点；选中工具时清掉图例焦点 */
    function applyDim() {
      var toolFocus = focusKind ? null : (active || hoverTool);
      edges.forEach(function (edge) {
        var kind = edge.getAttribute("data-kind");
        var tool = edge.getAttribute("data-tool");
        edge.classList.toggle("is-dim", !!((focusKind && kind !== focusKind) || (toolFocus && tool !== toolFocus)));
      });
    }

    function clearKind() {
      focusKind = null;
      chips.forEach(function (chip) { chip.setAttribute("aria-pressed", "false"); });
    }

    function select(stageId) {
      if (focusKind) clearKind();
      active = stageId;
      tools.forEach(function (tool) {
        tool.setAttribute("aria-expanded", tool.getAttribute("data-stage") === stageId ? "true" : "false");
      });
      panels.forEach(function (panel) {
        var on = panel.id === "flow-panel-" + stageId;
        panel.classList.toggle("is-active", on);
        panel.setAttribute("aria-hidden", on ? "false" : "true");
      });
      dock.setAttribute("data-open", "true");
      applyDim();
      stopCaptions();
      if (wide() && !paused) startCaptions();
    }

    function collapse() {
      active = null;
      activeTool = null;
      tools.forEach(function (tool) { tool.setAttribute("aria-expanded", "false"); });
      panels.forEach(function (panel) {
        panel.classList.remove("is-active");
        panel.setAttribute("aria-hidden", "true");
      });
      dock.setAttribute("data-open", "false");
      applyDim();
      stopCaptions();
      if (wide() && !paused) startCaptions();
    }

    tools.forEach(function (tool) {
      var stageId = tool.getAttribute("data-stage");
      tool.addEventListener("click", function () {
        if (active === stageId && activeTool === tool) { collapse(); return; }
        activeTool = tool;
        select(stageId);
        if (!wide()) {
          var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          setTimeout(function () {
            dock.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
          }, 30);
        }
      });
      tool.addEventListener("mouseenter", function () { hoverTool = stageId; applyDim(); });
      tool.addEventListener("mouseleave", function () { hoverTool = null; applyDim(); });
      tool.addEventListener("focus", function () { hoverTool = stageId; applyDim(); });
      tool.addEventListener("blur", function () { hoverTool = null; applyDim(); });
    });

    function startCaptions() {
      if (!note || captionTimer) return;
      var list = captions.filter(function (c) {
        return (!focusKind || c.kind === focusKind) && (!active || c.tool === active);
      });
      if (!list.length) { note.textContent = idleNote; return; }
      captionIndex = 0;
      note.textContent = list[0].label;
      captionTimer = setInterval(function () {
        captionIndex = (captionIndex + 1) % list.length;
        note.textContent = list[captionIndex].label;
      }, 3000);
    }

    function stopCaptions() {
      if (captionTimer) { clearInterval(captionTimer); captionTimer = null; }
      if (note) note.textContent = idleNote;
    }

    function sync() {
      var running = wide() && !paused;
      pool.classList.toggle("is-paused", !running);
      if (label) label.setAttribute("aria-pressed", running ? "true" : "false");
      if (hintText) hintText.textContent = running ? "暂停演示" : "播放演示";
      if (running === wasRunning) return;
      wasRunning = running;
      stopCaptions();
      if (running) startCaptions();
    }

    if (label) {
      label.addEventListener("click", function () {
        if (!wide()) return;
        paused = !paused;
        sync();
      });
    }

    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        var kind = chip.getAttribute("data-kind");
        var next = focusKind === kind ? null : kind;
        if (active) collapse();
        focusKind = next;
        chips.forEach(function (c) {
          c.setAttribute("aria-pressed", c.getAttribute("data-kind") === focusKind ? "true" : "false");
        });
        applyDim();
        stopCaptions();
        if (wide() && !paused) startCaptions();
      });
    });

    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape") return;
      if (active && flow.contains(document.activeElement)) {
        var last = tools.filter(function (t) { return t.getAttribute("data-stage") === active; })[0];
        collapse();
        if (last) last.focus();
        return;
      }
      if (focusKind) {
        clearKind();
        applyDim();
        stopCaptions();
        if (wide() && !paused) startCaptions();
      }
    });

    window.addEventListener("resize", sync);
    applyDim();
    sync();
  }

  function bindArchitecture() {
    var board = document.querySelector(".arch-board");
    if (!board) return;
    var nodes = [].slice.call(board.querySelectorAll("[data-node]"));
    var wires = [].slice.call(board.querySelectorAll("[data-edge]"));
    if (!nodes.length || !wires.length) return;

    var links = {};
    function link(a, b) {
      links[a] = links[a] || [];
      links[b] = links[b] || [];
      if (links[a].indexOf(b) === -1) links[a].push(b);
      if (links[b].indexOf(a) === -1) links[b].push(a);
    }
    wires.forEach(function (wire) {
      wire.getAttribute("data-edge").split(" ").forEach(function (pair) {
        var ends = pair.split("|");
        link(ends[0], ends[1]);
      });
    });
    nodes.forEach(function (node) {
      var hub = node.getAttribute("data-hub");
      if (hub) link(hub, node.getAttribute("data-node"));
    });

    var runtime = board.querySelector(".arch-runtime");
    var current = null;

    function paint(id) {
      current = id;
      var related = links[id] || [];
      board.classList.add("is-tracing");
      nodes.forEach(function (node) {
        var nodeId = node.getAttribute("data-node");
        node.classList.toggle("is-focus", nodeId === id);
        node.classList.toggle("is-related", nodeId === id || related.indexOf(nodeId) !== -1);
      });
      wires.forEach(function (wire) {
        var hit = wire.getAttribute("data-edge").split(" ").some(function (pair) {
          return pair.split("|").indexOf(id) !== -1;
        });
        wire.classList.toggle("is-related", hit);
      });
      if (runtime) runtime.classList.toggle("is-related", !!runtime.querySelector("[data-node].is-related"));
    }

    function clear() {
      if (current === null) return;
      current = null;
      board.classList.remove("is-tracing");
      nodes.forEach(function (node) { node.classList.remove("is-focus", "is-related"); });
      wires.forEach(function (wire) { wire.classList.remove("is-related"); });
      if (runtime) runtime.classList.remove("is-related");
    }

    nodes.forEach(function (node) {
      node.addEventListener("mouseenter", function () { paint(node.getAttribute("data-node")); });
      node.addEventListener("mouseleave", clear);
    });
  }

  function bindHeader() {
    var brand = state.data.brand || {};
    var sites = state.data.sites || [];
    if (brand.tagline) el("hero-tagline").textContent = brand.tagline;
    el("year").textContent = new Date().getFullYear();

    var live = sites.filter(function (s) { return s.deployed !== false; }).length;
    el("header-stat").textContent = live + " / " + sites.length + " 服务";

    if (brand.github) el("github-link").href = brand.github;
  }

  loadData().then(function (data) {
    state.data = data;
    buildIndex();
    bindHeader();
    bindArchitecture();
    bindFlow();
    renderChips();
    renderShowcase();
    renderGrid();
    bindSearch();
    bindStickyHeader();
  });
})();
