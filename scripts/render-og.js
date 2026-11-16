// 把 scripts/share-cover.html 渲染成 1200×630 的社交分享图（assets/share-cover.jpg）
// 用法：node scripts/render-og.js；改完封面文案后重新运行
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const edge = process.env.EDGE || path.join(
  process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)",
  "Microsoft/Edge/Application/msedge.exe"
);
const profile = path.join(root, ".tmp-og-profile");
const source = "file:///" + path.join(root, "scripts/share-cover.html").replace(/\\/g, "/");
const out = path.join(root, "assets/share-cover.jpg");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(edge)) throw new Error("找不到 Edge，可用 EDGE 环境变量指定路径");

const proc = spawn(edge, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars",
  "--force-device-scale-factor=1", "--window-size=1200,900",
  "--remote-debugging-port=0",
  "--user-data-dir=" + profile,
  "about:blank"
], { stdio: "ignore" });

(async () => {
  let devPort = 0;
  const portFile = path.join(profile, "DevToolsActivePort");
  for (let i = 0; i < 60 && !devPort; i++) {
    await sleep(200);
    try { devPort = Number(fs.readFileSync(portFile, "utf8").split("\n")[0]); } catch (e) { /* 端口文件还没生成 */ }
  }
  if (!devPort) throw new Error("Edge 调试端口未就绪");

  let page;
  for (let i = 0; i < 20 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${devPort}/json/list`)).json();
      page = list.find((t) => t.type === "page");
    } catch (e) { /* 浏览器还没起来，继续等 */ }
    if (!page) await sleep(200);
  }
  if (!page) throw new Error("Edge 页面未就绪");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params) => new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: source });
  await sleep(2200);
  const shot = await send("Page.captureScreenshot", {
    format: "jpeg", quality: 90,
    clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 },
    captureBeyondViewport: false
  });
  fs.writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  console.log("已输出", path.relative(root, out), "(1200×630)");

  ws.close();
  proc.kill();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* 句柄未释放时留待下次覆盖 */ }
  process.exit(0);
})().catch((err) => {
  console.error(err.message);
  proc.kill();
  process.exit(1);
});
