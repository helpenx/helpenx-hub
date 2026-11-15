// 由 sites.json 生成 index.html 的 SEO 区块、页脚服务链接与内嵌数据，并输出 robots.txt / sitemap.xml
// 用法：改完 sites.json 执行 node scripts/apply-config.js
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const write = (p, s) => fs.writeFileSync(path.join(root, p), s);

const cfg = JSON.parse(read("sites.json"));
const seo = cfg.seo || {};
const brand = cfg.brand || {};
const sites = cfg.sites || [];
// 生命周期阶段（规划中→已归档）与部署可用性解耦：deployed:false 表示地址尚未部署
const availableSites = sites.filter((s) => s.deployed !== false);

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const title = seo.title || brand.fullName || "HelpEnx";
const desc = seo.description || brand.tagline || "";
const url = seo.url || "https://" + (brand.site || "helpenx.com") + "/";
const host = new URL(url).host;
const domain = host.split(".").slice(-2).join(".");

// meta keywords：门户词 + 各服务名，再按服务轮流取各自的关键词（避免词表偏向第一个服务），去重后截断
const KW_LIMIT = 30;
const keywords = [];
function addKeyword(list) {
  list.forEach((k) => {
    const v = String(k == null ? "" : k).trim();
    if (!v) return;
    if (keywords.map((x) => x.toLowerCase()).indexOf(v.toLowerCase()) === -1) keywords.push(v);
  });
}
addKeyword((seo.keywords || []).concat(sites.map((s) => s.name)));
const perSite = sites.map((s) => (s.keywords || []).slice());
for (let round = 0; keywords.length < KW_LIMIT; round++) {
  let hasMore = false;
  perSite.forEach((list) => {
    if (list[round]) { hasMore = true; addKeyword([list[round]]); }
  });
  if (!hasMore) break;
}
const metaKeywords = keywords.slice(0, KW_LIMIT).join(", ");

const og = [
  "<meta property=\"og:type\" content=\"website\" />",
  "<meta property=\"og:url\" content=\"" + esc(url) + "\" />",
  "<meta property=\"og:title\" content=\"" + esc(title) + "\" />",
  "<meta property=\"og:description\" content=\"" + esc(desc) + "\" />",
  "<meta property=\"og:site_name\" content=\"" + esc(brand.fullName || brand.name || "") + "\" />",
  "<meta property=\"og:locale\" content=\"" + esc(seo.locale || "zh_CN") + "\" />",
  "<meta property=\"og:image\" content=\"" + esc(seo.image) + "\" />",
  "<meta property=\"og:image:alt\" content=\"" + esc(seo.imageAlt || title) + "\" />",
  "<meta name=\"twitter:card\" content=\"summary_large_image\" />",
  "<meta name=\"twitter:title\" content=\"" + esc(title) + "\" />",
  "<meta name=\"twitter:description\" content=\"" + esc(desc) + "\" />",
  "<meta name=\"twitter:image\" content=\"" + esc(seo.image) + "\" />"
];
if (!seo.image) {
  og.splice(6, 2);
  og.splice(9, 1);
}

const head = [
  "<title>" + esc(title) + "</title>",
  "<meta name=\"description\" content=\"" + esc(desc) + "\" />",
  "<meta name=\"keywords\" content=\"" + esc(metaKeywords) + "\" />",
  "<meta name=\"author\" content=\"" + esc(brand.name || "") + "\" />",
  "<meta name=\"robots\" content=\"index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1\" />",
  "<meta name=\"googlebot\" content=\"index, follow\" />",
  "<link rel=\"canonical\" href=\"" + esc(url) + "\" />",
  "<link rel=\"alternate\" hreflang=\"" + esc(seo.language || "zh-CN") + "\" href=\"" + esc(url) + "\" />",
  "<link rel=\"alternate\" hreflang=\"x-default\" href=\"" + esc(url) + "\" />",
  "<meta name=\"theme-color\" content=\"#f6f8fb\" />",
  "<meta name=\"color-scheme\" content=\"light\" />",
  "<meta name=\"format-detection\" content=\"telephone=no\" />",
  "<meta name=\"referrer\" content=\"strict-origin-when-cross-origin\" />",
  "<meta name=\"application-name\" content=\"" + esc(brand.name || "") + "\" />"
].concat(og);

// 结构化数据：站点 + 组织 + 服务清单，让搜索引擎直接把子域名和产品名读走
const APP_CATEGORY = {
  studio: "MultimediaApplication",
  oss: "DeveloperApplication",
  platform: "DeveloperApplication",
  tools: "UtilitiesApplication",
  content: "NewsApplication"
};

function entity(site, position) {
  const type = site.schemaType || "WebApplication";
  const node = {
    "@type": type,
    "name": site.name,
    "url": site.url,
    "description": site.description || site.tagline || "",
    "keywords": (site.keywords || []).join(", ")
  };
  if (site.tagline) node.headline = site.tagline;
  if ((site.features || []).length) node.featureList = site.features.slice();
  if (site.repo) node.codeRepository = site.repo;
  if (type === "WebApplication") {
    node.applicationCategory = APP_CATEGORY[site.category] || "UtilitiesApplication";
    node.operatingSystem = "Web";
  }
  return { "@type": "ListItem", "position": position, "item": node };
}

const graph = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": url + "#website",
      "name": seo.name || brand.fullName,
      "alternateName": brand.alias || brand.name,
      "url": url,
      "description": desc,
      "keywords": metaKeywords,
      "inLanguage": seo.language || "zh-CN"
    },
    {
      "@type": "Organization",
      "@id": url + "#org",
      "name": brand.name,
      "alternateName": brand.fullName || brand.alias || brand.name,
      "slogan": brand.motto || "",
      "description": brand.tagline || "",
      "url": url,
      "sameAs": brand.github ? [brand.github] : []
    },
    {
      "@type": "ItemList",
      "name": (brand.fullName || "HelpEnx") + " · 北斗阵列服务清单",
      "numberOfItems": sites.length,
      "itemListElement": availableSites.map((s, i) => entity(s, i + 1))
    }
  ]
};
graph["@graph"][0].publisher = { "@id": url + "#org" };

head.push("<script type=\"application/ld+json\">" + JSON.stringify(graph, null, 2) + "</script>");

let html = read("index.html");
const eol = "\n";

// SEO 区块
(function () {
  const START = "<!-- SEO:START", END = "<!-- SEO:END -->";
  const a = html.indexOf(START), b = html.indexOf(END);
  if (a === -1 || b === -1) throw new Error("缺少 SEO 标记");
  const commentEnd = html.indexOf("\n", a);
  html = html.slice(0, commentEnd + 1) + head.join(eol) + eol + html.slice(b);
})();

// 首页主行动按钮：由 brand.cta 独立维护（外链新开标签，站内锚点原地跳转）
(function () {
  const START = "<!-- HEROCTA:START", END = "<!-- HEROCTA:END -->";
  const a = html.indexOf(START), b = html.indexOf(END);
  if (a === -1 || b === -1) throw new Error("缺少 HEROCTA 标记");
  const cta = brand.cta || {};
  function ctaBtn(item, cls, id) {
    if (!item || !item.label) return "";
    const href = item.url || "#";
    const ext = href.charAt(0) !== "#";
    return '<a class="' + cls + '" id="' + id + '" href="' + esc(href) + '"' +
      (ext ? ' target="_blank" rel="noopener"' : "") + ">" + esc(item.label) + "</a>";
  }
  const lines = [
    ctaBtn(cta.primary, "btn btn-primary", "cta-primary"),
    ctaBtn(cta.secondary, "btn btn-ghost", "cta-secondary")
  ].filter(Boolean);
  const pad = (html.slice(0, a).match(/[ \t]*$/) || [""])[0];
  const body = lines.length ? pad + lines.join(eol + pad) + eol : "";
  html = html.slice(0, html.indexOf("\n", a) + 1) + body + pad + html.slice(b);
})();

// 首页品牌副标题：观星象之序，筑数字之基。
(function () {
  const START = "<!-- HEROMOTTO:START", END = "<!-- HEROMOTTO:END -->";
  const a = html.indexOf(START), b = html.indexOf(END);
  if (a === -1 || b === -1) throw new Error("缺少 HEROMOTTO 标记");
  const pad = (html.slice(0, a).match(/[ \t]*$/) || [""])[0];
  const body = brand.motto
    ? pad + '<p class="hero__motto">' + esc(brand.motto) + "</p>" + eol
    : "";
  html = html.slice(0, html.indexOf("\n", a) + 1) + body + pad + html.slice(b);
})();

// 预渲染卡片：不执行 JS 的爬虫（百度、搜狗等）与首屏直接拿到正文，JS 加载后由 app.js 重绘
const ACCENTS = { studio: "#0a7494", oss: "#6f5bb8", platform: "#4f6ae0", tools: "#087a43", demo: "#4d6484", content: "#96650a" };
const PLANNED_ACCENT = "#8b98a9";
const STATUS_LABEL = { planned: "规划中", design: "设计中", dev: "开发中", test: "测试中", live: "已上线", iterating: "迭代中", archived: "已归档" };

function hostname(u) {
  try { return new URL(u).hostname; } catch (e) { return u; }
}
function flowOf(site) {
  const steps = (site.pipeline || []).map((step, i) =>
    (i ? '<span class="card__flow-sep" aria-hidden="true">→</span>' : "") +
    '<span class="card__flow-step">' + esc(step) + "</span>");
  return steps.length ? '<div class="card__flow">' + steps.join("") + "</div>" : "";
}
function featuresOf(site) {
  const items = (site.features || []).map((f) => "<li>" + esc(f) + "</li>");
  return items.length ? '<ul class="card__features">' + items.join("") + "</ul>" : "";
}
function iconGlyphOf(site) {
  return site.icon
    ? '<svg class="card__glyph" viewBox="0 0 24 24" aria-hidden="true"><use href="#hx-i-' + esc(site.icon) + '"></use></svg>'
    : esc(String(site.name || "?").trim().charAt(0).toUpperCase());
}
function starBadgeOf(site) {
  const star = starById[starOfSite[site.id]];
  if (!star) return "";
  const label = String(star.title || star.name || "").split(" · ")[0];
  return '<span class="card__star" style="--star:' + esc(star.accent || "#4f6ae0") +
    '" title="' + esc(star.title || star.name || label) + '">' +
    '<span class="card__star-dot" aria-hidden="true"></span>' + esc(label) + "</span>";
}
const GITHUB_ICON = '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
  '<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>';
function repoOf(site) {
  if (!site.repo) return "";
  const text = String(site.repo).replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return '<span class="card__repo" title="源码仓库：' + esc(site.repo) + '">' +
    GITHUB_ICON + esc(text) + "</span>";
}
function cardOf(site) {
  const status = site.status || "live";
  const planned = site.deployed === false;
  const accent = planned ? PLANNED_ACCENT : (ACCENTS[site.category] || "#0a7494");
  const cls = "card" + (site.span === "full" ? " card--wide" : "") + (planned ? " card--planned" : "");
  const tag = planned ? "div" : "a";
  const open = planned
    ? '<div class="' + cls + '" style="--accent:' + accent + '">'
    : '<a class="' + cls + '" href="' + esc(site.url) + '" target="_blank" rel="noopener" style="--accent:' + accent + '">';
  const badge = '<span class="status-tag status-tag--' + status + '">' +
    esc(STATUS_LABEL[status] || "规划中") + "</span>";
  const idBlock = '<div class="card__id"><span class="card__icon" aria-hidden="true">' +
      iconGlyphOf(site) + "</span>" +
      '<span class="card__idtext"><span class="card__titlerow">' +
        '<span class="card__name">' + esc(site.name) + "</span>" + badge +
      "</span>" +
      '<span class="card__meta"><span class="card__domain">' + esc(hostname(site.url)) + "</span>" +
        starBadgeOf(site) + "</span></span></div>";
  const thumb = site.image && site.span === "full"
    ? '<span class="card__thumb"><img src="' + esc(site.image) + '" alt="' +
      esc(site.imageAlt || site.name + " 示意图") + '" decoding="async"></span>'
    : "";
  const lead = thumb ? '<div class="card__lead">' + idBlock + thumb + "</div>" : idBlock;
  return open +
    lead +
    '<div class="card__main">' +
      '<span class="card__tagline">' + esc(site.tagline || "") + "</span>" +
      '<p class="card__desc">' + esc(site.description || "") + "</p>" +
      featuresOf(site) +
      repoOf(site) +
    "</div>" +
    (planned ? "" : '<span class="card__arrow" aria-hidden="true">↗</span>') +
    "</" + tag + ">";
}
function heroCardOf(site) {
  const status = site.status || "live";
  const media = site.image
    ? '<a class="showcase__media" href="' + esc(site.url) + '" target="_blank" rel="noopener">' +
      '<img src="' + esc(site.image) + '" alt="' + esc(site.name + " 生产链路示意") + '"></a>'
    : "";
  return '<article class="showcase__card" style="--accent:' + (ACCENTS[site.category] || "#0a7494") + '">' +
    '<div class="showcase__head"><div class="showcase__idline">' +
      '<span class="showcase__name">' + esc(site.name) + "</span>" +
      '<span class="status-tag status-tag--' + status + '">' + esc(STATUS_LABEL[status] || "") + "</span>" +
      '<span class="showcase__domain">' + esc(hostname(site.url)) + "</span>" +
      starBadgeOf(site) + "</div>" +
    '<a class="btn btn-primary" href="' + esc(site.url) + '" target="_blank" rel="noopener">' +
      esc(site.ctaLabel || "进入") + ' <span class="btn__arrow" aria-hidden="true">→</span></a></div>' +
    '<div class="showcase__main"><div class="showcase__text">' +
      '<span class="showcase__tagline">' + esc(site.tagline || "") + "</span>" +
      '<p class="showcase__desc">' + esc(site.description || "") + "</p>" +
      '<div class="arch-teaser"><div class="arch-teaser__text">' +
        '<span class="arch-teaser__eyebrow">轻天璇 Studio · 技术底座</span>' +
        '<p class="arch-teaser__title">四层架构、两条总线：控制面编排，数据面执行，模型层统一出网</p>' +
        '<p class="arch-teaser__desc">NeoFlow 拆 DAG，NeoTask 拉任务，AI Gateway 收敛模型出口；PenFix 三道质检门按根因回退。分层、总线与回退路径在系统架构页展开。</p>' +
      "</div>" +
      '<a class="arch-teaser__link" href="./architecture.html">查看系统架构 <span aria-hidden="true">→</span></a></div>' +
      "</div>" + media + "</div>" +
    '<div class="showcase__bands">' + flowOf(site) + featuresOf(site) + "</div></article>";
}

// 北斗阵列：七主星承载全部服务，辅星与面板清单由同一条配置驱动
const constellation = cfg.constellation || {};
const stars = constellation.stars || [];
const siteById = {};
sites.forEach((s) => { siteById[s.id] = s; });

// 每项服务必须且只能归属一颗主星，避免漏项与重复入口
const starOfSite = {};
stars.forEach((star) => {
  (star.projects || []).forEach((id) => {
    if (!siteById[id]) throw new Error("constellation 引用了不存在的服务：" + id);
    if (starOfSite[id]) throw new Error("服务 " + id + " 同时归属 " + starOfSite[id] + " 与 " + star.id);
    starOfSite[id] = star.id;
  });
});
const unassigned = sites.filter((s) => !starOfSite[s.id]).map((s) => s.id);
if (unassigned.length) throw new Error("以下服务未加入北斗阵列：" + unassigned.join(", "));

const starById = {};
stars.forEach((s) => { starById[s.id] = s; });
if (!stars.length) throw new Error("constellation 缺少主星");
const starCount = (s) => (s.projects || []).length;

// 微观七星轨：主星可挂 track，环节必须指向本星已有的服务，且不得重复
const stageSiteIds = {};
stars.forEach((star) => {
  const track = star.track;
  if (!track) return;
  const stages = track.stages || [];
  if (!stages.length) throw new Error("track 缺少 stages：" + star.id);
  const seen = {};
  stages.forEach((stage) => {
    if (!stage.id || seen[stage.id]) throw new Error("track 环节 id 缺失或重复：" + star.id + " / " + stage.id);
    seen[stage.id] = true;
    if (!stage.char) throw new Error("track 环节缺少 char：" + stage.id);
    if (!siteById[stage.site]) throw new Error("track 引用了不存在的服务：" + stage.site);
    if (stageSiteIds[stage.site]) throw new Error("track 环节重复引用服务：" + stage.site);
    stageSiteIds[stage.site] = star.id;
    if ((star.projects || []).indexOf(stage.site) === -1) {
      throw new Error("track 环节的服务不属于 " + star.id + "：" + stage.site);
    }
  });
});
// 微观星图：track 之外的主星可挂 micro，节点必须覆盖本星全部服务且不重复
const microLayouts = ["stack", "orbit", "beacon", "matrix", "spiral", "nexus"];
stars.forEach((star) => {
  const micro = star.micro;
  if (!micro) return;
  if (star.track) throw new Error("track 与 micro 只能二选一：" + star.id);
  if (microLayouts.indexOf(micro.layout) === -1) {
    throw new Error("micro.layout 不支持：" + star.id + " / " + micro.layout);
  }
  const nodes = micro.nodes || [];
  if (!nodes.length) throw new Error("micro 缺少 nodes：" + star.id);
  const seenNode = {}, seenSite = {};
  nodes.forEach((node) => {
    if (!node.id || seenNode[node.id]) throw new Error("micro 节点 id 缺失或重复：" + star.id + " / " + node.id);
    seenNode[node.id] = true;
    if (!node.char) throw new Error("micro 节点缺少 char：" + node.id);
    if (!siteById[node.site]) throw new Error("micro 引用了不存在的服务：" + node.site);
    if (seenSite[node.site]) throw new Error("micro 节点重复引用服务：" + node.site);
    seenSite[node.site] = true;
    if ((star.projects || []).indexOf(node.site) === -1) {
      throw new Error("micro 节点的服务不属于 " + star.id + "：" + node.site);
    }
  });
  const missing = (star.projects || []).filter((id) => !seenSite[id]);
  if (missing.length) throw new Error("micro 未覆盖 " + star.id + " 的服务：" + missing.join(", "));
});
const microStars = stars.filter((s) => (
  (s.track && (s.track.stages || []).length) || (s.micro && (s.micro.nodes || []).length)
));

// 页脚按七星阵列收敛：每颗主星只留一条代表入口，完整清单仍在阵列面板与页面内
(function () {
  const START = "<!-- FOOTNAV:START", END = "<!-- FOOTNAV:END -->";
  const a = html.indexOf(START), b = html.indexOf(END);
  if (a === -1 || b === -1) throw new Error("缺少 FOOTNAV 标记");

  function footStarOf(star) {
    const accent = ' style="--accent:' + esc(star.accent || "#4f6ae0") + '"';
    const site = (star.projects || []).map((id) => siteById[id])
      .filter((item) => item && item.deployed !== false)[0];
    if (site) {
      return '<a class="footstar" href="' + esc(site.url) + '" target="_blank" rel="noopener"' + accent + ">" +
        '<span class="footstar__name">' + esc(star.name) + "</span>" +
        '<span class="footstar__line">' + esc(star.short || "") + "</span>" +
        '<span class="footstar__site">' + esc(site.name) + "</span></a>";
    }
    // 整条产品线都尚未部署时，退回站内星图，避免页脚缺一颗主星
    const planned = (star.projects || []).map((id) => siteById[id]).filter(Boolean)[0];
    if (!planned) return "";
    return '<a class="footstar" href="#constellation"' + accent + ">" +
      '<span class="footstar__name">' + esc(star.name) + "</span>" +
      '<span class="footstar__line">' + esc(star.short || "") + "</span>" +
      '<span class="footstar__site">规划中 · 查看星图</span></a>';
  }

  const pad = "    ";
  const links = stars.map(footStarOf).filter(Boolean);
  const commentEnd = html.indexOf("\n", a);
  html = html.slice(0, commentEnd + 1) + links.map((line) => pad + line).join(eol) + eol + pad + html.slice(b);
})();

const heroSite = sites.filter((s) => s.size === "hero")[0];

// 通栏分隔条：与 app.js dividerNode 同构，由 sites.json 的 dividerBefore 驱动
function dividerOf(label, note) {
  return '<div class="grid__divider" role="separator">' +
    (label ? '<span class="grid__divider-label">' + esc(label) + "</span>" : "") +
    (note ? '<span class="grid__divider-note">' + esc(note) + "</span>" : "") +
    '<span class="grid__divider-rule" aria-hidden="true"></span></div>';
}
const gridList = sites.filter((s) => s !== heroSite);
const gridCards = [];
gridList.forEach((s, i) => {
  const dv = s.dividerBefore;
  if (dv && i > 0) {
    const conf = dv === true ? {} : dv;
    let note = conf.note || "";
    if (conf.countCategory) {
      const n = gridList.filter((x) => x.category === conf.countCategory).length;
      note = (note ? note + " · " : "") + n;
    }
    gridCards.push(dividerOf(conf.label || "", note));
  }
  gridCards.push(cardOf(s));
});

// 写入 showcase 与 grid 的原始 HTML（两者都以标记行定位，替换标记之间的内容）
function fillBlock(startMarker, endMarker, cards) {
  const a = html.indexOf(startMarker), b = html.indexOf(endMarker);
  if (a === -1 || b === -1) throw new Error("缺少 " + startMarker + " 标记");
  const pad = (html.slice(0, a).match(/[ \t]*$/) || [""])[0];
  const body = cards.length ? pad + cards.join(eol + pad) + eol : "";
  html = html.slice(0, html.indexOf("\n", a) + 1) + body + pad + html.slice(b);
}
fillBlock("<!-- CARDS-HERO:START", "<!-- CARDS-HERO:END -->", heroSite ? [heroCardOf(heroSite)] : []);
fillBlock("<!-- CARDS-GRID:START", "<!-- CARDS-GRID:END -->", gridCards);

function starButtonOf(s) {
  const count = starCount(s);
  const hasTrack = !!(s.track && (s.track.stages || []).length);
  const hasMicro = !!(s.micro && (s.micro.nodes || []).length);
  const hasMap = hasTrack || hasMicro;
  return '<button class="cstar' + (hasMap ? " cstar--track" : "") +
    " cstar--label-" + esc(s.label || "bottom") + '" type="button" data-star="' + esc(s.id) +
    '" aria-pressed="false"' +
    ' aria-label="' + esc(s.title + "，" + count + " 项服务，" +
      (hasTrack ? "点击展开七星轨" : hasMicro ? "点击展开星图" : "点击筛选")) + '"' +
    ' style="--accent:' + esc(s.accent || "#4f6ae0") + ";--x:" + s.x + "%;--y:" + s.y + '%">' +
    '<span class="cstar__point" aria-hidden="true"><span class="cstar__halo"></span><span class="cstar__dot"></span></span>' +
    '<span class="cstar__label"><span class="cstar__name">' + esc(s.name) + "</span>" +
      '<span class="cstar__short">' + esc(s.short || "") + "</span>" +
      (hasMap ? '<span class="cstar__track">' + (hasTrack ? "轨" : "图") + "</span>" : "") +
      '<span class="cstar__count">' + count + "</span></span>" +
    "</button>";
}

function starLinkOf(pair) {
  const a = starById[pair[0]], b = starById[pair[1]];
  if (!a || !b) throw new Error("constellation.links 引用了不存在的主星：" + pair.join(" / "));
  return '<line data-link="' + esc(pair.join(" ")) + '" x1="' + (a.x * 10).toFixed(1) +
    '" y1="' + (a.y * 3.4).toFixed(1) + '" x2="' + (b.x * 10).toFixed(1) +
    '" y2="' + (b.y * 3.4).toFixed(1) + '"></line>';
}

// 环节坐标以百分比书写，与主星画布共用 1000 × 340 的视口
function railPathOf(stages) {
  const pts = stages.map((s) => ({ x: +(s.x * 10).toFixed(1), y: +(s.y * 3.4).toFixed(1) }));
  if (pts.length < 2) return "";
  let d = "M" + pts[0].x + " " + pts[0].y;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    d += "C" + (p1.x + (p2.x - p0.x) / 6).toFixed(1) + " " + (p1.y + (p2.y - p0.y) / 6).toFixed(1) +
      " " + (p2.x - (p3.x - p1.x) / 6).toFixed(1) + " " + (p2.y - (p3.y - p1.y) / 6).toFixed(1) +
      " " + p2.x + " " + p2.y;
  }
  return d;
}

// 每颗主星一副微观星图：track 沿用七星轨，其余按 layout 生成不同几何
function microOf(star) {
  if (star.track && (star.track.stages || []).length) {
    const track = star.track;
    return {
      layout: "track", nodes: track.stages, eyebrow: track.eyebrow, title: track.title,
      charLine: track.charLine, lead: track.lead, hint: track.hint, sats: []
    };
  }
  return star.micro || null;
}

function microNodeOf(star, node) {
  const site = siteById[node.site];
  const label = node.label || site.cn || site.name;
  const planned = site.deployed === false;
  return '<button class="ctrack' + (planned ? " ctrack--planned" : "") + '" type="button" data-stage="' + esc(node.id) +
    '" data-site="' + esc(site.id) + '" data-star="' + esc(star.id) + '" aria-pressed="false"' +
    ' aria-label="' + esc("筛选 " + site.name + "，定位到卡片") + '"' +
    ' style="--accent:' + esc(node.accent || star.accent || "#4f6ae0") + ";--x:" + node.x + "%;--y:" + node.y + '%">' +
    '<span class="ctrack__node" aria-hidden="true"><span class="ctrack__char">' + esc(node.char) + "</span></span>" +
    '<span class="ctrack__label"><span class="ctrack__name">' + esc(node.char + " · " + label) + "</span>" +
      '<span class="ctrack__site">' + esc(site.name) + "</span></span>" +
  "</button>";
}

function seededRand(seed) {
  let s = 2166136261;
  for (let i = 0; i < seed.length; i++) s = Math.imul(s ^ seed.charCodeAt(i), 16777619) >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function speckFieldOf(seed) {
  const rand = seededRand(seed);
  let out = "";
  for (let i = 0; i < 24; i++) {
    const x = (rand() * 1000).toFixed(1);
    const y = (rand() * 340).toFixed(1);
    const r = (rand() < 0.28 ? 1.5 : 0.9).toFixed(1);
    out += '<circle class="cmicro__speck" cx="' + x + '" cy="' + y + '" r="' + r + '"></circle>';
  }
  return out;
}

function arcPathOf(cx, cy, rx, ry, from, to) {
  const pt = (deg) => [
    (cx + Math.cos((deg * Math.PI) / 180) * rx).toFixed(1),
    (cy + Math.sin((deg * Math.PI) / 180) * ry).toFixed(1)
  ];
  const a = pt(from), b = pt(to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const sweep = to > from ? 1 : 0;
  return "M" + a[0] + " " + a[1] + " A" + rx + " " + ry + " 0 " + large + " " + sweep + " " + b[0] + " " + b[1];
}

function microDecorOf(star, micro) {
  const layout = micro.layout || "track";
  const nodes = micro.nodes || [];
  const out = [speckFieldOf(star.id + layout)];
  const px = (v) => (v * 10).toFixed(1);
  const py = (v) => (v * 3.4).toFixed(1);
  if (layout === "stack") {
    (micro.bands || []).forEach((band, i) => {
      out.push('<line class="cmicro-band" x1="46" y1="' + py(band.y) + '" x2="954" y2="' + py(band.y) + '"></line>');
      out.push('<line class="cmicro-band-flow" x1="46" y1="' + py(band.y) + '" x2="954" y2="' + py(band.y) +
        '" style="animation-delay:' + (-i * 1.9).toFixed(1) + 's"></line>');
      out.push('<text class="cmicro-band__label" x="54" y="' + (py(band.y) - 8) + '">' +
        esc((band.en ? band.en + " · " : "") + (band.cn || "")) + "</text>");
    });
  } else if (layout === "orbit") {
    out.push('<ellipse class="cmicro-orbit" cx="500" cy="170" rx="286" ry="96"></ellipse>');
    out.push('<ellipse class="cmicro-orbit-flow" cx="500" cy="170" rx="286" ry="96"></ellipse>');
    out.push('<ellipse class="cmicro-orbit cmicro-orbit--inner" cx="500" cy="170" rx="150" ry="50"></ellipse>');
    out.push('<ellipse class="cmicro-orbit-flow cmicro-orbit-flow--inner" cx="500" cy="170" rx="150" ry="50"></ellipse>');
    out.push('<line class="cmicro-tick" x1="500" y1="138" x2="500" y2="202"></line>');
    out.push('<line class="cmicro-tick" x1="468" y1="170" x2="532" y2="170"></line>');
  } else if (layout === "beacon") {
    const node = nodes[0] || { x: 34, y: 50 };
    const cx = px(node.x), cy = py(node.y);
    [[92, 80], [170, 128], [250, 170]].forEach((r, i) => {
      out.push('<ellipse class="cmicro-orbit cmicro-breathe' + (i === 1 ? " cmicro-orbit--inner" : "") +
        '" cx="' + cx + '" cy="' + cy + '" rx="' + r[0] + '" ry="' + r[1] +
        '" style="animation-delay:' + (-i * 1.3).toFixed(1) + 's"></ellipse>');
    });
    out.push('<path class="cmicro-beam" d="M' + cx + " " + cy + " L900 30 L900 310 Z\"></path>");
  } else if (layout === "matrix") {
    out.push('<line class="cmicro-axis" x1="500" y1="26" x2="500" y2="314"></line>');
    out.push('<line class="cmicro-axis" x1="46" y1="170" x2="954" y2="170"></line>');
    out.push('<line class="cmicro-scan" x1="46" y1="26" x2="954" y2="26"></line>');
    (micro.quadrants || []).forEach((q) => {
      out.push('<text class="cmicro-quad" x="' + px(q.x) + '" y="' + py(q.y) +
        '" text-anchor="' + (q.anchor || "start") + '">' + esc(q.text) + "</text>");
    });
  } else if (layout === "spiral") {
    const node = nodes[0] || { x: 30, y: 52 };
    const cx = +px(node.x), cy = +py(node.y);
    [[190, 58, -150, 40], [280, 86, -160, 30], [370, 112, -168, 22]].forEach((r, i) => {
      out.push('<path class="cmicro-orbit' + (i ? " cmicro-orbit--faint" : "") + '" d="' +
        arcPathOf(cx, cy, r[0], r[1], r[2], r[3]) + '"></path>');
      out.push('<path class="cmicro-orbit-flow' + (i ? " cmicro-orbit-flow--faint" : "") + '" style="animation-delay:' +
        (-i * 1.7).toFixed(1) + 's" d="' + arcPathOf(cx, cy, r[0], r[1], r[2], r[3]) + '"></path>');
    });
  } else if (layout === "nexus") {
    out.push('<ellipse class="cmicro-orbit cmicro-orbit--inner" cx="500" cy="170" rx="150" ry="56"></ellipse>');
    out.push('<ellipse class="cmicro-orbit-flow cmicro-orbit-flow--inner" cx="500" cy="170" rx="150" ry="56"></ellipse>');
    out.push('<ellipse class="cmicro-orbit" cx="500" cy="170" rx="300" ry="110"></ellipse>');
    out.push('<ellipse class="cmicro-orbit-flow" cx="500" cy="170" rx="300" ry="110"></ellipse>');
    out.push('<circle class="cmicro-node-ring" cx="500" cy="170" r="34"></circle>');
    nodes.forEach((node) => {
      out.push('<line class="cmicro-spoke" x1="500" y1="170" x2="' + px(node.x) + '" y2="' + py(node.y) + '"></line>');
      out.push('<line class="cmicro-spoke-flow" x1="500" y1="170" x2="' + px(node.x) + '" y2="' + py(node.y) + '"></line>');
    });
  } else if (layout === "track") {
    const rail = railPathOf(nodes);
    out.push('<path class="ctrack-rail" d="' + rail + '"></path>');
    out.push('<path class="ctrack-flow" d="' + rail + '"></path>');
    out.push('<path class="ctrack-aura" d="' + rail + '"></path>');
    out.push('<path class="ctrack-comet" d="' + rail + '"></path>');
  }
  return out.join("");
}

function microSatOf(sat) {
  return '<span class="cmicro__sat" style="--x:' + sat.x + "%;--y:" + sat.y + '%" aria-hidden="true">' +
    '<i aria-hidden="true"></i>' + esc(sat.text) + "</span>";
}

function microCoreOf(core) {
  return '<span class="cmicro__core" style="--x:' + core.x + "%;--y:" + core.y + '%" aria-hidden="true">' +
    '<span class="cmicro__core-title">' + esc(core.title || "") + "</span>" +
    '<span class="cmicro__core-note">' + esc(core.note || "") + "</span></span>";
}

function microBoardOf(star) {
  const micro = microOf(star);
  if (!micro) return [];
  const layout = micro.layout || "track";
  const nodes = micro.nodes || [];
  const kind = layout === "track" ? "环节" : "节点";
  const out = [];
  out.push('<div class="constellation__board constellation__board--micro constellation__board--' + layout +
    '" data-constellation-micro="' + esc(star.id) + '" data-micro-layout="' + layout +
    '" role="group" aria-label="' + esc((micro.title || star.title) + "：点" + kind + "筛选并定位工具") +
    '" style="--accent:' + esc(star.accent || "#4f6ae0") + '" hidden>');
  out.push('  <span class="ctrack__level" aria-hidden="true">' + esc(micro.eyebrow || star.title) + "</span>");
  out.push('  <svg class="constellation__edges constellation__edges--micro" viewBox="0 0 1000 340" preserveAspectRatio="none" aria-hidden="true" focusable="false">');
  out.push("    " + microDecorOf(star, micro));
  out.push("  </svg>");
  if (micro.core) out.push("  " + microCoreOf(micro.core));
  (micro.sats || []).forEach((sat) => out.push("  " + microSatOf(sat)));
  nodes.forEach((node) => out.push("  " + microNodeOf(star, node)));
  out.push('  <span class="constellation__axis" aria-hidden="true">' +
    esc(star.name + " · " + (micro.charLine || "微 观 星 图")) + "</span>");
  out.push('  <span class="constellation__meta" aria-hidden="true">' + nodes.length + " " + kind + " · 点按定位</span>");
  out.push("</div>");
  return out;
}

(function () {
  const START = "<!-- CONSTELLATION:START", END = "<!-- CONSTELLATION:END -->";
  const a = html.indexOf(START), b = html.indexOf(END);
  if (a === -1 || b === -1) throw new Error("缺少 CONSTELLATION 标记");
  if (!stars.length) {
    html = html.slice(0, html.indexOf("\n", a) + 1) + html.slice(b);
    return;
  }

  const lines = [];
  const p = "    ";
  lines.push(p + '<div class="constellation__head">');
  if (constellation.eyebrow) {
    lines.push(p + '  <span class="constellation__eyebrow">' + esc(constellation.eyebrow) + "</span>");
  }
  lines.push(p + '  <h2 class="constellation__title" id="constellation-title">' +
    esc(constellation.title || "") + "</h2>");
  if (constellation.lead) {
    lines.push(p + '  <p class="constellation__lead">' + esc(constellation.lead) + "</p>");
  }
  lines.push(p + '  <div class="constellation__toolrow">');
  if (constellation.hint) {
    lines.push(p + '    <p class="constellation__hint"><span class="constellation__hintdot" aria-hidden="true"></span>' +
      esc(constellation.hint) + "</p>");
  }
  lines.push(p + '    <button class="constellation__all" type="button" data-constellation-all aria-label="显示全部 ' +
    sites.length + ' 项服务">全部服务 · ' + sites.length + "</button>");
  lines.push(p + "  </div>");
  lines.push(p + "</div>");

  lines.push(p + '<div class="constellation__board" data-constellation-board role="group" aria-label="北斗阵列：点主星在下方展开星图，点辅星直达项目">');
  lines.push(p + '  <svg class="constellation__edges" viewBox="0 0 1000 340" preserveAspectRatio="none" aria-hidden="true" focusable="false">');
  (constellation.links || []).forEach((pair) => lines.push(p + "      " + starLinkOf(pair)));
  lines.push(p + "  </svg>");
  // 底色环上的日地月：太阳与地球沿椭圆环公转，月球绕地自转
  lines.push(p + '  <span class="constellation__orbit" aria-hidden="true">');
  lines.push(p + '    <i class="corb corb--sun"></i>');
  lines.push(p + '    <i class="corb corb--earth"><i class="corb__moon"></i></i>');
  lines.push(p + "  </span>");
  // 颗粒流星：细长亮粒按各自节拍斜落，取代原来整片扫光
  const meteors = [
    [6, 2, 74, 9.4, -1.2, -33], [18, 10, 52, 11.6, -6.4, -29],
    [27, 1, 64, 10.2, -8.8, -36], [41, 6, 46, 12.4, -3.5, -31],
    [56, 2, 82, 8.8, -7.1, -34], [66, 12, 58, 10.8, -0.4, -28],
    [78, 4, 68, 9.8, -5.2, -35], [88, 9, 48, 12.8, -9.6, -30]
  ];
  lines.push(p + '  <span class="constellation__meteors" aria-hidden="true">');
  meteors.forEach(([x, y, len, dur, delay, angle]) => lines.push(p + '    <i style="--x:' + x + "%;--y:" + y +
    "%;--len:" + len + "px;--dur:" + dur + "s;--delay:" + delay + "s;--angle:" + angle + 'deg"></i>'));
  lines.push(p + "  </span>");
  lines.push(p + '  <div class="constellation__aux" data-constellation-aux></div>');
  stars.forEach((s) => lines.push(p + "  " + starButtonOf(s)));
  lines.push(p + '  <span class="constellation__axis" aria-hidden="true">北斗 · BIG DIPPER</span>');
  lines.push(p + '  <span class="constellation__meta" aria-hidden="true">' + sites.length + " 服务 · " +
    stars.length + " 主星 · 点按展开</span>");
  lines.push(p + "</div>");

  if (microStars.length) {
    lines.push(p + '<div class="constellation__stage" data-constellation-stage hidden>');
    lines.push(p + '  <div class="constellation__stage-head">');
    lines.push(p + '    <div class="constellation__stage-info">');
    lines.push(p + '      <span class="constellation__stage-eyebrow" data-constellation-eyebrow>MICRO MAP · 当前星图</span>');
    lines.push(p + '      <div class="constellation__stage-row">');
    lines.push(p + '        <h3 class="constellation__stage-title" data-constellation-title>全部服务</h3>');
    lines.push(p + '        <span class="constellation__stage-count" data-constellation-count>' +
      sites.length + " 项服务</span>");
    lines.push(p + "      </div>");
    lines.push(p + '      <p class="constellation__stage-desc" data-constellation-desc>' +
      esc(constellation.lead || brand.tagline || "") + "</p>");
    lines.push(p + "    </div>");
    lines.push(p + '    <button class="constellation__reset" type="button" data-constellation-reset>收起星图 ✕</button>');
    lines.push(p + "  </div>");
    lines.push(p + '  <div class="constellation__flip" data-constellation-flip data-mode="macro">');
    microStars.forEach((star) => {
      microBoardOf(star).forEach((line) => lines.push(p + "    " + line));
    });
    lines.push(p + "  </div>");
    lines.push(p + "</div>");
  }

  const body = lines.join(eol) + eol;
  html = html.slice(0, html.indexOf("\n", a) + 1) + body + p + html.slice(b);
})();

// AIGC Studio 定位引言与六段流水线：分两块生成，中间的 Studio 卡片由 CARDS-HERO 维护
(function () {
  const story = cfg.story || {};
  const stages = story.stages || [];

  // 数据流图：数据是节点，工具是连线。画布固定 7 列，节点按 col / lane 落到网格上，
  // 连线由 from / to 的包围盒计算；route:over 绕到画布顶部、route:under 绕到底部，
  // routeY 覆盖默认绕行高度（多条同向回退线需要错开时使用）。
  const stageMap = {};
  stages.forEach((s, i) => { stageMap[s.id] = { stage: s, index: i }; });
  const graph = story.graph || {};
  const NODE_W = 98, MID_H = 96, SIDE_H = 88, GAP = 49;
  const LANE_Y = { top: 104, mid: 250, bottom: 396 };
  const BOARD_W = 980, BOARD_H = 456, REWORK_Y = 20, REWORK_UNDER_Y = 340;
  const KIND_COLOR = { flow: "#3f7f96", branch: "#7059b0", gate: "#a8843c", merge: "#3f8a63", rework: "#a45757" };

  const boxes = {};
  const graphNodes = (graph.nodes || []).map((n) => {
    const h = n.lane === "mid" ? MID_H : SIDE_H;
    const x = (n.col || 0) * (NODE_W + GAP);
    const y = (LANE_Y[n.lane] || LANE_Y.mid) - h / 2;
    const box = Object.assign({}, n, {
      x: x, y: y, w: NODE_W, h: h,
      right: x + NODE_W, cx: x + NODE_W / 2, cy: y + h / 2
    });
    boxes[n.id] = box;
    return box;
  });

  function edgeGeometry(edge) {
    const a = boxes[edge.from], b = boxes[edge.to];
    if (!a || !b) return null;
    if (edge.route === "over" || edge.route === "under") {
      const under = edge.route === "under";
      const y = edge.routeY || (under ? REWORK_UNDER_Y : REWORK_Y);
      const fromY = under ? a.y + a.h : a.y;
      const toY = under ? b.y + b.h : b.y;
      return {
        d: "M" + a.cx + " " + fromY + "V" + y + "H" + b.cx + "V" + toY,
        lx: (a.cx + b.cx) / 2,
        ly: y
      };
    }
    if (a.cy === b.cy) {
      return {
        d: "M" + a.right + " " + a.cy + "H" + b.x,
        lx: (a.right + b.x) / 2,
        ly: a.cy - 22
      };
    }
    const c1 = a.right + (b.x - a.right) * 0.5;
    const c2 = b.x - (b.x - a.right) * 0.5;
    return {
      d: "M" + a.right + " " + a.cy + "C" + c1 + " " + a.cy + " " + c2 + " " + b.cy + " " + b.x + " " + b.cy,
      lx: (a.right + b.x) / 2,
      ly: (a.cy + b.cy) / 2
    };
  }

  const graphEdges = (graph.edges || []).map((edge, i) => {
    const geo = edgeGeometry(edge);
    if (!geo) return null;
    const entry = stageMap[edge.tool] || {};
    const stage = entry.stage || {};
    const kind = edge.kind || "flow";
    return {
      edge: edge,
      geo: geo,
      index: i,
      kind: kind,
      label: edge.label || stage.name || edge.tool,
      cn: stage.cn || "",
      tool: edge.tool,
      color: KIND_COLOR[kind] || KIND_COLOR.flow,
      dur: +(3 + i * 0.18).toFixed(2),
      delay: +(i * 0.37).toFixed(2)
    };
  }).filter(Boolean);

  const edgeCaptions = graphEdges.map((row) => ({
    kind: row.kind,
    tool: row.tool,
    label: row.edge.caption || row.label
  }));

  function writeBlock(startMarker, endMarker, pad, lines) {
    const a = html.indexOf(startMarker), b = html.indexOf(endMarker);
    if (a === -1 || b === -1) throw new Error("缺少 " + startMarker + " 标记");
    const body = lines.length ? lines.join(eol) + eol : "";
    html = html.slice(0, html.indexOf("\n", a) + 1) + body + pad + html.slice(b);
  }

  // 引言：标题 + 定位段落
  const headPad = "    ";
  const headLines = [];
  if (story.title) {
    headLines.push(headPad + '<div class="story__head">');
    if (story.eyebrow) headLines.push(headPad + '  <span class="story__eyebrow">' + esc(story.eyebrow) + "</span>");
    headLines.push(headPad + '  <h2 class="story__title" id="story-title">' + esc(story.title) + "</h2>");
    (story.lead || []).forEach((t) => headLines.push(headPad + '  <p class="story__lead">' + esc(t) + "</p>"));
    headLines.push(headPad + "</div>");
  }
  writeBlock("<!-- STORY-HEAD:START", "<!-- STORY-HEAD:END -->", headPad, headLines);

  // 数据流图：契约从创意一路写到分镜，分叉出视频 / 音频，各自过质检后落轨；
  // 终审按根因分流——合成问题回 PenClip 重剪，素材问题回 Gen/Dub 重生成
  // 工具是连线上的按钮，点击打开对应环节的详情；数据节点只展示契约，不可点击
  const flowPad = "    ";
  const flowLines = [];
  if (graphNodes.length) {
    const kinds = story.kinds || [];
    flowLines.push(flowPad + '<div class="flow-pool">');
    flowLines.push(flowPad + '  <div class="flow-pool__bg" aria-hidden="true">');
    flowLines.push(flowPad + '    <span class="flow-pool__wave flow-pool__wave--a"></span>');
    flowLines.push(flowPad + '    <span class="flow-pool__wave flow-pool__wave--b"></span>');
    flowLines.push(flowPad + '    <span class="flow-pool__monogram">N</span>');
    flowLines.push(flowPad + "  </div>");
    flowLines.push(flowPad + '  <div class="flow-pool__head">');
    flowLines.push(flowPad + '    <button class="flow-pool__label" type="button" aria-pressed="true">' +
      '<span class="flow-pool__tile">N</span><span class="flow-pool__name">NeoTask</span>' +
      '<span class="flow-pool__tag">数据流</span>' +
      '<span class="flow-pool__bus">' + esc(story.busLabel || "DATA FLOW") + "</span>" +
      '<span class="flow-pool__hint"><span class="flow-pool__play" aria-hidden="true"></span><span class="flow-pool__hinttext">暂停演示</span></span></button>');
    flowLines.push(flowPad + '    <span class="flow-pool__note" data-idle="' + esc(story.busNote || "") +
      '" data-captions="' + esc(JSON.stringify(edgeCaptions)) + '">' + esc(story.busNote || "") + "</span>");
    flowLines.push(flowPad + "  </div>");
    if (kinds.length) {
      flowLines.push(flowPad + '  <div class="flow-legend" role="group" aria-label="数据流类型，点击聚焦对应连线">');
      kinds.forEach((k) => {
        flowLines.push(flowPad + '    <button class="flow-legend__chip flow-legend__chip--' + esc(k.id) +
          '" type="button" data-kind="' + esc(k.id) + '" aria-pressed="false">' +
          '<span class="flow-legend__dot" aria-hidden="true"></span>' + esc(k.label) + "</button>");
      });
      flowLines.push(flowPad + "  </div>");
    }

    flowLines.push(flowPad + '  <div class="flow" data-flow>');
    flowLines.push(flowPad + '    <div class="flow__scroll">');
    flowLines.push(flowPad + '      <div class="flow__board" data-flow-board role="group" aria-label="短剧数据流：原始创意经 PenPlot、PenShot 变成分镜，分叉出视频与音频；PenGen、PenDub 的产出分别经 PenFix 质检，不合格退回分镜调整提示词重做；PenClip 落轨成初剪后再由 PenFix 终审，合成问题退回 PenClip 重剪，镜头素材问题按镜头退回 PenGen / PenDub 重新生成，通过才输出成片" style="width:' + BOARD_W + 'px;height:' + BOARD_H + 'px">');
    flowLines.push(flowPad + '        <svg class="flow__edges" viewBox="0 0 ' + BOARD_W + ' ' + BOARD_H + '" aria-hidden="true" focusable="false">');
    flowLines.push(flowPad + "          <defs>");
    kinds.forEach((k) => {
      flowLines.push(flowPad + '            <marker id="flow-arrow-' + esc(k.id) +
        '" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">' +
        '<path d="M0 0 8 4 0 8z" fill="' + (KIND_COLOR[k.id] || KIND_COLOR.flow) + '"/></marker>');
    });
    flowLines.push(flowPad + "          </defs>");
    graphEdges.forEach((row) => {
      flowLines.push(flowPad + '          <path class="flow__edge flow__edge--' + esc(row.kind) +
        '" data-kind="' + esc(row.kind) + '" data-tool="' + esc(row.tool) + '" d="' + row.geo.d +
        '" marker-end="url(#flow-arrow-' + esc(row.kind) + ')"></path>');
    });
    graphEdges.forEach((row) => {
      flowLines.push(flowPad + '          <path class="flow__pulse flow__pulse--' + esc(row.kind) +
        '" data-kind="' + esc(row.kind) + '" data-tool="' + esc(row.tool) + '" d="' + row.geo.d +
        '" style="--dur:' + row.dur + 's;--delay:-' + row.delay + 's"></path>');
    });
    flowLines.push(flowPad + "        </svg>");
    graphNodes.forEach((n) => {
      flowLines.push(flowPad + '        <div class="flow-node flow-node--' + esc(n.kind || "data") +
        '" style="left:' + n.x + "px;top:" + n.y + "px;width:" + n.w + "px;height:" + n.h + 'px">');
      flowLines.push(flowPad + '          <span class="flow-node__meta">' + esc(n.meta || "") + "</span>");
      flowLines.push(flowPad + '          <span class="flow-node__label">' + esc(n.label || "") + "</span>");
      if (n.sub) flowLines.push(flowPad + '          <span class="flow-node__sub">' + esc(n.sub) + "</span>");
      if (n.badge) flowLines.push(flowPad + '          <span class="flow-node__badge" title="环节内部自检自修，必要时人工修正，不占用 PenFix 质检门">' + esc(n.badge) + "</span>");
      flowLines.push(flowPad + "        </div>");
    });
    graphEdges.forEach((row) => {
      const tip = row.label + (row.cn ? " · " + row.cn : "");
      flowLines.push(flowPad + '        <button class="flow-tool flow-tool--' + esc(row.kind) +
        '" type="button" data-stage="' + esc(row.tool) + '" data-tool="' + esc(row.tool) +
        '" aria-expanded="false" aria-controls="flow-panel-' + esc(row.tool) +
        '" aria-label="' + esc(tip + "，点击查看环节详情") +
        '" title="' + esc(tip + "，点击查看环节详情") +
        '" style="left:' + (+row.geo.lx.toFixed(1)) + "px;top:" + (+row.geo.ly.toFixed(1)) +
        "px;--tool-dot:" + row.color + '"><span class="flow-tool__dot" aria-hidden="true"></span>' +
        esc(row.label) + "</button>");
    });
    flowLines.push(flowPad + "      </div>");
    flowLines.push(flowPad + "    </div>");
    flowLines.push(flowPad + '    <p class="flow__scrollhint">← 横向滑动查看完整数据流 →</p>');
    flowLines.push(flowPad + '    <div class="flow__dock" data-open="false">');
    flowLines.push(flowPad + '      <p class="flow__hint"><span class="flow__hintdot" aria-hidden="true"></span>点选连线上的工具，展开该环节的做法、故事与入口。</p>');
    flowLines.push(flowPad + '      <div class="flow__panels">');
    stages.forEach((s, i) => {
      const site = sites.find((x) => x.id === s.id) || {};
      const st = site.status || s.status || "planned";
      const visit = s.url && site.deployed !== false
        ? '<a class="flow__visit" href="' + esc(s.url) + '" target="_blank" rel="noopener">进入 ' +
          esc(s.name) + ' <span aria-hidden="true">↗</span></a>'
        : "";
      flowLines.push(flowPad + '        <article class="flow__panel" id="flow-panel-' + esc(s.id) + '" aria-hidden="true">');
      flowLines.push(flowPad + '          <div class="flow__panel-head"><span class="flow__num">' +
        String(i + 1).padStart(2, "0") + "</span>" +
        '<span class="flow__panel-name">' + esc(s.name) + "</span>" +
        '<span class="flow__cn">' + esc(s.cn || "") + "</span>" +
        '<span class="status-tag status-tag--' + st + '">' + (STATUS_LABEL[st] || "") + "</span>" +
        visit + "</div>");
      flowLines.push(flowPad + '          <p class="flow__tagline">' + esc(s.tagline || "") + "</p>");
      flowLines.push(flowPad + '          <p class="flow__story">' + esc(s.story || "") + "</p>");
      flowLines.push(flowPad + "        </article>");
    });
    flowLines.push(flowPad + "      </div>");
    flowLines.push(flowPad + "    </div>");
    flowLines.push(flowPad + "  </div>");
    flowLines.push(flowPad + "</div>");
    if (story.note) flowLines.push(flowPad + '<p class="story__note">' + esc(story.note) + "</p>");
  }
  writeBlock("<!-- STORY-STEPS:START", "<!-- STORY-STEPS:END -->", flowPad, flowLines);
})();

// 内嵌数据：file:// 直接打开时的回退
(function () {
  const marker = "<script type=\"application/json\" id=\"sites-embed\">";
  const a = html.indexOf(marker);
  if (a === -1) throw new Error("缺少内嵌数据区块");
  const open = a + marker.length;
  const close = html.indexOf("</script>", open);
  const body = read("sites.json").replace(/\r\n?/g, "\n").trim();
  html = html.slice(0, open) + eol + body.replace(/\n/g, eol) + eol + html.slice(close);
})();

write("index.html", html);

// robots.txt / sitemap.xml：sitemap 只收录同域与子域，外链域名不能出现在本站 sitemap 里
write("robots.txt", [
  "User-agent: *",
  "Allow: /",
  "",
  "Sitemap: https://" + host + "/sitemap.xml",
  ""
].join("\n"));

// 只收录已部署的同域/子域地址：未部署的站点进 sitemap 会变成软 404
const sameOrigin = sites.filter((s) => {
  if (s.deployed === false) return false;
  try { return new URL(s.url).host.split(".").slice(-2).join(".") === domain; } catch (e) { return false; }
});
write("sitemap.xml", [
  "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
  "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">",
  "  <url>",
  "    <loc>" + esc(url) + "</loc>",
  "    <changefreq>weekly</changefreq>",
  "    <priority>1.0</priority>",
  "  </url>",
  "  <url>",
  "    <loc>https://" + host + "/architecture.html</loc>",
  "    <changefreq>monthly</changefreq>",
  "    <priority>0.7</priority>",
  "  </url>",
  sameOrigin.map((s) => [
    "  <url>",
    "    <loc>" + esc(s.url) + "/</loc>",
    "    <changefreq>monthly</changefreq>",
    "    <priority>0.8</priority>",
    "  </url>"
  ].join("\n")).join("\n"),
  "</urlset>",
  ""
].filter((x) => x !== "").join("\n"));

// 自检：内嵌数据必须与 sites.json 完全等价
const embedded = JSON.parse(html.match(/<script type="application\/json" id="sites-embed">[\r\n]*([\s\S]*?)[\r\n]*<\/script>/)[1]);
if (JSON.stringify(embedded) !== JSON.stringify(cfg)) throw new Error("内嵌数据与 sites.json 不一致");

console.log("head meta：", head.length - 1, "行 + 1 段 JSON-LD（", graph["@graph"].length, "个实体，", availableSites.length, "个服务条目 ）");
console.log("meta keywords：", keywords.length, "个候选，写入", Math.min(keywords.length, KW_LIMIT), "个");
console.log("页脚七星入口：", stars.length, "条");
console.log("sitemap.xml：", sameOrigin.length + 2, "条同域 URL；跳过未部署与非同域", sites.length - sameOrigin.length, "条");
console.log("内嵌数据与 sites.json 一致：true");
