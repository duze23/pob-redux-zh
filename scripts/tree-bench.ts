/**
 * Frame times of the passive tree while dragging and zooming, driven over the
 * webview's remote debugging port.
 *
 * Start the app with a debug port, and its own WebView2 profile so an
 * installed copy can stay open:
 *
 *   WEBVIEW2_USER_DATA_FOLDER=<scratch dir> \
 *   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333" bun run tauri dev
 *
 * Add `--disable-gpu` to those arguments for software rendering, the closest
 * Windows gets to a Linux WebKitGTK canvas. Then:
 *
 *   bun scripts/tree-bench.ts <build.xml> [cpu throttle rates, default 1,4]
 *
 * Use a build on the current tree version; an older one draws without art.
 * Prints, per scenario, frame intervals (p50/p95/max, frames over 16/33/50 ms)
 * and the JS time spent in animation frame callbacks. `--port` picks another
 * debug port.
 */
const args = process.argv.slice(2);
const portAt = args.indexOf("--port");
const port = portAt >= 0 ? args.splice(portAt, 2)[1] : "9333";
const [buildPath, rates = "1,4"] = args;
if (!buildPath) {
  console.error("usage: bun scripts/tree-bench.ts <build.xml> [rates] [--port 9333]");
  process.exit(1);
}

const pages = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
const page = pages.find((p) => p.type === "page" && !p.url.startsWith("devtools"));
if (!page) throw new Error(`no page on port ${port}`);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map<number, (v: any) => void>();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data as string);
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)!(msg);
};
const send = (method: string, params: any = {}) =>
  new Promise<any>((r) => {
    const n = ++id;
    pending.set(n, r);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression: string) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mouse = (type: string, x: number, y: number, extra: any = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", ...extra });
const key = async (k: string) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, text: k });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k });
};

// The build store module has to be the instance Vite served, or loading reaches the engine but not the UI.
await evaluate(`(async () => {
  const urls = performance.getEntriesByType("resource").map((e) => e.name).filter((n) => n.includes("/src/lib/state/build.svelte.ts"));
  const mod = await import(urls[urls.length - 1] ?? "/src/lib/state/build.svelte.ts");
  await mod.build.loadFile(${JSON.stringify(buildPath)});
  [...document.querySelectorAll("[role=tab]")].find((t) => t.textContent.trim().toLowerCase() === "tree").click();
  await new Promise((r) => setTimeout(r, 3000));
})()`);
const rect = await evaluate(`(() => { const r = document.querySelector(".tree > canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const cx = Math.round(rect.x + rect.w / 2);
const cy = Math.round(rect.y + rect.h / 2);

const PROBE = `(() => {
  const raw = window.__rawRaf ?? (window.__rawRaf = window.requestAnimationFrame.bind(window));
  window.__tb = { ts: [], cb: [], running: true };
  if (!window.__tbWrapped) {
    window.__tbWrapped = true;
    window.requestAnimationFrame = (fn) => raw((t) => { const s = performance.now(); fn(t); if (window.__tb?.running) window.__tb.cb.push(performance.now() - s); });
  }
  const loop = (t) => { if (!window.__tb.running) return; window.__tb.ts.push(t); raw(loop); };
  raw(loop);
})()`;
const COLLECT = `(() => { const tb = window.__tb; tb.running = false; const iv = []; for (let i = 1; i < tb.ts.length; i++) iv.push(tb.ts[i] - tb.ts[i - 1]); return { iv, cb: tb.cb }; })()`;

function stats(iv: number[], cb: number[]) {
  const s = iv.slice().sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    frames: iv.length,
    p50: r1(q(0.5)),
    p95: r1(q(0.95)),
    max: r1(s[s.length - 1] ?? 0),
    worst5: s.slice(-5).reverse().map(Math.round),
    over16: iv.filter((v) => v > 16.8).length,
    over33: iv.filter((v) => v > 33.4).length,
    over50: iv.filter((v) => v > 50).length,
    jsMax: r1(Math.max(0, ...cb)),
    jsSum: Math.round(cb.reduce((a, b) => a + b, 0)),
  };
}

async function pan() {
  await evaluate(PROBE);
  let x = cx + 600;
  let y = cy - 250;
  await mouse("mousePressed", x, y, { buttons: 1, clickCount: 1 });
  const steps: [number, number][] = [
    ...Array<[number, number]>(120).fill([-10, 0]),
    ...Array<[number, number]>(50).fill([0, 10]),
    ...Array<[number, number]>(120).fill([10, 0]),
    ...Array<[number, number]>(50).fill([0, -10]),
  ];
  for (const [dx, dy] of steps) {
    x += dx;
    y += dy;
    await mouse("mouseMoved", x, y, { buttons: 1 });
    await sleep(16);
  }
  await mouse("mouseReleased", x, y, { buttons: 0, clickCount: 1 });
  await sleep(400);
  const r = await evaluate(COLLECT);
  return stats(r.iv, r.cb);
}

async function zoom() {
  await evaluate(PROBE);
  const wheel = async (d: number) => {
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: cx, y: cy, deltaX: 0, deltaY: d });
    await sleep(30);
  };
  for (let i = 0; i < 12; i++) await wheel(-120);
  for (let i = 0; i < 30; i++) await wheel(120);
  for (let i = 0; i < 18; i++) await wheel(-120);
  await sleep(500);
  const r = await evaluate(COLLECT);
  return stats(r.iv, r.cb);
}

for (const rate of rates.split(",").map(Number)) {
  await send("Emulation.setCPUThrottlingRate", { rate });
  await key("h");
  await sleep(800);
  await mouse("mouseMoved", cx, cy);
  await sleep(1500);
  console.log(`pan  x${rate}`, JSON.stringify(await pan()));
  await key("h");
  await sleep(1500);
  console.log(`zoom x${rate}`, JSON.stringify(await zoom()));
}
await send("Emulation.setCPUThrottlingRate", { rate: 1 });
ws.close();
