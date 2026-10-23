// tools/shot.mjs — screenshot the local site in headless Chrome, optionally running JS first.
// usage: [URL=http://localhost:8765/] [JSON=<file>] node tools/shot.mjs <out.png> [js-to-eval] [WxH=1440x900]
// Chrome runs with its fake camera and microphone (a test pattern, or FAKE_VIDEO=<file.mjpeg|.y4m>), and the JS runs
// as a user gesture. With JSON=<file>, the JS's return value is saved there.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [out, js = '', size = '1440x900'] = process.argv.slice(2);
const [w, h] = size.split('x').map(Number);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'shot-'))}`,
  `--window-size=${w},${h}`, '--hide-scrollbars', '--force-device-scale-factor=2',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required',
  ...(process.env.FAKE_VIDEO ? [`--use-file-for-fake-video-capture=${process.env.FAKE_VIDEO}`] : []), 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try { const t = await (await fetch('http://127.0.0.1:9333/json')).json(); ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl); } catch { await sleep(100); }
}
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  pending.get(d.id)?.(d);
  if (d.method === 'Runtime.exceptionThrown') console.error('page:', d.params.exceptionDetails.exception?.description);
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') console.error('page:', d.params.args.map((a) => a.value ?? a.description).join(' '));
};
const cdp = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
await cdp('Page.navigate', { url: process.env.URL ?? 'http://localhost:8765/' });
await sleep(2500);
if (js) {
  const r = await cdp('Runtime.evaluate', { expression: `(async()=>{${js}})()`, awaitPromise: true, userGesture: true, returnByValue: true });
  if (r.result?.exceptionDetails) { console.error(r.result.exceptionDetails.exception?.description ?? JSON.stringify(r.result.exceptionDetails)); process.exitCode = 1; }
  if (process.env.JSON) writeFileSync(process.env.JSON, JSON.stringify(r.result?.result?.value ?? null));
  await sleep(1200);
}
const { result } = await cdp('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(result.data, 'base64'));
chrome.kill();
console.log('wrote', out);
