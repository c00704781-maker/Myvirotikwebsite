import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const APP_NAME = process.env.APP_NAME || 'ViroTik';
const APP_URL = process.env.APP_URL || '';
const BUILD_VERSION = '20260703-5';

app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

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
    bannerAdHtml: process.env.BANNER_AD_HTML || '',
    directLinkUrl: process.env.DIRECT_LINK_URL || '',
    openDirectLinkOnDownload: process.env.OPEN_DIRECT_LINK_ON_DOWNLOAD === 'true',
    adCooldownSeconds: Number(process.env.AD_COOLDOWN_SECONDS || 45)
  });
});

app.post('/api/parse', apiLimiter, async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!isTikTokUrl(url)) {
    return res.status(400).json({ error: 'Paste a valid public TikTok link.' });
  }

  try {
    const info = await getVideoInfo(url);
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
    res.status(502).json({ error: 'Could not read this TikTok link. Use a public video link and try again.' });
  }
});

app.get('/download', apiLimiter, (req, res) => {
  const url = String(req.query.url || '').trim();
  const format = String(req.query.format || 'best[ext=mp4]/best').trim();

  if (!isTikTokUrl(url)) {
    return res.status(400).send('Invalid TikTok URL.');
  }

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

app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`${APP_NAME} website running on port ${PORT} (${BUILD_VERSION})`);
});
