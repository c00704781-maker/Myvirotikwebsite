const form = document.querySelector('#parseForm');
const input = document.querySelector('#urlInput');
const parseBtn = document.querySelector('#parseBtn');
const statusBox = document.querySelector('#status');
const results = document.querySelector('#results');
const themeToggle = document.querySelector('#themeToggle');
const adModal = document.querySelector('#adModal');
const closeAd = document.querySelector('#closeAd');
const continueDownload = document.querySelector('#continueDownload');
const nativeAdTop = document.querySelector('#nativeAdTop');
const modalAdSlot = document.querySelector('#modalAdSlot');

let config = {
  monetagScriptUrl: '',
  bannerAdHtml: '',
  showAdBeforeDownload: true,
  adCooldownSeconds: 45
};
let pendingDownloadUrl = '';
let lastAdAt = 0;

function setStatus(message, type = '') {
  statusBox.hidden = false;
  statusBox.className = `status ${type}`.trim();
  statusBox.textContent = message;
}

function clearStatus() {
  statusBox.hidden = true;
  statusBox.textContent = '';
  statusBox.className = 'status';
}

function escapeHtml(str = '') {
  return String(str).replace(/[&<>'"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[c]));
}

function formatBytes(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = Number(bytes);
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) { size /= 1024; idx += 1; }
  return `${size.toFixed(size >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function loadExternalScript(src) {
  if (!src || document.querySelector(`script[data-ad-script="${src}"]`)) return;
  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  script.dataset.adScript = src;
  document.head.appendChild(script);
}

function injectAdHtml(target) {
  if (!config.bannerAdHtml) return;
  target.innerHTML = config.bannerAdHtml;
  target.querySelectorAll('script').forEach((oldScript) => {
    const newScript = document.createElement('script');
    [...oldScript.attributes].forEach((attr) => newScript.setAttribute(attr.name, attr.value));
    newScript.textContent = oldScript.textContent;
    oldScript.replaceWith(newScript);
  });
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    config = { ...config, ...(await res.json()) };
    if (config.monetagScriptUrl) loadExternalScript(config.monetagScriptUrl);
    injectAdHtml(nativeAdTop);
    injectAdHtml(modalAdSlot);
  } catch {
    // Site still works without ad configuration.
  }
}

function buildDownloadUrl(formatId) {
  const params = new URLSearchParams({ url: input.value.trim(), format: formatId });
  return `/download?${params.toString()}`;
}

function shouldShowAd() {
  if (!config.showAdBeforeDownload) return false;
  const now = Date.now();
  const cooldown = Number(config.adCooldownSeconds || 45) * 1000;
  return now - lastAdAt > cooldown;
}

function startDownload(url) {
  lastAdAt = Date.now();
  window.location.href = url;
}

function showAdThenDownload(url) {
  pendingDownloadUrl = url;
  if (!shouldShowAd()) {
    startDownload(url);
    return;
  }
  adModal.hidden = false;
}

closeAd.addEventListener('click', () => {
  adModal.hidden = true;
});

continueDownload.addEventListener('click', () => {
  adModal.hidden = true;
  if (pendingDownloadUrl) startDownload(pendingDownloadUrl);
});

results.addEventListener('click', (event) => {
  const link = event.target.closest('[data-download]');
  if (!link) return;
  event.preventDefault();
  showAdThenDownload(link.getAttribute('href'));
});

function renderResults(data) {
  const formats = Array.isArray(data.formats) ? data.formats : [];
  const thumb = data.thumbnail ? `<img src="${escapeHtml(data.thumbnail)}" alt="Video thumbnail" loading="lazy">` : '';
  const buttons = formats.map((format) => {
    const size = formatBytes(format.filesize);
    const audio = format.hasAudio ? 'with audio' : 'video only';
    return `<a class="download-link" data-download href="${buildDownloadUrl(format.id)}">
      <span>⬇</span>
      <span>Download <small>(${escapeHtml(format.label)}${size ? ` · ${size}` : ''} · ${audio})</small></span>
    </a>`;
  }).join('');

  results.hidden = false;
  results.innerHTML = `
    <div class="video-head">
      ${thumb}
      <div>
        <div class="video-title">${escapeHtml(data.title || 'TikTok video')}</div>
        <div class="video-meta">${escapeHtml(data.uploader || 'Public TikTok link')}</div>
      </div>
    </div>
    <div class="format-list">${buttons || '<p>No downloadable MP4 formats found.</p>'}</div>
    <div class="ad-slot" id="nativeAdResult">Advertisement</div>
  `;
  const resultAd = document.querySelector('#nativeAdResult');
  if (resultAd) injectAdHtml(resultAd);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = input.value.trim();
  if (!url) return;

  parseBtn.disabled = true;
  results.hidden = true;
  clearStatus();
  setStatus('Parsing link...');

  try {
    const res = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Parse failed.');
    setStatus('Video found. Choose a quality below.', 'ok');
    renderResults(data);
  } catch (err) {
    setStatus(err.message || 'Something went wrong. Try another public TikTok link.', 'err');
  } finally {
    parseBtn.disabled = false;
  }
});

themeToggle.addEventListener('click', () => {
  const root = document.documentElement;
  root.classList.toggle('light');
  const light = root.classList.contains('light');
  themeToggle.textContent = light ? '☀' : '☾';
  localStorage.setItem('virotik-theme', light ? 'light' : 'dark');
});

if (localStorage.getItem('virotik-theme') === 'light') {
  document.documentElement.classList.add('light');
  themeToggle.textContent = '☀';
}

loadConfig();
