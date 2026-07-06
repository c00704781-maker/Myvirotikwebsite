const form = document.querySelector('#parseForm');
const input = document.querySelector('#urlInput');
const parseBtn = document.querySelector('#parseBtn');
const statusBox = document.querySelector('#status');
const results = document.querySelector('#results');
const themeToggle = document.querySelector('#themeToggle');
const siteAd = document.querySelector('#siteAd');
const siteAdToggle = document.querySelector('#siteAdToggle');

let config = { bannerAdHtml: '', adCooldownSeconds: 45, gaMeasurementId: '' };
let selectedDownloadUrl = '';
let selectedFormatLabel = '';

function getVisitorId() {
  let id = localStorage.getItem('virotik-visitor-id');
  if (!id) {
    id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem('virotik-visitor-id', id);
  }
  return id;
}

function trackPageView() {
  fetch('/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitorId: getVisitorId(), path: location.pathname || '/', referrer: document.referrer || 'Direct' }),
    keepalive: true
  }).catch(() => {});
}

function installGoogleAnalytics(id) {
  if (!id || document.querySelector('#ga-script')) return;
  const s = document.createElement('script');
  s.id = 'ga-script';
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag(){ dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', id);
}

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
  return String(str).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

function formatBytes(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = Number(bytes);
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) { size /= 1024; idx += 1; }
  return `${size.toFixed(size >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    config = { ...config, ...(await res.json()) };
    installGoogleAnalytics(config.gaMeasurementId);
  } catch {}
  if (siteAd) siteAd.hidden = true;
}

function buildDownloadUrl(formatId) {
  const params = new URLSearchParams({ url: input.value.trim(), format: formatId });
  return `/download?${params.toString()}`;
}

function runAdHtml(container, html) {
  container.innerHTML = '';
  const template = document.createElement('template');
  template.innerHTML = html;
  const scripts = [...template.content.querySelectorAll('script')];
  scripts.forEach((oldScript) => oldScript.remove());
  container.appendChild(template.content.cloneNode(true));
  scripts.forEach((oldScript) => {
    const script = document.createElement('script');
    [...oldScript.attributes].forEach((attr) => script.setAttribute(attr.name, attr.value));
    if (oldScript.textContent) script.textContent = oldScript.textContent;
    container.appendChild(script);
  });
}

function startNativeDownload() {
  document.querySelector('#adModal')?.remove();
  if (!selectedDownloadUrl) return;
  const finalBox = document.querySelector('#finalDownloadBox');
  if (finalBox) {
    finalBox.hidden = false;
    finalBox.innerHTML = `<div class="download-started"><strong>Download started</strong><p>Safari should now show the normal MP4 download prompt.</p><a class="final-download" href="${selectedDownloadUrl}">Retry Download</a><button class="download-another" type="button" data-reset-download>Download Another →</button></div>`;
  }
  if (window.gtag) window.gtag('event', 'download', { event_category: 'TikTok', event_label: selectedFormatLabel || 'MP4' });
  window.location.href = selectedDownloadUrl;
}

function showAdThenDownload() {
  const adHtml = String(config.bannerAdHtml || '').trim();
  if (!adHtml) {
    startNativeDownload();
    return;
  }
  document.querySelector('#adModal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'adModal';
  modal.className = 'modal is-open';
  modal.innerHTML = `<div class="modal-card ad-modal-card" role="dialog" aria-modal="true"><button id="closeAd" class="modal-close" type="button" aria-label="Close ad">×</button><p class="eyebrow">Sponsored</p><h2 class="ad-title">Your download is ready</h2><div class="ad-box real-ad-box" id="realAdSlot"><div class="ad-loading">Loading ad...</div></div><p class="modal-note">Close this screen to start the download.</p></div>`;
  document.body.appendChild(modal);
  const slot = modal.querySelector('#realAdSlot');
  runAdHtml(slot, adHtml);
  setTimeout(() => {
    if (!slot.textContent.trim() && slot.children.length === 0) slot.innerHTML = '<div class="ad-loading">Ad may be blocked or unavailable for this visitor.</div>';
  }, 2500);
  modal.querySelector('#closeAd').addEventListener('click', startNativeDownload);
}

results.addEventListener('click', (event) => {
  const reset = event.target.closest('[data-reset-download]');
  if (reset) {
    event.preventDefault();
    input.value = '';
    selectedDownloadUrl = '';
    selectedFormatLabel = '';
    results.hidden = true;
    results.innerHTML = '';
    clearStatus();
    form.hidden = false;
    input.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  const button = event.target.closest('[data-select-format]');
  if (!button) return;
  event.preventDefault();
  selectedDownloadUrl = button.dataset.url;
  selectedFormatLabel = button.dataset.label || 'Selected quality';
  document.querySelectorAll('[data-select-format]').forEach((el) => el.classList.remove('selected'));
  button.classList.add('selected');
  showAdThenDownload();
});

function groupFormat(format) {
  const label = String(format.label || '').toLowerCase();
  const quality = Number(format.quality || 0);
  if (label.includes('watermarked')) return 'Watermarked';
  if (quality >= 1080 || label.includes('1080')) return 'Full HD';
  if (quality >= 720 || label.includes('720')) return 'HD';
  if (quality >= 480 || label.includes('480')) return 'Medium';
  if (quality >= 320 || label.includes('320')) return 'Low';
  return 'Best';
}

function renderResults(data) {
  const formats = Array.isArray(data.formats) ? data.formats : [];
  const thumb = data.thumbnail ? `<img src="${escapeHtml(data.thumbnail)}" alt="Video thumbnail" loading="lazy">` : '';
  const buttons = formats.map((format) => {
    const size = formatBytes(format.filesize);
    const audio = format.hasAudio ? 'with audio' : 'video only';
    const label = `${format.label}${size ? ` · ${size}` : ''} · ${audio}`;
    const group = groupFormat(format);
    return `<button class="download-link quality-option" type="button" data-select-format data-url="${buildDownloadUrl(format.id)}" data-label="${escapeHtml(label)}"><span class="quality-tag">${escapeHtml(group)}</span><span class="quality-main">${escapeHtml(format.label)}</span><small>${size ? `${size} · ` : ''}${audio}</small></button>`;
  }).join('');
  form.hidden = true;
  results.hidden = false;
  results.innerHTML = `<div class="video-head">${thumb}<div><div class="video-title">${escapeHtml(data.title || 'TikTok video')}</div><div class="video-meta">${escapeHtml(data.uploader || 'Public TikTok link')}</div></div></div><h3 class="quality-heading">Choose Quality</h3><div class="format-list quality-grid">${buttons || '<p>No downloadable MP4 formats found.</p>'}</div><div id="finalDownloadBox" class="final-box" hidden></div>`;
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = input.value.trim();
  if (!url) return;
  selectedDownloadUrl = '';
  selectedFormatLabel = '';
  parseBtn.disabled = true;
  results.hidden = true;
  clearStatus();
  setStatus('Loading...');
  try {
    const res = await fetch('/api/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, visitorId: getVisitorId() }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Parse failed.');
    if (window.gtag) window.gtag('event', 'parse_tiktok_link');
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

if (siteAdToggle && siteAd) {
  siteAdToggle.addEventListener('click', () => {
    siteAd.classList.toggle('collapsed');
    siteAdToggle.textContent = siteAd.classList.contains('collapsed') ? '⌃' : '⌄';
  });
}

if (localStorage.getItem('virotik-theme') === 'light') {
  document.documentElement.classList.add('light');
  themeToggle.textContent = '☀';
}

loadConfig();
trackPageView();
