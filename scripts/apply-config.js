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
const ACCENTS = { studio: "#0a7494", oss: "#6f5bb8", tools: "#087a43", demo: "#4d6484", content: "#96650a" };
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
      (site.repo ? '<span class="card__repo">源码仓库</span>' : "") +
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
      '<p class="showcase__desc">' + esc(site.description || "") + "</p></div>" + media + "</div>" +
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
const hubStar = stars.filter((s) => s.isHub)[0] || stars[0] || {};
if (!hubStar.id) throw new Error("constellation 缺少 isHub 主星");
const starCount = (s) => (s.isHub ? sites.length : (s.projects || []).length);

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
const trackedStars = stars.filter((s) => s.track && (s.track.stages || []).length);

// 页脚按七星阵列收敛：每颗主星只留一条代表入口，完整清单仍在阵列面板与页面内
(function () {
  const START = "<!-- FOOTNAV:START", END = "<!-- FOOTNAV:END -->";
  const a = html.indexOf(START), b = html.indexOf(END);
  if (a === -1 || b === -1) throw new Error("缺少 FOOTNAV 标记");

  function footStarOf(star) {
    const accent = ' style="--accent:' + esc(star.accent || "#4f6ae0") + '"';
    if (star.isHub) {
      return '<a class="footstar" href="#constellation"' + accent + ">" +
        '<span class="footstar__name">' + esc(star.name) + "</span>" +
        '<span class="footstar__line">' + esc(star.short || "总枢纽") + "</span>" +
        '<span class="footstar__site">回到北斗阵列</span></a>';
    }
    const site = (star.projects || []).map((id) => siteById[id])
      .filter((item) => item && item.deployed !== false)[0];
    if (!site) return "";
    return '<a class="footstar" href="' + esc(site.url) + '" target="_blank" rel="noopener"' + accent + ">" +
      '<span class="footstar__name">' + esc(star.name) + "</span>" +
      '<span class="footstar__line">' + esc(star.short || "") + "</span>" +
      '<span class="footstar__site">' + esc(site.name) + "</span></a>";
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
  return '<button class="cstar' + (s.isHub ? " cstar--hub" : "") + (hasTrack ? " cstar--track" : "") +
    " cstar--label-" + esc(s.label || "bottom") + '" type="button" data-star="' + esc(s.id) +
    '" aria-pressed="' + (s.isHub ? "true" : "false") + '"' +
    ' aria-label="' + esc(s.title + "，" + count + " 项服务，" + (hasTrack ? "点击展开七星轨" : "点击筛选")) + '"' +
    ' style="--accent:' + esc(s.accent || "#4f6ae0") + ";--x:" + s.x + "%;--y:" + s.y + '%">' +
    '<span class="cstar__point" aria-hidden="true"><span class="cstar__halo"></span><span class="cstar__dot"></span></span>' +
    '<span class="cstar__label"><span class="cstar__name">' + esc(s.name) + "</span>" +
      '<span class="cstar__short">' + esc(s.short || "") + "</span>" +
      (hasTrack ? '<span class="cstar__track">轨</span>' : "") +
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

function projectLinkOf(id) {
  const site = siteById[id];
  const planned = site.deployed === false;
  const tag = planned ? "span" : "a";
  const attrs = planned
    ? ' aria-disabled="true"'
    : ' href="' + esc(site.url) + '" target="_blank" rel="noopener"';
  return "<" + tag + ' class="clink' + (planned ? " clink--planned" : "") +
    '" data-site="' + esc(id) + '"' + attrs + ">" +
    '<span class="clink__name">' + esc(site.name) + "</span>" +
    '<span class="clink__host">' + esc(planned ? "地址待部署" : hostname(site.url)) + "</span>" +
    "</" + tag + ">";
}

function starGroupOf(s) {
  const links = (s.projects || []).map(projectLinkOf);
  return '<div class="cgroup" data-group="' + esc(s.id) + '" style="--accent:' +
    esc(s.accent || "#4f6ae0") + '">' +
    '<button class="cgroup__head" type="button" data-star="' + esc(s.id) +
      '" aria-controls="cgroup-links-' + esc(s.id) +
      '" aria-label="' + esc("筛选 " + s.title) + '">' +
      '<span class="cgroup__dot" aria-hidden="true"></span>' +
      '<span class="cgroup__name">' + esc(s.title) + "</span>" +
      '<span class="cgroup__count">' + links.length + "</span>" +
      '<span class="cgroup__chev" aria-hidden="true"></span>' +
    "</button>" +
    '<div class="cgroup__links" id="cgroup-links-' + esc(s.id) + '">' + links.join("") + "</div>" +
  "</div>";
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

function trackNodeOf(star, stage) {
  const site = siteById[stage.site];
  const label = stage.label || site.cn || site.name;
  return '<button class="ctrack" type="button" data-stage="' + esc(stage.id) +
    '" data-site="' + esc(site.id) + '" data-star="' + esc(star.id) + '" aria-pressed="false"' +
    ' aria-label="' + esc("筛选 " + site.name + "，定位到卡片") + '"' +
    ' style="--accent:' + esc(stage.accent || star.accent || "#4f6ae0") + ";--x:" + stage.x + "%;--y:" + stage.y + '%">' +
    '<span class="ctrack__node" aria-hidden="true"><span class="ctrack__char">' + esc(stage.char) + "</span></span>" +
    '<span class="ctrack__label"><span class="ctrack__name">' + esc(stage.char + " · " + label) + "</span>" +
      '<span class="ctrack__site">' + esc(site.name) + "</span></span>" +
  "</button>";
}

function trackBoardOf(star) {
  const track = star.track || {};
  const stages = track.stages || [];
  const rail = railPathOf(stages);
  const out = [];
  out.push('<div class="constellation__board constellation__board--track" data-constellation-track="' +
    esc(star.id) + '" role="group" aria-label="' +
    esc((track.title || star.title) + "：点环节筛选并定位工具") + '" hidden>');
  out.push('  <button class="ctrack__back" type="button" data-constellation-back>← 北斗阵列</button>');
  out.push('  <span class="ctrack__level" aria-hidden="true">' + esc(track.eyebrow || star.title) + "</span>");
  out.push('  <svg class="constellation__edges constellation__edges--track" viewBox="0 0 1000 340" preserveAspectRatio="none" aria-hidden="true" focusable="false">');
  out.push('    <path class="ctrack-rail" d="' + rail + '"></path>');
  out.push('    <path class="ctrack-flow" d="' + rail + '"></path>');
  out.push("  </svg>");
  stages.forEach((stage) => out.push("  " + trackNodeOf(star, stage)));
  out.push('  <span class="constellation__axis" aria-hidden="true">' +
    esc(star.name + " · " + (track.charLine || "七 星 轨")) + "</span>");
  out.push('  <span class="constellation__meta" aria-hidden="true">' + stages.length + " 环节 · 点按定位</span>");
  out.push("</div>");
  return out;
}

function trackPanelOf(star) {
  const track = star.track || {};
  const stages = track.stages || [];
  const out = [];
  out.push('<div class="constellation__track" data-constellation-track-panel="' + esc(star.id) + '" hidden>');
  stages.forEach((stage) => {
    const site = siteById[stage.site];
    out.push('  <button class="ctrack-chip" type="button" data-stage="' + esc(stage.id) +
      '" data-star="' + esc(star.id) + '" aria-pressed="false" style="--accent:' +
      esc(stage.accent || star.accent || "#4f6ae0") + '">' +
      '<span class="ctrack-chip__char" aria-hidden="true">' + esc(stage.char) + "</span>" +
      '<span class="ctrack-chip__name">' + esc(stage.char + " · " + (stage.label || site.cn || site.name)) + "</span>" +
      '<span class="ctrack-chip__site">' + esc(site.name) + "</span>" +
    "</button>");
  });
  out.push("</div>");
  return out;
}

// 面板左栏配图：总枢纽用七星定位图，七星轨用迷你轨道，填补标题下方的留白
function artStarMap() {
  const pts = {};
  stars.forEach((s) => {
    pts[s.id] = {
      x: +(34 + ((s.x - 10) / 74) * 252).toFixed(1),
      y: +(76 + ((s.y - 27) / 36) * 180).toFixed(1)
    };
  });
  const out = ['<svg class="c-art" viewBox="0 0 320 340" role="presentation" focusable="false">'];
  [
    [18, 118], [56, 44], [128, 118], [178, 58], [246, 38], [298, 92],
    [286, 196], [236, 252], [150, 296], [62, 306], [32, 212], [132, 168],
    [212, 176], [302, 268], [96, 342]
  ].forEach((p, i) => {
    out.push('<circle class="c-art__speck" cx="' + p[0] + '" cy="' + p[1] + '" r="' + (i % 3 ? 0.8 : 1.2) + '"></circle>');
  });
  const hub = pts[hubStar.id];
  if (hub) {
    [26, 46, 66].forEach((r, i) => {
      out.push('<circle cx="' + hub.x + '" cy="' + hub.y + '" r="' + r + '" fill="none" stroke="rgba(79,106,224,' +
        (0.2 - i * 0.05).toFixed(2) + ')" stroke-width="0.8" stroke-dasharray="3 6"></circle>');
    });
  }
  (constellation.links || []).forEach((pair) => {
    const a = pts[pair[0]], b = pts[pair[1]];
    if (!a || !b) return;
    out.push('<line class="c-art__link" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"></line>');
  });
  stars.forEach((s) => {
    const pt = pts[s.id];
    const r = s.isHub ? 5.5 : 4.2;
    out.push('<g data-art-star="' + esc(s.id) + '"' + (s.isHub ? ' class="is-hub"' : "") + ">");
    out.push('<circle class="c-art__ring" cx="' + pt.x + '" cy="' + pt.y + '" r="' + (r + 7) + '" stroke="' + esc(s.accent) + '"></circle>');
    if (s.isHub) out.push('<circle class="c-art__halo" cx="' + pt.x + '" cy="' + pt.y + '" r="13" fill="' + esc(s.accent) + '"></circle>');
    out.push('<circle class="c-art__dot" cx="' + pt.x + '" cy="' + pt.y + '" r="' + r + '" fill="' + esc(s.accent) + '"></circle>');
    out.push('<text class="c-art__name" x="' + pt.x + '" y="' + (pt.y + 16) + '" text-anchor="middle">' + esc(s.name) + "</text>");
    out.push('<text class="c-art__count" x="' + pt.x + '" y="' + (pt.y + 27) + '" text-anchor="middle">' + starCount(s) + " 项</text>");
    out.push("</g>");
  });
  out.push('<text class="c-art__cap" x="160" y="330" text-anchor="middle">北斗 · 七主星 · ' + sites.length + " 项服务</text>");
  out.push("</svg>");
  return out.join("");
}

function miniRailPath(points) {
  if (points.length < 2) return "";
  let d = "M" + points[0].x + " " + points[0].y;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    d += "C" + (p1.x + (p2.x - p0.x) / 6).toFixed(1) + " " + (p1.y + (p2.y - p0.y) / 6).toFixed(1) +
      " " + (p2.x - (p3.x - p1.x) / 6).toFixed(1) + " " + (p2.y - (p3.y - p1.y) / 6).toFixed(1) +
      " " + p2.x + " " + p2.y;
  }
  return d;
}

function artTrackOf(star) {
  const track = star.track || {};
  const stages = track.stages || [];
  const pts = stages.map((s) => ({
    x: +(26 + (s.x / 100) * 268).toFixed(1),
    y: +(30 + ((s.y - 30) / 34) * 32).toFixed(1)
  }));
  const out = ['<svg class="c-art" viewBox="0 0 320 96" role="presentation" focusable="false">'];
  out.push('<path class="c-art__rail" d="' + miniRailPath(pts) + '"></path>');
  stages.forEach((s, i) => {
    const pt = pts[i];
    const accent = esc(s.accent || star.accent || "#4f6ae0");
    out.push('<circle class="c-art__node" cx="' + pt.x + '" cy="' + pt.y + '" r="10" stroke="' + accent + '"></circle>');
    out.push('<text class="c-art__char" x="' + pt.x + '" y="' + (pt.y + 3.4).toFixed(1) +
      '" text-anchor="middle" fill="' + accent + '">' + esc(s.char) + "</text>");
  });
  out.push('<text class="c-art__cap" x="160" y="91" text-anchor="middle">' +
    esc(track.charLine || "启 · 绘 · 铸 · 韵 · 织 · 鉴 · 藏") + "</text>");
  out.push("</svg>");
  return out.join("");
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
  if (constellation.hint) {
    lines.push(p + '  <p class="constellation__hint"><span class="constellation__hintdot" aria-hidden="true"></span>' +
      esc(constellation.hint) + "</p>");
  }
  lines.push(p + "</div>");

  lines.push(p + '<div class="constellation__flip" data-constellation-flip data-mode="macro">');
  lines.push(p + '  <div class="constellation__board" data-constellation-board role="group" aria-label="北斗阵列：点主星筛选服务线，点辅星直达项目">');
  lines.push(p + '    <svg class="constellation__edges" viewBox="0 0 1000 340" preserveAspectRatio="none" aria-hidden="true" focusable="false">');
  (constellation.links || []).forEach((pair) => lines.push(p + "      " + starLinkOf(pair)));
  lines.push(p + "    </svg>");
  lines.push(p + '    <div class="constellation__aux" data-constellation-aux></div>');
  stars.forEach((s) => lines.push(p + "    " + starButtonOf(s)));
  lines.push(p + '    <span class="constellation__axis" aria-hidden="true">北斗 · BIG DIPPER</span>');
  lines.push(p + '    <span class="constellation__meta" aria-hidden="true">' + sites.length + " 服务 · " +
    stars.length + " 主星 · 点按筛选</span>");
  lines.push(p + "  </div>");
  trackedStars.forEach((star) => {
    trackBoardOf(star).forEach((line) => lines.push(p + "  " + line));
  });
  lines.push(p + "</div>");

  lines.push(p + '<div class="constellation__panel">');
  lines.push(p + '  <div class="constellation__current">');
  lines.push(p + '    <span class="constellation__current-eyebrow" data-constellation-eyebrow>CURRENT · 当前星位</span>');
  lines.push(p + '    <div class="constellation__current-row">');
  lines.push(p + '      <h3 class="constellation__current-title" data-constellation-title>' +
    esc(hubStar.title || "") + "</h3>");
  lines.push(p + '      <span class="constellation__current-count" data-constellation-count>' +
    sites.length + " 项服务</span>");
  lines.push(p + "    </div>");
  lines.push(p + '    <p class="constellation__current-desc" data-constellation-desc>' +
    esc(hubStar.desc || "") + "</p>");
  lines.push(p + '    <button class="constellation__reset" type="button" data-constellation-reset hidden>← 回到总枢纽</button>');
  lines.push(p + '    <div class="constellation__art" data-constellation-art="macro" aria-hidden="true">');
  lines.push(p + '      <div class="constellation__art-frame">' + artStarMap() + "</div>");
  lines.push(p + "    </div>");
  trackedStars.forEach((star) => {
    lines.push(p + '    <div class="constellation__art" data-constellation-track-art="' + esc(star.id) + '" aria-hidden="true" hidden>');
    lines.push(p + '      <div class="constellation__art-frame">' + artTrackOf(star) + "</div>");
    lines.push(p + "    </div>");
  });
  lines.push(p + "  </div>");
  lines.push(p + '  <div class="constellation__body">');
  lines.push(p + '    <div class="constellation__groups" data-constellation-groups>');
  stars.filter((s) => !s.isHub).forEach((s) => lines.push(p + "      " + starGroupOf(s)));
  lines.push(p + "    </div>");
  trackedStars.forEach((star) => {
    trackPanelOf(star).forEach((line) => lines.push(p + "    " + line));
  });
  lines.push(p + "  </div>");
  lines.push(p + "</div>");

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
