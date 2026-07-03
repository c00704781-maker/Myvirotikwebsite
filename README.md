# ViroTik Website

A Railway-ready website for downloading public TikTok videos from the browser.

## What is included

- Mobile-first ViroTik design with dark/light mode.
- Express backend.
- `yt-dlp` based TikTok parsing and MP4 streaming.
- Quality buttons when formats are available.
- Non-aggressive ad layout: top banner slot, result banner slot, and an optional modal before download.
- Monetag-ready configuration through Railway environment variables.

## Railway deployment

1. Open Railway.
2. Create a new project from this GitHub repository.
3. Railway should detect the included Dockerfile.
4. Deploy.
5. Open the generated Railway domain.

## Optional environment variables

```bash
APP_NAME=ViroTik
APP_URL=https://your-domain.up.railway.app
RATE_LIMIT_PER_MINUTE=25

# Ads
MONETAG_SCRIPT_URL=https://example-monetag-script-url.js
BANNER_AD_HTML=<script or native banner code from your ad zone></script>
SHOW_AD_BEFORE_DOWNLOAD=true
AD_COOLDOWN_SECONDS=45
```

For Monetag, create a website/publisher ad zone in your Monetag dashboard, then copy the script URL or banner code into Railway variables. Keep pop/push ads light; too many redirects will lower user retention.

## Notes

- Only public TikTok links are supported.
- Private, deleted, region-blocked, or login-only videos will fail.
- The app does not use a database and does not save submitted links.
- Use the service responsibly and respect creators' rights.
