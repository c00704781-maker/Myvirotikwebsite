import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const APP_NAME = process.env.APP_NAME || 'ViroTik';
const APP_URL = process.env.APP_URL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'virotik-admin';
const GA_MEASUREMENT_ID = process.env.GA_MEASUREMENT_ID || '';
const BUILD_VERSION = '20260703-8';
const STATS_FILE = process.env.STATS_FILE || '/tmp/virotik-stats.json';

app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

app.get(['/og-image.png', '/og-image.jpg', '/IMG_6949.png'], (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.type('png');
  res.sendFile(path.join(__dirname, 'public', 'IMG_6949.png'));
});

app.get(['/download-tiktok-video', '/download-tiktok-video/', '/mp4-quality', '/mp4-quality/'], (_req, res) => {
  res.redirect(301, '/');
});

app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html') || req.path.endsWith('.js') || req.path.endsWith('.css')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: false }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_PER_MINUTE || 25),
  standardHeaders: true,
  legacyHeaders: false
});

const emptyStats = () => ({
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  totals: { pageViews: 0, visitors: 0, parses: 0, downloads: 0, errors: 0 },
  visitors: {},
  daily: {},
  pages: {},
  referrers: {},
  countries: {},
  devices: {},
  browsers: {},
  formats: {},
  recent: []
});

let statsCache = null;
let saveTimer = null;

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

async function loadStats() {
  if (statsCache) return statsCache;
  try {
    const raw = await fs.readFile(STATS_FILE, 'utf8');
    statsCache = { ...emptyStats(), ...JSON.parse(raw) };
  } catch {
    statsCache = emptyStats();
  }
  return statsCache;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      statsCache.updatedAt = new Date().toISOString();
      await fs.writeFile(STATS_FILE, JSON.stringify(statsCache, null, 2));
    } catch (err) {
      console.error('stats save failed:', err?.message || err);
    }
  }, 250);
}

function inc(obj, key, amount = 1) {
  const safeKey = String(key || 'Unknown').slice(0, 120);
  obj[safeKey] = (obj[safeKey] || 0) + amount;
}

function addRecent(type, payload = {}) {
  statsCache.recent.unshift({ type, at: new Date().toISOString(), ...payload });
  statsCache.recent = statsCache.recent.slice(0, 80);
}

function hashIp(req) {
  const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  return crypto.createHash('sha256').update(String(ip).split(',')[0].trim()).digest('hex').slice(0, 18);
}

function getVisitorId(req, providedId = '') {
  const clean = String(providedId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return clean || hashIp(req);
}

function isBot(ua = '') {
  return /bot|crawler|spider|preview|facebookexternalhit|discordbot|twitterbot|slurp|whatsapp|telegrambot|googlebot|bingbot/i.test(ua);
}

function parseDevice(ua = '') {
  if (/iphone|ipad|ipod/i.test(ua)) return 'iPhone / iPad';
  if (/android/i.test(ua)) return 'Android';
  if (/windows/i.test(ua)) return 'Windows';
  if (/macintosh|mac os/i.test(ua)) return 'Mac';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Unknown';
}

function parseBrowser(ua = '') {
  if (/crios|chrome/i.test(ua) && !/edg/i.test(ua)) return 'Chrome';
  if (/safari/i.test(ua) && !/chrome|crios/i.test(ua)) return 'Safari';
  if (/firefox/i.test(ua)) return 'Firefox';
  if (/edg/i.test(ua)) return 'Edge';
  if (/discord/i.test(ua)) return 'Discord';
  return 'Other';
}

function getCountry(req) {
  return String(req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || req.headers['x-country'] || 'Unknown').toUpperCase().slice(0, 32);
}

async function recordEvent(req, type, extra = {}) {
  await loadStats();
  const ua = String(req.headers['user-agent'] || '');
  if (isBot(ua) && type === 'view') return;

  const today = dayKey();
  statsCache.daily[today] ||= { pageViews: 0, visitors: 0, parses: 0, downloads: 0, errors: 0 };

  const visitorId = getVisitorId(req, extra.visitorId);
  const now = Date.now();
  const existing = statsCache.visitors[visitorId];
  const isNewVisitor = !existing;
  statsCache.visitors[visitorId] = {
    firstSeen: existing?.firstSeen || new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    lastSeenMs: now,
    country: getCountry(req),
    device: parseDevice(ua),
    browser: parseBrowser(ua)
  };

  if (isNewVisitor) {
    statsCache.totals.visitors += 1;
    statsCache.daily[today].visitors += 1;
  }

  if (type === 'view') {
    statsCache.totals.pageViews += 1;
    statsCache.daily[today].pageViews += 1;
    inc(statsCache.pages, extra.path || req.path || '/');
    inc(statsCache.referrers, extra.referrer || req.headers.referer || 'Direct');
  }
  if (type === 'parse') {
    statsCache.totals.parses += 1;
    statsCache.daily[today].parses += 1;
  }
  if (type === 'download') {
    statsCache.totals.downloads += 1;
    statsCache.daily[today].downloads += 1;
    inc(statsCache.formats, extra.format || 'Unknown');
  }
  if (type === 'error') {
    statsCache.totals.errors += 1;
    statsCache.daily[today].errors += 1;
  }

  inc(statsCache.countries, getCountry(req));
  inc(statsCache.devices, parseDevice(ua));
  inc(statsCache.browsers, parseBrowser(ua));
  addRecent(type, { visitorId, country: getCountry(req), device: parseDevice(ua), browser: parseBrowser(ua), ...extra });
  scheduleSave();
}

function makeStatsSnapshot() {
  const now = Date.now();
  const activeVisitors = Object.values(statsCache.visitors || {}).filter((v) => now - Number(v.lastSeenMs || 0) < 5 * 60 * 1000).length;
  const today = statsCache.daily[dayKey()] || { pageViews: 0, visitors: 0, parses: 0, downloads: 0, errors: 0 };
  const last7 = Object.entries(statsCache.daily).sort(([a], [b]) => a.localeCompare(b)).slice(-7).map(([date, data]) => ({ date, ...data }));
  return {
    app: APP_NAME,
    version: BUILD_VERSION,
    updatedAt: statsCache.updatedAt,
    totals: statsCache.totals,
    today,
    activeVisitors,
    last7,
    top: {
      countries: Object.entries(statsCache.countries).sort((a, b) => b[1] - a[1]).slice(0, 10),
      devices: Object.entries(statsCache.devices).sort((a, b) => b[1] - a[1]).slice(0, 10),
      browsers: Object.entries(statsCache.browsers).sort((a, b) => b[1] - a[1]).slice(0, 10),
      pages: Object.entries(statsCache.pages).sort((a, b) => b[1] - a[1]).slice(0, 10),
      referrers: Object.entries(statsCache.referrers).sort((a, b) => b[1] - a[1]).slice(0, 10),
      formats: Object.entries(statsCache.formats).sort((a, b) => b[1] - a[1]).slice(0, 10)
    },
    recent: statsCache.recent.slice(0, 30)
  };
}

function requireAdmin(req, res, next) {
  const key = String(req.query.key || req.headers['x-admin-password'] || '');
  if (key !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function isTikTokUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return ['tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com', 'm.tiktok.com'].some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

function cleanTitle(text = '') {
  return String(text).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'TikTok video';
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function normalizeFormats(info) {
  const raw = Array.isArray(info.formats) ? info.formats : [];
  const progressive = raw
    .filter((f) => f && f.format_id && f.url)
    .filter((f) => f.vcodec && f.vcodec !== 'none')
    .filter((f) => !f.ext || ['mp4', 'mov', 'm4v'].includes(String(f.ext).toLowerCase()))
    .map((f) => {
      const width = Number(f.width || 0);
      const height = Number(f.height || 0);
      const note = f.format_note || f.resolution || (height ? `${height}p` : 'MP4');
      return {
        id: String(f.format_id),
        label: width && height ? `${width}×${height}` : note,
        quality: height || width || 0,
        ext: f.ext || 'mp4',
        hasAudio: Boolean(f.acodec && f.acodec !== 'none'),
        filesize: f.filesize || f.filesize_approx || null
      };
    })
    .sort((a, b) => a.quality - b.quality);

  const formats = uniqueBy(progressive, (f) => `${f.label}-${f.hasAudio}-${f.ext}`);
  const best = {
    id: 'best[ext=mp4]/best',
    label: 'Best available MP4',
    quality: 9999,
    ext: 'mp4',
    hasAudio: true,
    filesize: null
  };

  return [...formats.slice(-5), best].sort((a, b) => a.quality - b.quality);
}

async function getVideoInfo(url) {
  const { stdout } = await execFileAsync('yt-dlp', [
    '-J',
    '--no-playlist',
    '--no-warnings',
    '--socket-timeout', '20',
    url
  ], {
    timeout: 45000,
    maxBuffer: 10 * 1024 * 1024
  });
  return JSON.parse(stdout);
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, app: APP_NAME, version: BUILD_VERSION });
});

app.get('/api/config', (_req, res) => {
  res.json({
    appName: APP_NAME,
    appUrl: APP_URL,
    version: BUILD_VERSION,
    gaMeasurementId: GA_MEASUREMENT_ID,
    bannerAdHtml: process.env.BANNER_AD_HTML || '',
    directLinkUrl: process.env.DIRECT_LINK_URL || '',
    openDirectLinkOnDownload: process.env.OPEN_DIRECT_LINK_ON_DOWNLOAD === 'true',
    adCooldownSeconds: Number(process.env.AD_COOLDOWN_SECONDS || 45)
  });
});

app.post('/api/track', async (req, res) => {
  try {
    await recordEvent(req, 'view', { visitorId: req.body?.visitorId, path: req.body?.path || '/', referrer: req.body?.referrer || 'Direct' });
    res.json({ ok: true });
  } catch (err) {
    console.error('track failed:', err?.message || err);
    res.json({ ok: false });
  }
});

app.get('/api/admin/stats', requireAdmin, async (_req, res) => {
  await loadStats();
  res.json(makeStatsSnapshot());
});

app.post('/api/admin/reset', requireAdmin, async (_req, res) => {
  statsCache = emptyStats();
  scheduleSave();
  res.json({ ok: true });
});

app.post('/api/parse', apiLimiter, async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!isTikTokUrl(url)) {
    await recordEvent(req, 'error', { reason: 'invalid_tiktok_url' });
    return res.status(400).json({ error: 'Paste a valid public TikTok link.' });
  }

  try {
    const info = await getVideoInfo(url);
    await recordEvent(req, 'parse', { title: cleanTitle(info.title), visitorId: req.body?.visitorId });
    res.json({
      title: cleanTitle(info.title),
      uploader: info.uploader || info.channel || '',
      thumbnail: info.thumbnail || '',
      duration: info.duration || null,
      webpageUrl: info.webpage_url || url,
      formats: normalizeFormats(info)
    });
  } catch (err) {
    console.error('parse failed:', err?.message || err);
    await recordEvent(req, 'error', { reason: 'parse_failed' });
    res.status(502).json({ error: 'Could not read this TikTok link. Use a public video link and try again.' });
  }
});

app.get('/download', apiLimiter, async (req, res) => {
  const url = String(req.query.url || '').trim();
  const format = String(req.query.format || 'best[ext=mp4]/best').trim();

  if (!isTikTokUrl(url)) {
    await recordEvent(req, 'error', { reason: 'invalid_download_url' });
    return res.status(400).send('Invalid TikTok URL.');
  }

  await recordEvent(req, 'download', { format });

  const safeFormat = /^[a-zA-Z0-9_.,+\-\[\]=\/()]+$/.test(format) ? format : 'best[ext=mp4]/best';
  const filename = `virotik-${Date.now()}.mp4`;

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Accel-Buffering', 'no');

  const child = spawn('yt-dlp', [
    '-f', safeFormat,
    '--merge-output-format', 'mp4',
    '--no-playlist',
    '--no-warnings',
    '-o', '-',
    url
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  child.stdout.pipe(res);
  child.stderr.on('data', (data) => console.error(`yt-dlp: ${data}`));
  child.on('error', (err) => {
    console.error('download spawn error:', err);
    if (!res.headersSent) res.status(500).send('Download failed.');
  });
  child.on('close', (code) => {
    if (code !== 0) console.error(`download process exited with code ${code}`);
  });

  req.on('close', () => child.kill('SIGKILL'));
});

app.get('/admin', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`${APP_NAME} website running on port ${PORT} (${BUILD_VERSION})`);
});
