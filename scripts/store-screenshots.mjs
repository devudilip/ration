// Maintainer tool: renders the popup with sample data and produces
//  - docs/store/screenshots/*.png  (1280x800, Chrome Web Store format)
//  - site/assets/popup-{light,dark}.png  (bare popup, for the landing page)
//
// Not part of CI. Requires a build (npm run build) and Playwright with a
// Chromium; point PLAYWRIGHT_MODULE at a playwright install if it isn't
// resolvable, and CHROMIUM_PATH at a browser binary if needed.
//   npm run build && node scripts/store-screenshots.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const storeDir = join(root, 'docs/store/screenshots');
const siteDir = join(root, 'site/assets');

const now = Date.now();
const seed = {
  'v1:settings': { providers: { claude: { enabled: true }, codex: { enabled: true } } },
  'v1:snapshot:claude': {
    providerId: 'claude',
    displayName: 'Claude',
    status: 'ok',
    schemaVariant: 'org_usage_limits',
    adapterVersion: 2,
    fetchedAt: new Date(now - 40_000).toISOString(),
    lanes: [
      { id: 'session', label: 'Session (5h)', kind: 'percent', used: 14, limit: 100, resetsAt: new Date(now + 68 * 60_000).toISOString(), headroomPct: 86 },
      { id: 'weekly_all', label: 'Weekly (all models)', kind: 'percent', used: 5, limit: 100, resetsAt: new Date(now + (4 * 24 + 18) * 3_600_000).toISOString(), headroomPct: 95 },
      { id: 'weekly_scoped:Fable', label: 'Weekly (Fable)', kind: 'percent', used: 7, limit: 100, resetsAt: new Date(now + (4 * 24 + 18) * 3_600_000).toISOString(), headroomPct: 93 },
    ],
  },
  'v1:snapshot:codex': {
    providerId: 'codex',
    displayName: 'Codex',
    status: 'ok',
    schemaVariant: 'wham_rate_limit',
    adapterVersion: 2,
    fetchedAt: new Date(now - 55_000).toISOString(),
    lanes: [
      { id: 'session', label: 'Session (5h)', kind: 'percent', used: 24, limit: 100, resetsAt: new Date(now + (3 * 60 + 38) * 60_000).toISOString(), headroomPct: 76 },
      { id: 'weekly', label: 'Weekly', kind: 'percent', used: 4, limit: 100, resetsAt: new Date(now + (6 * 24 + 17) * 3_600_000).toISOString(), headroomPct: 96 },
      { id: 'extra:gpt-reserve', label: 'gpt-reserve', kind: 'percent', used: 0, limit: 100, resetsAt: new Date(now + 7 * 24 * 3_600_000).toISOString(), headroomPct: 100 },
    ],
  },
};

const stub = `
  const store = ${JSON.stringify(seed)};
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => keys === null ? store : Object.fromEntries((typeof keys === 'string' ? [keys] : keys).filter(k => k in store).map(k => [k, store[k]])),
      },
      onChanged: { addListener: () => {} },
    },
    runtime: { sendMessage: async () => ({ ok: true }), getManifest: () => ({ version: '0.1.1' }) },
    permissions: { request: async () => true, remove: async () => true },
  };
`;

const wrapper = (dark, popupHeight) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; width: 1280px; height: 800px; display: flex; align-items: center;
         font-family: system-ui, sans-serif; overflow: hidden;
         background: ${dark
           ? 'linear-gradient(135deg, #0b1220 0%, #1f2937 60%, #263548 100%)'
           : 'linear-gradient(135deg, #e8eef7 0%, #f6f8fb 55%, #dde7f3 100%)'}; }
  .copy { flex: 1; padding: 0 40px 0 80px; color: ${dark ? '#f3f4f6' : '#1f2937'}; }
  .copy h1 { font-size: 44px; line-height: 1.15; margin: 0 0 18px; letter-spacing: -0.02em; }
  .copy p { font-size: 20px; line-height: 1.5; margin: 0; color: ${dark ? '#9ca3af' : '#4b5563'}; }
  .frame { margin-right: 110px; border-radius: 14px; overflow: hidden;
           box-shadow: 0 24px 70px rgba(0,0,0,${dark ? '0.55' : '0.22'});
           border: 1px solid ${dark ? '#374151' : '#d7dee8'}; }
  iframe { display: block; width: 356px; height: ${popupHeight}px; border: 0;
           color-scheme: ${dark ? 'dark' : 'light'}; }
</style></head><body>
  <div class="copy">
    <h1>One glance at every AI quota</h1>
    <p>Claude, Codex, and more — sorted by which subscription has the most headroom right now. No accounts. No telemetry. Everything stays in your browser.</p>
  </div>
  <div class="frame"><iframe src="/popup.html"></iframe></div>
</body></html>`;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const m = req.url.match(/^\/wrapper-(dark|light)-(\d+)/);
    if (m) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(wrapper(m[1] === 'dark', Number(m[2])));
    }
    const body = await readFile(join(dist, req.url === '/' ? 'popup.html' : req.url));
    res.writeHead(200, { 'Content-Type': MIME[extname(req.url)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => server.listen(8123, ok));

await mkdir(storeDir, { recursive: true });
await mkdir(siteDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox'],
});

// Measure the seeded popup's natural height so frames fit the content exactly.
const probe = await browser.newPage({ viewport: { width: 356, height: 800 } });
await probe.addInitScript(stub);
await probe.goto('http://localhost:8123/popup.html');
await probe.waitForTimeout(400);
const popupHeight = await probe.evaluate('document.body.scrollHeight');
await probe.close();
console.log('measured popup height:', popupHeight);

// 1280x800 store shots
for (const dark of [false, true]) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    colorScheme: dark ? 'dark' : 'light',
    deviceScaleFactor: 1,
  });
  await page.addInitScript(stub);
  await page.goto(`http://localhost:8123/wrapper-${dark ? 'dark' : 'light'}-${popupHeight}`);
  await page.waitForTimeout(400);
  const file = join(storeDir, `store-${dark ? 'dark' : 'light'}.png`);
  await page.screenshot({ path: file });
  console.log('wrote', file);
  await page.close();
}

// bare popup shots for the landing page
for (const dark of [false, true]) {
  const page = await browser.newPage({
    viewport: { width: 356, height: popupHeight },
    colorScheme: dark ? 'dark' : 'light',
    deviceScaleFactor: 2,
  });
  await page.addInitScript(stub);
  await page.goto('http://localhost:8123/popup.html');
  await page.waitForTimeout(400);
  const file = join(siteDir, `popup-${dark ? 'dark' : 'light'}.png`);
  await page.screenshot({ path: file });
  console.log('wrote', file);
  await page.close();
}

await browser.close();
server.close();
