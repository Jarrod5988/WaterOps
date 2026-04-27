# Cloudflare Pages / Workers deployment for WaterOps

Recommended no-cost public app URL:

https://waterops.pages.dev

## Current build settings

Cloudflare is running this as a Workers Static Assets deployment using `npx wrangler deploy`.

Use these settings:

| Setting | Value |
| --- | --- |
| Production branch | main |
| Framework preset | None / Static |
| Build command | leave blank or `exit 0` |
| Deploy command | `npx wrangler deploy` |
| Build output directory | . |
| Root directory | leave blank / repository root |

## Files that matter

- `wrangler.jsonc` tells Wrangler to deploy this repo as static assets and use `index.html` for app navigation fallback.
- `.assetsignore` stops Wrangler uploading repo internals such as `.git`, `.wrangler`, docs, and setup files.
- `_redirects` was removed because Cloudflare rejected the catch-all rule as an infinite loop.

After this commit is deployed, press **Retry build** in Cloudflare.
