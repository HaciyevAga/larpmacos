// tools/shot-firefox.mjs — tools/shot.mjs for headless Firefox (WebDriver BiDi), with Firefox's fake camera and mic.
// usage: [URL=http://localhost:8765/] node tools/shot-firefox.mjs <out.png> [js-to-eval] [WxH=1440x900]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [out, js = '', size = '1440x900'] = process.argv.slice(2);
const [w, h] = size.split('x').map(Number);
const profile = mkdtempSync(join(tmpdir(), 'shot-ff-'));
writeFileSync(join(profile, 'user.js'), ['"media.navigator.streams.fake", true', '"media.navigator.permission.disabled", true', '"media.autoplay.default", 0']
  .map((p) => `user_pref(${p});`).join('\n'));
const ff = spawn('/Applications/Firefox.app/Contents/MacOS/firefox', ['--headless', '--remote-debugging-port=9334', '--profile', profile, `--width=${w}`, `--height=${h}`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 100 && !ws; i++) {
  await sleep(200);
  try { ws = new WebSocket('ws://127.0.0.1:9334/session'); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); } catch { ws = null; }
}
let id = 0; const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  pending.get(d.id)?.(d);
  if (d.method === 'log.entryAdded' && d.params.level === 'error') console.error('page:', d.params.text);
};
const bidi = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
await bidi('session.new', { capabilities: {} });
await bidi('session.subscribe', { events: ['log.entryAdded'] });
const context = (await bidi('browsingContext.getTree')).result.contexts[0].context;
await bidi('browsingContext.setViewport', { context, viewport: { width: w, height: h }, devicePixelRatio: 2 });
await bidi('browsingContext.navigate', { context, url: process.env.URL ?? 'http://localhost:8765/', wait: 'complete' });
await sleep(2500);
if (js) {
  const r = await bidi('script.evaluate', { expression: `(async()=>{${js}})()`, target: { context }, awaitPromise: true, userActivation: true });
  if (r.result?.type === 'exception' || r.error) { console.error(r.result?.exceptionDetails?.text ?? r.message ?? JSON.stringify(r)); process.exitCode = 1; }
  await sleep(1200);
}
const shot = await bidi('browsingContext.captureScreenshot', { context });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
ff.kill();
ws.close();
console.log('wrote', out);
