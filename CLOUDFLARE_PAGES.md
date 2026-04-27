# Cloudflare Pages setup for WaterOps

Recommended no-cost public app URL:

https://waterops.pages.dev

If `waterops` is already taken in Cloudflare Pages, use a close project name such as:

- waterops-mbs
- waterops-mbsfm
- waterops-app

## One-time Cloudflare setup

1. Open Cloudflare Dashboard.
2. Go to Workers & Pages.
3. Select Create application.
4. Select Pages.
5. Select Import an existing Git repository.
6. Connect GitHub if Cloudflare asks.
7. Select the repository: Jarrod5988/WaterOps.
8. Use these build settings:

| Setting | Value |
| --- | --- |
| Project name | waterops |
| Production branch | main |
| Framework preset | None |
| Build command | exit 0 |
| Build output directory | . |
| Root directory | leave blank / repository root |

9. Select Save and deploy.

Cloudflare will then auto-deploy the app each time the GitHub `main` branch is updated.

## Notes

- `_headers` keeps the service worker, manifest, and index file fresh so app updates are picked up more reliably.
- `_redirects` sends unknown app routes back to `index.html`.
- The app is a static PWA-style app, so no paid developer account is required for this hosting option.
- Google Sheets sync still uses the existing Google Apps Script web app URL configured in WaterOps.
