const form = document.querySelector('#parseForm');
const input = document.querySelector('#urlInput');
const parseBtn = document.querySelector('#parseBtn');
const statusBox = document.querySelector('#status');
const results = document.querySelector('#results');
const themeToggle = document.querySelector('#themeToggle');
const siteAd = document.querySelector('#siteAd');
const siteAdToggle = document.querySelector('#siteAdToggle');

let config = {
  bannerAdHtml: '',
  adCooldownSeconds: 45
};
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

function injectAdHtml(target) {
  if (!target || !config.bannerAdHtml) return;
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
    const res = await fetch('/api/config', { cache: 'no-store' });
    config = { ...config, ...(await res.json()) };
  } catch {
    // Site still works without ad configuration.
  }
}

function buildDownloadUrl(formatId) {
  const params = new URLSearchParams({ url: input.value.trim(), format: formatId });
  return `/download?${params.toString()}`;
}

function startNativeDownload() {
  document.querySelector('#adModal')?.remove();
  if (!selectedDownloadUrl) return;

  const finalBox = document.querySelector('#finalDownloadBox');
  if (finalBox) {
    finalBox.hidden = false;
    finalBox.innerHTML = `
      <div class="download-started">
        <strong>Download started</strong>
        <p>Safari should now show the normal MP4 download prompt.</p>
        <a class="final-download" href="${selectedDownloadUrl}">Retry Download</a>
        <button class="download-another" type="button" data-reset-download>Download Another →</button>
      </div>
    `;
  }

  window.location.href = selectedDownloadUrl;
}

function createAdModal() {
  document.querySelector('#adModal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'adModal';
  modal.className = 'modal is-open';
  modal.innerHTML = `
    <div class="modal-card compact-ad" role="dialog" aria-modal="true" aria-label="Advertisement">
      <button id="closeAd" class="modal-close" type="button" aria-label="Close ad">×</button>
      <p class="eyebrow">Advertisement</p>
      <h3>Your download is almost ready</h3>
      <div id="modalAdSlot" class="ad-box">Ad placement</div>
      <p class="modal-note">Close this screen to start the normal Safari download prompt.</p>
    </div>
  `;
  document.body.appendChild(modal);

  injectAdHtml(modal.querySelector('#modalAdSlot'));
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
  createAdModal();
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
    return `<button class="download-link quality-option" type="button" data-select-format data-url="${buildDownloadUrl(format.id)}" data-label="${escapeHtml(label)}">
      <span class="quality-tag">${escapeHtml(group)}</span>
      <span class="quality-main">${escapeHtml(format.label)}</span>
      <small>${size ? `${size} · ` : ''}${audio}</small>
    </button>`;
  }).join('');

  form.hidden = true;
  results.hidden = false;
  results.innerHTML = `
    <div class="video-head">
      ${thumb}
      <div>
        <div class="video-title">${escapeHtml(data.title || 'TikTok video')}</div>
        <div class="video-meta">${escapeHtml(data.uploader || 'Public TikTok link')}</div>
      </div>
    </div>
    <h3 class="quality-heading">Choose Quality</h3>
    <div class="format-list quality-grid">${buttons || '<p>No downloadable MP4 formats found.</p>'}</div>
    <div id="finalDownloadBox" class="final-box" hidden></div>
  `;
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
