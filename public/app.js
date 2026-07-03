const form = document.querySelector('#parseForm');
const input = document.querySelector('#urlInput');
const parseBtn = document.querySelector('#parseBtn');
const statusBox = document.querySelector('#status');
const results = document.querySelector('#results');
const themeToggle = document.querySelector('#themeToggle');

let selectedDownloadUrl = '';
let selectedFormatLabel = '';

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

function buildDownloadUrl(formatId) {
  const params = new URLSearchParams({ url: input.value.trim(), format: formatId });
  return `/download?${params.toString()}`;
}

function revealFinalDownload() {
  const finalBox = document.querySelector('#finalDownloadBox');
  if (!finalBox || !selectedDownloadUrl) return;

  finalBox.hidden = false;
  finalBox.innerHTML = `
    <div class="final-ready">
      <div>
        <strong>Download ready</strong>
        <p>${escapeHtml(selectedFormatLabel || 'Selected quality')}</p>
      </div>
      <a class="final-download" href="${selectedDownloadUrl}">⬇ Download Video</a>
    </div>
  `;
  finalBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

results.addEventListener('click', (event) => {
  const button = event.target.closest('[data-select-format]');
  if (!button) return;
  event.preventDefault();

  selectedDownloadUrl = button.dataset.url;
  selectedFormatLabel = button.dataset.label || 'Selected quality';

  document.querySelectorAll('[data-select-format]').forEach((el) => el.classList.remove('selected'));
  button.classList.add('selected');

  revealFinalDownload();
});

function renderResults(data) {
  const formats = Array.isArray(data.formats) ? data.formats : [];
  const thumb = data.thumbnail ? `<img src="${escapeHtml(data.thumbnail)}" alt="Video thumbnail" loading="lazy">` : '';
  const buttons = formats.map((format) => {
    const size = formatBytes(format.filesize);
    const audio = format.hasAudio ? 'with audio' : 'video only';
    const label = `${format.label}${size ? ` · ${size}` : ''} · ${audio}`;
    return `<button class="download-link" type="button" data-select-format data-url="${buildDownloadUrl(format.id)}" data-label="${escapeHtml(label)}">
      <span>✓</span>
      <span>Select <small>(${escapeHtml(label)})</small></span>
    </button>`;
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
    <div id="finalDownloadBox" class="final-box" hidden></div>
  `;
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
