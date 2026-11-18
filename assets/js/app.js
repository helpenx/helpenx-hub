(function () {
  "use strict";

  document.documentElement.classList.add("js");

  var ACCENTS = { studio: "#0a7494", oss: "#6d4bf0", platform: "#4f6ae0", tools: "#087a43", demo: "#4d6484", content: "#96650a" };
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

  function repoText(url) {
    return String(url || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }

  var state = { data: null, query: "", star: null, stage: null };

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

  /* 图片固有宽高写进 <img>，避免加载时撑动布局 */
  function imgSize(site) {
    return site.imageWidth && site.imageHeight
      ? ' width="' + Number(site.imageWidth) + '" height="' + Number(site.imageHeight) + '"'
      : "";
  }

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
  function searchSites(query) {
    var tokens = tokensOf(query), hits = [];
    for (var i = 0; i < state.index.length; i++) {
      var entry = state.index[i];
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

  /* ---------- 北斗阵列：七主星筛选与辅星坐标 ---------- */
  function constellationCfg() { return state.data.constellation || {}; }
  function stars() { return constellationCfg().stars || []; }

  function starById(id) {
    var list = stars();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function isAllActive() { return !starById(state.star); }

  function activeStar() { return starById(state.star); }

  function siteById(id) {
    var list = state.data.sites || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function starForSite(id) {
    var list = stars();
    for (var i = 0; i < list.length; i++) {
      if ((list[i].projects || []).indexOf(id) !== -1) return list[i];
    }
    return null;
  }

  function starBadgeHtml(site) {
    var star = starForSite(site.id);
    if (!star) return "";
    var label = String(star.title || star.name || "").split(" · ")[0];
    return '<span class="card__star" style="--star:' + escapeHtml(star.accent || DEFAULT_ACCENT) +
      '" title="' + escapeHtml(star.title || star.name || label) + '">' +
      '<span class="card__star-dot" aria-hidden="true"></span>' + escapeHtml(label) + "</span>";
  }

  /* 微观星图：每颗主星翻开自己的布局，track 与 micro 共用一套节点语义 */
  function microCfg(star) {
    if (!star) return null;
    if (star.track && (star.track.stages || []).length) {
      var track = star.track;
      return {
        layout: "track", nodes: track.stages || [],
        eyebrow: track.eyebrow, title: track.title,
        charLine: track.charLine, lead: track.lead
      };
    }
    if (star.micro && (star.micro.nodes || []).length) return star.micro;
    return null;
  }

  function microStar() {
    var star = activeStar();
    return star && microCfg(star) ? star : null;
  }

  function microNodes(star) {
    var cfg = microCfg(star || activeStar());
    return cfg ? (cfg.nodes || []) : [];
  }

  function stageById(id) {
    var list = microNodes(activeStar());
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function microOpen() {
    var star = microStar();
    return !!star && !state.query && state.star === star.id;
  }

  function activeStage() {
    return microOpen() && state.stage ? stageById(state.stage) : null;
  }

  var flipTimer = 0;

  function visibleSites() {
    var hits = searchSites(state.query);
    var star = activeStar();
    if (star) {
      var order = {};
      (star.projects || []).forEach(function (id, i) { order[id] = i; });
      hits = hits.filter(function (h) { return order[h.entry.site.id] != null; });
      hits.sort(function (a, b) {
        return order[a.entry.site.id] - order[b.entry.site.id];
      });
    }
    var stage = activeStage();
    if (stage) {
      hits = hits.filter(function (h) { return h.entry.site.id === stage.site; });
    }
    return hits.map(function (h) { return h.entry.site; });
  }

  function heroSite() {
    var sites = state.data.sites || [];
    for (var i = 0; i < sites.length; i++) if (sites[i].size === "hero") return sites[i];
    return null;
  }

  /* 展示区只在「未搜索、未按主星筛选」时置顶，否则该产品回到网格里正常参与筛选 */
  function showcaseVisible() {
    var hs = heroSite();
    return !!hs && !state.query && isAllActive();
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
    // 生命周期阶段与部署解耦：只有地址尚未部署（deployed:false）的服务不跳转，以灰底 + 阶段标签呈现
    var planned = site.deployed === false;

    var card = document.createElement(planned ? "div" : "a");
    card.className = "card" + (site.span === "full" ? " card--wide" : "") +
      (planned ? " card--planned" : "");
    if (!planned) {
      card.href = site.url;
      card.target = "_blank";
      card.rel = "noopener";
    }
    card.style.setProperty("--accent", planned ? PLANNED_ACCENT : accentFor(site));

    var repo = site.repo
      ? '<span class="card__repo" title="源码仓库：' + escapeHtml(site.repo) + '">' +
          GITHUB_ICON + escapeHtml(repoText(site.repo)) + "</span>"
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
          '<span class="card__meta"><span class="card__domain">' + highlight(host, query) + "</span>" +
            starBadgeHtml(site) + "</span>" +
        "</span>" +
      "</div>";

    var thumb = site.image && site.span === "full"
      ? '<span class="card__thumb"><img src="' + escapeHtml(site.image) + '" alt="' +
        escapeHtml(site.imageAlt || site.name + " 示意图") + '"' + imgSize(site) +
        ' loading="lazy" decoding="async"></span>'
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

  /* 首页展示卡与筛选态旗舰卡共用同一套 DOM，保证两种视图完全一致 */
  function showcaseCardNode(hs, extraClass) {
    var status = hs.status || "live";
    var card = document.createElement("article");
    card.className = "showcase__card" + (extraClass ? " " + extraClass : "");
    card.style.setProperty("--accent", accentFor(hs));

    var media = hs.image
      ? '<a class="showcase__media" href="' + escapeHtml(hs.url) + '" target="_blank" rel="noopener">' +
          '<img src="' + escapeHtml(hs.image) + '" alt="' + escapeHtml(hs.name + " 生产链路示意") + '"' +
          imgSize(hs) + ' fetchpriority="high" decoding="async">' +
        "</a>"
      : "";

    card.innerHTML =
      '<div class="showcase__head">' +
        '<div class="showcase__idline">' +
          '<span class="showcase__name">' + escapeHtml(hs.name) + "</span>" +
          '<span class="status-tag status-tag--' + status + '">' + (STATUS_LABEL[status] || "") + "</span>" +
          '<span class="showcase__domain">' + escapeHtml(hostOf(hs.url)) + "</span>" +
          starBadgeHtml(hs) +
        "</div>" +
        '<a class="btn btn-primary" href="' + escapeHtml(hs.url) + '" target="_blank" rel="noopener">' +
          escapeHtml(hs.ctaLabel || "进入") + ' <span class="btn__arrow" aria-hidden="true">&rarr;</span></a>' +
      "</div>" +
      '<div class="showcase__main">' +
        '<div class="showcase__text">' +
          '<span class="showcase__tagline">' + escapeHtml(hs.tagline || "") + "</span>" +
          '<p class="showcase__desc">' + escapeHtml(hs.description || "") + "</p>" +
          '<div class="arch-teaser">' +
            '<div class="arch-teaser__text">' +
              '<span class="arch-teaser__eyebrow">星阵视界 Studio · 技术底座</span>' +
              '<p class="arch-teaser__title">四层架构、两条总线：控制面编排，数据面执行，模型层统一出网</p>' +
              '<p class="arch-teaser__desc">NeoFlow 拆 DAG，NeoTask 拉任务，AI Gateway 收敛模型出口；PenFix 三道质检门按根因回退。分层、总线与回退路径在系统架构页展开。</p>' +
            "</div>" +
            '<a class="arch-teaser__link" href="./architecture.html">查看系统架构 <span aria-hidden="true">&rarr;</span></a>' +
          "</div>" +
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
    box.appendChild(showcaseCardNode(hs));
    revealRefresh();
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

    // 分隔条来自 sites.json 的 dividerBefore；搜索或主星筛选时不插，避免分隔线错位
    var mayDivide = !state.query && isAllActive();

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
      // 主星筛选时旗舰服务回到列表首位，但沿用首页展示卡版式
      if (site.size === "hero" && !state.query) {
        grid.appendChild(showcaseCardNode(site, "showcase__card--grid"));
        return;
      }
      grid.appendChild(renderCard(site, i));
    });

    // 展示区已承载全部结果时，隐藏下方列表，避免出现「· 0」与空状态
    var board = el("board");
    board.hidden = inShowcase && sites.length === 0;
    el("empty").hidden = sites.length > 0;

    var title = el("board-title");
    var star = activeStar();
    var stage = activeStage();
    // 展示区已承载 hero 卡时，网格里没有它，但「全部服务」的计数仍应包含它
    var total = sites.length + (inShowcase ? 1 : 0);
    if (state.query) title.textContent = "搜索「" + state.query + "」· " + total;
    else if (stage) title.textContent = stage.char + " · " + (stage.label || "") + " · " + total;
    else if (star) title.textContent = star.title + " · " + total;
    else title.textContent = "星图 · 全部服务 · " + total;

    revealRefresh();
  }

  /* 主星筛选：选中一条产品线，再点同一颗星回到全部 */
  function scrollToPanel(node) {
    if (!node) return;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.requestAnimationFrame(function () {
      var header = document.querySelector(".site-header");
      var headerH = header ? header.getBoundingClientRect().height : 0;
      var rect = node.getBoundingClientRect();
      var docTop = window.scrollY + rect.top;
      var target = docTop - (window.innerHeight - rect.height) / 2;
      // 居中后若顶端被吸顶页眉盖住，就退到页眉下方
      target = Math.min(target, docTop - headerH);
      var max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      target = Math.max(0, Math.min(target, max));
      window.scrollTo({ top: target, behavior: reduce ? "auto" : "smooth" });
    });
  }

  function setStar(id, keep) {
    if (id != null && !starById(id)) return;
    var prev = state.star;
    state.star = (!keep && state.star === id) ? null : id;
    state.stage = null;
    if (state.query) {
      state.query = "";
      var input = el("search");
      if (input) input.value = "";
      el("search-box").classList.remove("is-busy");
      el("search-clear").hidden = true;
    }
    renderShowcase();
    renderGrid();
    syncConstellation();
    if (state.star) scrollToPanel(document.querySelector("[data-constellation-stage]"));
    else if (prev) scrollToPanel(document.querySelector("[data-constellation-board]"));
  }

  function showAll() { setStar(null); }

  /* 星图节点：选中只保留该工具，再点一次回到整图；选中后把卡片带进视野 */
  function setStage(id) {
    var stage = stageById(id);
    var star = microStar();
    if (!stage || !star) return;
    state.star = star.id;
    state.stage = state.stage === id ? null : id;
    renderShowcase();
    renderGrid();
    syncConstellation();
    if (state.stage) {
      var card = el("grid").querySelector(".card");
      if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function syncConstellation() {
    var board = document.querySelector("[data-constellation-board]");
    if (!board) return;
    var star = activeStar();
    var all = !star;
    var micro = all ? null : microCfg(star);
    var inMicro = !!micro && !state.query;
    if (!inMicro) state.stage = null;
    var stage = inMicro && state.stage ? stageById(state.stage) : null;

    var stageBox = document.querySelector("[data-constellation-stage]");
    if (stageBox) stageBox.hidden = !inMicro;

    var buttons = [].slice.call(board.querySelectorAll(".cstar"));
    buttons.forEach(function (btn) {
      var current = !!star && btn.getAttribute("data-star") === star.id;
      btn.setAttribute("aria-pressed", String(current));
      btn.classList.toggle("is-selected", current);
      btn.classList.remove("is-hot", "is-dim");
    });

    var lines = [].slice.call(board.querySelectorAll("[data-link]"));
    lines.forEach(function (line) {
      var on = !!star && line.getAttribute("data-link").split(" ").indexOf(star.id) !== -1;
      line.classList.toggle("is-selected", on);
      line.classList.remove("is-active");
    });

    var auxes = [].slice.call(board.querySelectorAll(".caux"));
    auxes.forEach(function (btn) {
      btn.classList.remove("is-hot", "is-hover");
      btn.classList.toggle("is-dim", !!star && btn.getAttribute("data-parent") !== star.id);
    });
    board.classList.remove("is-tracing");
    board.classList.toggle("has-filter", !!star);

    var allBtn = document.querySelector("[data-constellation-all]");
    if (allBtn) {
      allBtn.classList.toggle("is-current", all);
      allBtn.setAttribute("aria-pressed", String(all));
    }

    // 微观星图：只显示当前主星的一副布局，选中节点高亮、其余压暗
    var microBoards = [].slice.call(document.querySelectorAll("[data-constellation-micro]"));
    microBoards.forEach(function (microBoard) {
      var own = inMicro && microBoard.getAttribute("data-constellation-micro") === star.id;
      microBoard.hidden = !own;
      [].slice.call(microBoard.querySelectorAll(".ctrack")).forEach(function (node) {
        var on = own && !!stage && node.getAttribute("data-stage") === stage.id;
        node.classList.toggle("is-active", on);
        node.classList.toggle("is-dim", own && !!stage && !on);
        node.setAttribute("aria-pressed", String(on));
      });
    });

    var eyebrow = document.querySelector("[data-constellation-eyebrow]");
    var title = document.querySelector("[data-constellation-title]");
    var count = document.querySelector("[data-constellation-count]");
    var desc = document.querySelector("[data-constellation-desc]");
    if (inMicro) {
      var stageSite = stage ? siteById(stage.site) : null;
      var kind = micro.layout === "track" ? "环节" : "节点";
      if (eyebrow) eyebrow.textContent = stage ? "NODE · 当前节点" : "MICRO MAP · 当前星图";
      if (title) title.textContent = stage ? stage.char + " · " + (stage.label || "") : (micro.title || star.title);
      if (count) count.textContent = stage ? "1 项工具" : microNodes(star).length + " " + kind;
      if (desc) desc.textContent = stage
        ? (stageSite ? stageSite.description : "")
        : (micro.lead || star.desc);
    }

    // 棋盘原地翻转：仅在层级切换时播放一次，初始加载不触发
    var flip = document.querySelector("[data-constellation-flip]");
    if (flip) {
      var mode = inMicro ? "micro-" + star.id : "macro";
      if (flip.getAttribute("data-mode") !== mode) {
        flip.setAttribute("data-mode", mode);
        flip.classList.remove("is-turning");
        void flip.offsetWidth;
        flip.classList.add("is-turning");
        window.clearTimeout(flipTimer);
        flipTimer = window.setTimeout(function () { flip.classList.remove("is-turning"); }, 460);
      }
    }
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
      items.push({ type: "label", text: "快速进入" });
      searchSites("").forEach(function (h) { items.push({ type: "site", site: h.entry.site }); });
      meta.textContent = sites.length + " 项服务可用 · 输入关键词即时筛选";
    } else {
      var siteHits = searchSites(state.query);
      var capHits = searchCaps(state.query, 4);
      meta.textContent = siteHits.length + " 个服务 · " + capHits.length + " 个相关能力";
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
    return searchSites(state.query).length;
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
    state.stage = null;
    // 搜索是全局行为：带着关键词时退出星位筛选，避免星位与关键词互相收窄
    if (state.query) state.star = null;
    el("search-box").classList.toggle("is-busy", !!state.query);
    el("search-clear").hidden = !state.query;
    renderShowcase();
    renderGrid();
    syncConstellation();
  }

  function resetAll() {
    var prev = state.star;
    el("search").value = "";
    state.star = null;
    state.stage = null;
    applyQuery("");
    renderSuggest();
    if (prev) scrollToPanel(document.querySelector("[data-constellation-board]"));
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
      if (ev.key === "Escape" && !typing &&
          (state.query || state.stage || state.star)) {
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

  /* ---------- 滚动观感：进度条、光晕视差、逐段揭示 ---------- */
  var revealState = { observer: null, initialDone: false, reduce: false, pending: [] };

  function setupScrollChrome() {
    revealState.reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var bar = document.createElement("div");
    bar.className = "scroll-progress";
    bar.setAttribute("aria-hidden", "true");
    document.body.appendChild(bar);

    if (!revealState.reduce && "IntersectionObserver" in window) {
      revealState.observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          revealState.observer.unobserve(entry.target);
          var at = revealState.pending.indexOf(entry.target);
          if (at > -1) revealState.pending.splice(at, 1);
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    }

    var root = document.documentElement;
    var ticking = false;
    function paint() {
      ticking = false;
      var max = root.scrollHeight - window.innerHeight;
      var p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      bar.style.transform = "scaleX(" + p.toFixed(4) + ")";
      if (!revealState.reduce) root.style.setProperty("--sy", Math.round(window.scrollY) + "px");
      catchUpReveal();
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(paint);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    onScroll();
  }

  /* 拖动滚动条、锚点跳转或恢复滚动位置会整段跳过观察器，已滚过的段落直接补上 */
  function catchUpReveal() {
    var pending = revealState.pending;
    if (!pending.length) return;
    var rest = [];
    pending.forEach(function (node) {
      if (!node.isConnected) return;
      if (node.getBoundingClientRect().bottom <= 0) {
        node.classList.add("is-visible");
        if (revealState.observer) revealState.observer.unobserve(node);
        return;
      }
      rest.push(node);
    });
    revealState.pending = rest;
  }

  function reveal(node, delay) {
    if (!node) return;
    node.classList.add("reveal");
    if (revealState.reduce || !revealState.observer) {
      node.classList.add("is-visible");
      return;
    }
    if (delay) node.style.setProperty("--reveal-delay", delay + "ms");
    revealState.pending.push(node);
    revealState.observer.observe(node);
  }

  function revealGroup(selector, step) {
    var nodes = [].slice.call(document.querySelectorAll(selector));
    nodes.forEach(function (node, i) {
      reveal(node, Math.min(i, 8) * (step || 0));
    });
  }

  /* 首屏渲染完成后统一挂揭示：先让观察器接管，避免和重绘打架 */
  function revealInitial() {
    revealGroup(".constellation__head > *", 70);
    revealGroup("[data-constellation-board]", 0);
    revealGroup(".story__head > *", 70);
    revealGroup(".flow-pool", 0);
    revealGroup("#showcase .showcase__card", 80);
    revealGroup(".board > .board__title, .board > .board__legend", 0);
    revealGroup("#grid .grid__divider", 0);
    revealGroup("#grid .card", 45);
    revealGroup(".site-footer", 0);
    revealState.initialDone = true;
  }

  /* 搜索 / 筛选会重绘卡片，新节点直接可见，不重复播放入场 */
  function revealRefresh() {
    if (!revealState.initialDone) return;
    var nodes = [].slice.call(document.querySelectorAll(
      "#showcase .showcase__card, #grid .showcase__card, #grid .card, #grid .grid__divider"
    ));
    nodes.forEach(function (node) {
      node.classList.add("reveal", "is-visible");
    });
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
      syncNodeLoop();
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
      syncNodeLoop();
      if (running === wasRunning) return;
      wasRunning = running;
      stopCaptions();
      if (running) startCaptions();
    }

    /* 节点脉冲：同一列（并行分支）一起凸起，按链路逐列推进；暂停、聚焦或降级动效时停下 */
    var nodeSeq = [].slice.call(flow.querySelectorAll(".flow-node"));
    var waveMap = {};
    var nodeWaves = [];
    nodeSeq.forEach(function (node) {
      var x = Math.round(parseFloat(node.style.left) || 0);
      if (!waveMap[x]) { waveMap[x] = []; nodeWaves.push(x); }
      waveMap[x].push(node);
    });
    nodeWaves = nodeWaves.sort(function (a, b) { return a - b; }).map(function (x) { return waveMap[x]; });
    var nodeTimer = null;
    var nodeStep = 0;
    var nodeReduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    function stopNodeLoop() {
      if (nodeTimer) { window.clearInterval(nodeTimer); nodeTimer = null; }
      nodeSeq.forEach(function (node) { node.classList.remove("is-live"); });
    }

    function popWave() {
      var wave = nodeWaves[nodeStep % nodeWaves.length];
      nodeStep += 1;
      wave.forEach(function (node) {
        node.classList.remove("is-live");
        void node.offsetWidth;
        node.classList.add("is-live");
      });
      window.setTimeout(function () {
        wave.forEach(function (node) { node.classList.remove("is-live"); });
      }, 860);
    }

    function syncNodeLoop() {
      var on = wide() && !paused && !nodeReduce.matches && !active && !focusKind;
      if (!on) { stopNodeLoop(); return; }
      if (nodeTimer) return;
      popWave();
      nodeTimer = window.setInterval(popWave, 1300);
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

  /* 北斗阵列：辅星按主星角度展开，悬停可追踪整条产品线 */
  function bindConstellation() {
    var board = document.querySelector("[data-constellation-board]");
    if (!board) return;
    // 底色随时段切换：20:00–06:00 深空盘，06:00–08:00 与 18:00–20:00 浅深夜，其余时间浅色盘
    function syncBoardTone() {
      var hour = new Date().getHours();
      board.setAttribute("data-tone",
        hour >= 20 || hour < 6 ? "night" : hour < 8 || hour >= 18 ? "dusk" : "day");
    }
    syncBoardTone();
    // 首个稳定帧之后再开过渡：夜里打开页面直接是夜色，只有页面常开跨过时间点才渐变
    window.requestAnimationFrame(function () { board.classList.add("is-tone-settled"); });
    window.setInterval(syncBoardTone, 60000);
    document.addEventListener("visibilitychange", syncBoardTone);
    var auxBox = board.querySelector("[data-constellation-aux]");
    var starButtons = [].slice.call(board.querySelectorAll(".cstar"));
    var lines = [].slice.call(board.querySelectorAll("[data-link]"));
    var auxButtons = [];

    // 桌面指针视差：棋盘四层按不同幅度错位，离开后归位
    var finePointer = window.matchMedia && window.matchMedia("(min-width: 761px) and (hover: hover) and (pointer: fine)").matches;
    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (finePointer && !reduceMotion) {
      board.classList.add("is-parallax");
      var parRaf = 0;
      var parX = 0;
      var parY = 0;
      board.addEventListener("pointermove", function (ev) {
        var rect = board.getBoundingClientRect();
        parX = Math.max(-1, Math.min(1, ((ev.clientX - rect.left) / rect.width - 0.5) * 2));
        parY = Math.max(-1, Math.min(1, ((ev.clientY - rect.top) / rect.height - 0.5) * 2));
        if (parRaf) return;
        parRaf = window.requestAnimationFrame(function () {
          parRaf = 0;
          board.style.setProperty("--par-x", parX.toFixed(3));
          board.style.setProperty("--par-y", parY.toFixed(3));
          // 近星高亮：指针进入星点周围一圈就点亮，离开即熄，扩大可感知的命中范围
          var near = nearestStarAt(ev.clientX, ev.clientY);
          starButtons.forEach(function (btn) {
            btn.classList.toggle("is-near", btn.getAttribute("data-star") === near);
          });
        });
      });
      board.addEventListener("pointerleave", function () {
        board.style.setProperty("--par-x", "0");
        board.style.setProperty("--par-y", "0");
        starButtons.forEach(function (btn) { btn.classList.remove("is-near"); });
      });
    }

    var clusters = [];
    stars().forEach(function (star) {
      var ids = star.projects || [];
      if (!ids.length || !auxBox) return;
      var items = [];
      ids.forEach(function (siteId) {
        var site = siteById(siteId);
        if (!site) return;
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "caux" + (site.deployed === false ? " caux--planned" : "");
        btn.setAttribute("data-site", site.id);
        btn.setAttribute("data-parent", star.id);
        btn.style.setProperty("--accent", star.accent || DEFAULT_ACCENT);
        var tip = site.name + (site.deployed === false ? " · 地址待部署" : " · " + hostOf(site.url));
        btn.title = tip;
        btn.setAttribute("aria-label", tip + (site.deployed === false ? "" : "，打开项目"));
        btn.addEventListener("click", function () {
          if (site.deployed === false) { setStar(star.id, true); return; }
          window.open(site.url, "_blank", "noopener");
        });
        btn.addEventListener("mouseenter", function () { trace(star.id, site.id); });
        btn.addEventListener("mouseleave", clearTrace);
        btn.addEventListener("focus", function () { trace(star.id, site.id); });
        btn.addEventListener("blur", clearTrace);
        auxButtons.push(btn);
        auxBox.appendChild(btn);
        items.push({ btn: btn, x: 0, y: 0 });
      });
      if (items.length) clusters.push({ star: star, items: items });
    });

    // 辅星按像素排布：弧线上保持最小点击间距，并让开主星标签；尺寸变化后重排
    var AUX_R = 12;
    var AUX_GAP = 32;
    var LABEL_CLEAR = 6;
    var layoutRaf = 0;
    var starCenters = [];
    var auxCenters = [];
    // 主星的“手感半径”：指针落在这个距离内都算指向该星，不必压中圆点；
    // 实际半径还会按相邻主星距离收紧，避免把邻近星点吞进热区
    var NEAR_R = 46;
    var AUX_NEAR = 18;

    function nearestStarAt(clientX, clientY) {
      if (!starCenters.length) return null;
      var rect = board.getBoundingClientRect();
      var x = clientX - rect.left;
      var y = clientY - rect.top;
      // 指针压在辅星附近时让位给辅星本身，别被主星热区覆盖
      for (var a = 0; a < auxCenters.length; a++) {
        if (Math.hypot(auxCenters[a].x - x, auxCenters[a].y - y) <= AUX_NEAR) return null;
      }
      var best = null;
      var bestRatio = 1;
      starCenters.forEach(function (pt) {
        var ratio = Math.hypot(pt.x - x, pt.y - y) / pt.near;
        if (ratio < bestRatio) { bestRatio = ratio; best = pt.id; }
      });
      return best;
    }

    function hitsLabel(pt, label) {
      var nx = Math.max(label.x, Math.min(pt.x, label.x + label.w));
      var ny = Math.max(label.y, Math.min(pt.y, label.y + label.h));
      return Math.hypot(pt.x - nx, pt.y - ny) < AUX_R + LABEL_CLEAR;
    }

    function layoutAux() {
      var parX = board.style.getPropertyValue("--par-x");
      var parY = board.style.getPropertyValue("--par-y");
      board.style.setProperty("--par-x", "0");
      board.style.setProperty("--par-y", "0");
      // 冻结 3D 倾斜与巡航漂移，按未变换坐标排辅星，避免倾斜后错位
      board.classList.add("is-measuring");
      var br = board.getBoundingClientRect();
      var W = br.width;
      var H = br.height;
      var starPts = starButtons.map(function (btn) {
        var r = btn.getBoundingClientRect();
        return { id: btn.getAttribute("data-star"), x: r.left + r.width / 2 - br.left, y: r.top + r.height / 2 - br.top, r: r.width / 2 };
      });
      starPts.forEach(function (pt) {
        var nearest = Infinity;
        starPts.forEach(function (other) {
          if (other === pt) return;
          nearest = Math.min(nearest, Math.hypot(other.x - pt.x, other.y - pt.y));
        });
        // 热区最多吃到与邻星间距的 42%，两侧热区不会连成一片
        pt.near = Math.min(NEAR_R, nearest * 0.42);
      });
      starCenters = starPts;
      var labelRects = starButtons.map(function (btn) {
        var r = btn.querySelector(".cstar__label").getBoundingClientRect();
        return { id: btn.getAttribute("data-star"), x: r.left - br.left, y: r.top - br.top, w: r.width, h: r.height };
      });
      board.classList.remove("is-measuring");
      board.style.setProperty("--par-x", parX || "0");
      board.style.setProperty("--par-y", parY || "0");
      if (!W || !H) return;

      var placed = [];
      var edge = AUX_R + 10;
      clusters.forEach(function (cluster) {
        var center = null;
        var ownLabel = null;
        starPts.forEach(function (pt) { if (pt.id === cluster.star.id) center = pt; });
        labelRects.forEach(function (rect) { if (rect.id === cluster.star.id) ownLabel = rect; });
        if (!center) return;
        var n = cluster.items.length;
        var base = (cluster.star.auxAngle || 0) * Math.PI / 180;
        // 大簇（天璇 8 颗）加大张角而不是一路往外撑半径，让各星的辅星都落在相近的圈层
        var span = n > 1 ? Math.min(3.9, 1.2 + n * 0.36) : 0;
        var step = n > 1 ? span / (n - 1) : 0;

        function arcAt(offset) {
          var R = 58;
          var pts = [];
          var out = 0;
          var ok = false;
          for (var pass = 0; pass < 16; pass++) {
            pts = [];
            for (var i = 0; i < n; i++) {
              var angle = base + offset + (i - (n - 1) / 2) * step;
              pts.push({
                x: center.x + Math.cos(angle) * R,
                y: center.y + Math.sin(angle) * R * 0.8
              });
            }
            var minDist = Infinity;
            for (var a = 0; a < n; a++) {
              for (var b = a + 1; b < n; b++) {
                minDist = Math.min(minDist, Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y));
              }
            }
            out = pts.filter(function (pt) {
              return pt.x < edge || pt.x > W - edge || pt.y < edge || pt.y > H - edge;
            }).length;
            var crowded = n > 1 && minDist < AUX_GAP + 0.6;
            var covered = ownLabel && pts.some(function (pt) { return hitsLabel(pt, ownLabel); });
            ok = !crowded && !covered;
            if (ok || R >= 96) break;
            R *= crowded ? Math.min(1.6, AUX_GAP / Math.max(minDist, 1)) : 1.05;
          }
          return { pts: pts, out: out, R: R, ok: ok };
        }

        // 贴近主星优先：先比是否满足间距与避让，再比半径，最后才接受偏转；
        // 偏转范围放到整圈，大簇可以整体转到标签背侧，不用靠加大半径躲开
        var offsets = [0, 0.2, -0.2, 0.42, -0.42, 0.66, -0.66, 0.95, -0.95, 1.3, -1.3, 1.7, -1.7, 2.1, -2.1, 2.5, -2.5, 2.9, -2.9, Math.PI, -Math.PI];
        var chosen = null;
        var best = Infinity;
        offsets.forEach(function (offset) {
          var arc = arcAt(offset);
          var score = (arc.ok ? 0 : 1400) + arc.out * 160 + arc.R * 1.5 + Math.abs(offset) * 8;
          if (score < best) {
            best = score;
            chosen = arc;
          }
        });
        cluster.items.forEach(function (item, i) {
          item.x = chosen.pts[i].x;
          item.y = chosen.pts[i].y;
          placed.push(item);
        });
      });

      // 松弛：互相推开，直到都躲开标签、主星与彼此
      for (var iter = 0; iter < 48; iter++) {
        var moved = false;
        placed.forEach(function (item) {
          labelRects.forEach(function (label) {
            var need = AUX_R + LABEL_CLEAR;
            var nx = Math.max(label.x, Math.min(item.x, label.x + label.w));
            var ny = Math.max(label.y, Math.min(item.y, label.y + label.h));
            var vx = item.x - nx;
            var vy = item.y - ny;
            var d = Math.hypot(vx, vy);
            if (d >= need) return;
            if (d < 0.5) {
              var left = item.x - label.x;
              var right = label.x + label.w - item.x;
              var top = item.y - label.y;
              var bottom = label.y + label.h - item.y;
              var edge = Math.min(left, right, top, bottom);
              if (edge === left) item.x = label.x - need;
              else if (edge === right) item.x = label.x + label.w + need;
              else if (edge === top) item.y = label.y - need;
              else item.y = label.y + label.h + need;
            } else {
              var k = (need - d) / d;
              item.x += vx * k;
              item.y += vy * k;
            }
            moved = true;
          });
          starPts.forEach(function (starPt) {
            var need = starPt.r + AUX_R + 6;
            var vx = item.x - starPt.x;
            var vy = item.y - starPt.y;
            var d = Math.hypot(vx, vy);
            if (d >= need) return;
            if (d < 0.5) { item.x += need; moved = true; return; }
            var k = (need - d) / d;
            item.x += vx * k;
            item.y += vy * k;
            moved = true;
          });
          placed.forEach(function (other) {
            if (other === item) return;
            var vx = item.x - other.x;
            var vy = item.y - other.y;
            var d = Math.hypot(vx, vy);
            if (d >= AUX_GAP || d < 0.01) return;
            var k = (AUX_GAP - d) / d * 0.6;
            item.x += vx * k;
            item.y += vy * k;
            moved = true;
          });
          var bx = Math.max(edge, Math.min(W - edge, item.x));
          var by = Math.max(edge, Math.min(H - edge, item.y));
          if (bx !== item.x || by !== item.y) {
            item.x = bx;
            item.y = by;
            moved = true;
          }
        });
        if (!moved) break;
      }

      // 收口：个别被标签推得过远的辅星拉回同一圈层，避免大簇看起来「散得很开」
      placed.forEach(function (item) {
        var parentId = item.btn.getAttribute("data-parent");
        var center = null;
        starPts.forEach(function (pt) { if (pt.id === parentId) center = pt; });
        if (!center) return;
        var dx = item.x - center.x;
        var dy = item.y - center.y;
        var d = Math.hypot(dx, dy);
        if (d > 66 && d > 0.01) {
          item.x = center.x + dx / d * 66;
          item.y = center.y + dy / d * 66;
        }
      });

      auxCenters = placed.map(function (item) { return { x: item.x, y: item.y }; });
      placed.forEach(function (item) {
        item.btn.style.setProperty("--x", (item.x / W * 100).toFixed(2) + "%");
        item.btn.style.setProperty("--y", (item.y / H * 100).toFixed(2) + "%");
      });
    }

    layoutAux();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { layoutAux(); });
    }
    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        if (layoutRaf) return;
        layoutRaf = window.requestAnimationFrame(function () {
          layoutRaf = 0;
          layoutAux();
        });
      }).observe(board);
    }

    function trace(starId, siteId) {
      board.classList.add("is-tracing");
      starButtons.forEach(function (btn) {
        var id = btn.getAttribute("data-star");
        btn.classList.toggle("is-hot", id === starId);
        btn.classList.toggle("is-dim", id !== starId);
      });
      lines.forEach(function (line) {
        line.classList.toggle("is-active",
          line.getAttribute("data-link").split(" ").indexOf(starId) !== -1);
      });
      auxButtons.forEach(function (btn) {
        var same = btn.getAttribute("data-parent") === starId;
        btn.classList.toggle("is-hot", same);
        btn.classList.toggle("is-dim", !same);
        btn.classList.toggle("is-hover", same && !!siteId && btn.getAttribute("data-site") === siteId);
      });
    }

    function clearTrace() {
      board.classList.remove("is-tracing");
      starButtons.forEach(function (btn) { btn.classList.remove("is-hot", "is-dim"); });
      lines.forEach(function (line) { line.classList.remove("is-active"); });
      auxButtons.forEach(function (btn) { btn.classList.remove("is-hot", "is-dim", "is-hover"); });
    }

    starButtons.forEach(function (btn) {
      var id = btn.getAttribute("data-star");
      btn.addEventListener("click", function () { setStar(id); });
      btn.addEventListener("mouseenter", function () { trace(id, null); });
      btn.addEventListener("mouseleave", clearTrace);
      btn.addEventListener("focus", function () { trace(id, null); });
      btn.addEventListener("blur", clearTrace);
    });

    // 点星点周围的空白也按“就近”选中，不用精确压中圆点
    board.addEventListener("click", function (ev) {
      if (ev.target.closest && ev.target.closest(".cstar, .caux")) return;
      var id = nearestStarAt(ev.clientX, ev.clientY);
      if (id) setStar(id);
    });

    var reset = document.querySelector("[data-constellation-reset]");
    if (reset) reset.addEventListener("click", showAll);

    var allBtn = document.querySelector("[data-constellation-all]");
    if (allBtn) allBtn.addEventListener("click", showAll);

    // 微观星图：点节点筛选并定位工具
    [].slice.call(document.querySelectorAll("[data-constellation-micro] .ctrack")).forEach(function (node) {
      node.addEventListener("click", function () { setStage(node.getAttribute("data-stage")); });
    });

    syncConstellation();
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

  function bindShare() {
    var btn = el("share-btn");
    var toast = el("share-toast");
    if (!btn || !toast) return;

    var hideTimer, resetTimer;
    function showToast(message, ok) {
      clearTimeout(hideTimer);
      clearTimeout(resetTimer);
      toast.textContent = message;
      toast.classList.toggle("is-error", !ok);
      toast.hidden = false;
      toast.classList.remove("is-visible");
      void toast.offsetWidth;
      toast.classList.add("is-visible");
      hideTimer = setTimeout(function () {
        toast.classList.remove("is-visible");
        resetTimer = setTimeout(function () { toast.hidden = true; }, 240);
      }, 2400);
    }

    function metaContent(selector) {
      var node = document.querySelector(selector);
      return node ? node.getAttribute("content") || "" : "";
    }

    function shareUrl() {
      var canonical = document.querySelector('link[rel="canonical"]');
      return (canonical && canonical.href ? canonical.href : location.href).split("#")[0];
    }

    // 非安全上下文或权限被拒时，退回 execCommand 复制
    function legacyCopy(text) {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "-1000px";
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { /* 浏览器不支持时按失败处理 */ }
      document.body.removeChild(area);
      return ok;
    }

    function copyLink(url) {
      var task = navigator.clipboard && navigator.clipboard.writeText
        ? navigator.clipboard.writeText(url).then(function () { return true; }, function () { return legacyCopy(url); })
        : Promise.resolve(legacyCopy(url));
      task.then(function (ok) {
        showToast(ok ? "链接已复制，发给朋友吧" : "复制失败，请手动复制地址栏链接", ok);
      });
    }

    // 分享图预取：Web Share 只接受 File，提前缓存避免点击时丢失用户手势
    var shareFile = null;
    fetch("assets/img/share-thumb.jpg", { cache: "force-cache" })
      .then(function (res) { return res.ok ? res.blob() : null; })
      .then(function (blob) {
        if (!blob) return;
        var file = new File([blob], "helpenx-xingzhen-wanxiang.jpg", { type: "image/jpeg" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) shareFile = file;
      })
      .catch(function () { /* 不支持文件分享时只发链接 */ });

    btn.addEventListener("click", function () {
      var url = shareUrl();
      var motto = document.querySelector(".hero__motto");
      var data = {
        title: metaContent('meta[property="og:title"]') || "HelpEnx Hub · 星阵万象",
        text: metaContent('meta[property="og:description"]') || (motto ? motto.textContent.trim() : ""),
        url: url
      };
      if (shareFile) data.files = [shareFile];
      if (!navigator.share) {
        copyLink(url);
        return;
      }
      navigator.share(data).catch(function (err) {
        if (err && err.name === "AbortError") return;
        if (!data.files) {
          copyLink(url);
          return;
        }
        var plain = { title: data.title, text: data.text, url: data.url };
        navigator.share(plain).catch(function (err2) {
          if (err2 && err2.name === "AbortError") return;
          copyLink(url);
        });
      });
    });
  }

  setupScrollChrome();
  bindShare();

  loadData().then(function (data) {
    state.data = data;
    state.star = null;
    buildIndex();
    bindHeader();
    bindFlow();
    renderShowcase();
    renderGrid();
    bindConstellation();
    bindSearch();
    bindStickyHeader();
    revealInitial();
  });
})();
