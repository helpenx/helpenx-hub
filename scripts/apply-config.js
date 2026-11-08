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
const liveSites = sites.filter((s) => (s.status || "live") === "live");

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const title = seo.title || brand.fullName || "HelpEnx";
const desc = seo.description || brand.tagline || "";
const url = seo.url || "https://" + (brand.site || "helpenx.com") + "/";
const host = new URL(url).host;
const domain = host.split(".").slice(-2).join(".");

// meta keywords：门户词 + 各服务名，再按服务轮流取各自的关键词（避免词表偏向第一个服务），去重后截断
const KW_LIMIT = 24;
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
      "alternateName": brand.name,
      "url": url,
      "description": desc,
      "inLanguage": seo.language || "zh-CN"
    },
    {
      "@type": "Organization",
      "@id": url + "#org",
      "name": brand.name,
      "url": url,
      "sameAs": brand.github ? [brand.github] : []
    },
    {
      "@type": "ItemList",
      "name": (brand.fullName || "HelpEnx") + " 服务清单",
      "numberOfItems": sites.length,
      "itemListElement": liveSites.map((s, i) => entity(s, i + 1))
    }
  ]
};
graph["@graph"][0].publisher = { "@id": url + "#org" };

head.push("<script type=\"application/ld+json\">" + JSON.stringify(graph, null, 2) + "</script>");

let html = read("index.html");
const eol = html.indexOf("\r\n") !== -1 ? "\r\n" : "\n";

// SEO 区块
(function () {
  const START = "<!-- SEO:START", END = "<!-- SEO:END -->";
  const a = html.indexOf(START), b = html.indexOf(END);
  if (a === -1 || b === -1) throw new Error("缺少 SEO 标记");
  const commentEnd = html.indexOf("\n", a);
  html = html.slice(0, commentEnd + 1) + head.join(eol) + eol + html.slice(b);
})();

// 页脚服务链接（静态渲染，爬虫无需执行 JS 也能发现全部子站）
(function () {
  const START = "<!-- FOOTNAV:START", END = "<!-- FOOTNAV:END -->";
  const a = html.indexOf(START), b = html.indexOf(END);
  if (a === -1 || b === -1) throw new Error("缺少 FOOTNAV 标记");
  const links = liveSites.map((s) =>
    '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.name) + "</a>");
  if (brand.github) {
    links.push('<a href="' + esc(brand.github) + '" target="_blank" rel="noopener me">GitHub</a>');
  }
  const commentEnd = html.indexOf("\n", a);
  html = html.slice(0, commentEnd + 1) + "  " + links.join(eol + "  ") + eol + "    " + html.slice(b);
})();

// 预渲染卡片：不执行 JS 的爬虫（百度、搜狗等）与首屏直接拿到正文，JS 加载后由 app.js 重绘
const ACCENTS = { studio: "#0a7494", oss: "#6d4bf0", tools: "#087a43", demo: "#4d6484", content: "#96650a" };
const PLANNED_ACCENT = "#8b98a9";
const STATUS_LABEL = { live: "运行中", wip: "规划中", pause: "已暂停", archived: "已归档" };

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
function cardOf(site) {
  const status = site.status || "live";
  const planned = status !== "live";
  const accent = planned ? PLANNED_ACCENT : (ACCENTS[site.category] || "#0a7494");
  const cls = "card" + (site.span === "full" ? " card--wide" : "") + (planned ? " card--planned" : "");
  const tag = planned ? "div" : "a";
  const open = planned
    ? '<div class="' + cls + '" style="--accent:' + accent + '">'
    : '<a class="' + cls + '" href="' + esc(site.url) + '" target="_blank" rel="noopener" style="--accent:' + accent + '">';
  const badge = planned
    ? '<span class="card__badge">' + esc(STATUS_LABEL[status] || "规划中") + "</span>"
    : '<span class="dot dot--' + status + '" title="' + esc(STATUS_LABEL[status] || "") + '"></span>';
  const idBlock = '<div class="card__id"><span class="card__icon" aria-hidden="true">' +
      iconGlyphOf(site) + "</span>" +
      '<span class="card__idtext"><span class="card__titlerow">' +
        '<span class="card__name">' + esc(site.name) + "</span>" + badge +
      "</span>" +
      '<span class="card__domain">' + esc(hostname(site.url)) + "</span></span></div>";
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
      '<span class="dot dot--' + status + '" title="' + (STATUS_LABEL[status] || "") + '"></span>' +
      '<span class="showcase__domain">' + esc(hostname(site.url)) + "</span></div>" +
    '<a class="btn btn-primary" href="' + esc(site.url) + '" target="_blank" rel="noopener">' +
      esc(site.ctaLabel || "进入") + ' <span class="btn__arrow" aria-hidden="true">→</span></a></div>' +
    '<div class="showcase__main"><div class="showcase__text">' +
      '<span class="showcase__tagline">' + esc(site.tagline || "") + "</span>" +
      '<p class="showcase__desc">' + esc(site.description || "") + "</p></div>" + media + "</div>" +
    '<div class="showcase__bands">' + flowOf(site) + featuresOf(site) + "</div></article>";
}

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

// AIGC Studio 定位引言与六段流水线：分两块生成，中间的 Studio 卡片由 CARDS-HERO 维护
(function () {
  const story = cfg.story || {};
  const stages = story.stages || [];

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

  // 六段流水线：顺序即 sites.json 中 story.stages 的顺序（plot → shot → gen → dub → clip → fix）
  const TAG = { live: "已上线", wip: "规划中" };
  const stepPad = "    ";
  const stepLines = [];
  if (stages.length) {
    stepLines.push(stepPad + '<ol class="story__steps">');
    stages.forEach((s, i) => {
      const st = s.status === "live" ? "live" : "wip";
      // 仅已上线的环节链出：规划中的地址尚未部署，避免对外抛 404
      const name = s.url && st === "live"
        ? '<a class="step__name" href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.name) + "</a>"
        : '<span class="step__name">' + esc(s.name) + "</span>";
      stepLines.push(stepPad + "  <li class=\"step\"><span class=\"step__num\" aria-hidden=\"true\">" +
        String(i + 1).padStart(2, "0") + "</span>" +
        '<div class="step__body"><div class="step__head">' + name +
          '<span class="step__cn">' + esc(s.cn || "") + "</span>" +
          '<span class="step__status step__status--' + st + '">' + (TAG[st] || "") + "</span></div>" +
        '<p class="step__tagline">' + esc(s.tagline || "") + "</p>" +
        '<p class="step__story">' + esc(s.story || "") + "</p></div></li>");
    });
    stepLines.push(stepPad + "</ol>");
    if (story.note) stepLines.push(stepPad + '<p class="story__note">' + esc(story.note) + "</p>");
  }
  writeBlock("<!-- STORY-STEPS:START", "<!-- STORY-STEPS:END -->", stepPad, stepLines);
})();

// 内嵌数据：file:// 直接打开时的回退
(function () {
  const marker = "<script type=\"application/json\" id=\"sites-embed\">";
  const a = html.indexOf(marker);
  if (a === -1) throw new Error("缺少内嵌数据区块");
  const open = a + marker.length;
  const close = html.indexOf("</script>", open);
  const body = read("sites.json").trim();
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

// 只收录已上线（status === live）的同域/子域地址：规划中的站点尚未部署，进 sitemap 会变成软 404
const sameOrigin = sites.filter((s) => {
  if ((s.status || "live") !== "live") return false;
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

console.log("head meta：", head.length - 1, "行 + 1 段 JSON-LD（", graph["@graph"].length, "个实体，", liveSites.length, "个服务条目 ）");
console.log("meta keywords：", keywords.length, "个候选，写入", Math.min(keywords.length, KW_LIMIT), "个");
console.log("页脚静态链接：", liveSites.length + (brand.github ? 1 : 0), "条");
console.log("sitemap.xml：", sameOrigin.length + 1, "条同域 URL；跳过未上线与非同域", sites.length - sameOrigin.length, "条");
console.log("内嵌数据与 sites.json 一致：true");
