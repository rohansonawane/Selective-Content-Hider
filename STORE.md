# Chrome Web Store listing

Copy these fields into the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).

## Public URLs

| Listing field | URL |
| --- | --- |
| Homepage | https://rohansonawane.github.io/Selective-Content-Hider/ |
| Privacy policy | https://rohansonawane.github.io/Selective-Content-Hider/privacy.html |
| Support | https://rohansonawane.github.io/Selective-Content-Hider/support.html |

## Item details

- **Name:** Selective Content Hider
- **Category:** Productivity
- **Language:** English
- **Short description (132 max):** Hide distracting sections on any website with a click. Restore them on the page, pause a site, or back up your rules.

### Detailed description

```
Selective Content Hider removes the parts of a page you do not want to see.

Click Start hiding, then click any section. That block disappears. The choice stays on that website until you restore it.

What you can do
• Hide sidebars, recap rails, newsletter boxes, and other page chrome
• Restore one item from the bar left on the page, or restore everything
• Pause a site when you need the hidden UI for a moment
• Keep rules after reload, or treat them as a one-visit change
• Optionally hide similar sections together
• Export and import a JSON backup, and sync settings through Chrome if you are signed in

This is not an ad blocker. It does not filter network requests or maintain a public block list. You choose what to hide on the pages you visit.

Privacy
Rules and settings stay in your browser. Nothing is sent to a server we operate. See the privacy policy linked on this listing.
```

### Single purpose

Lets the user hide selected sections of web pages and remember those choices per website.

## Permission justifications

Use these answers in the dashboard if Chrome asks.

- **storage** — Save hide rules, pause state, and settings on the device (and Chrome Sync when the user is signed in).
- **scripting** — Inject the helper on a tab if it is missing so Start hiding still works after a refresh.
- **activeTab** — Talk to the page the user has open.
- **contextMenus** — Hide or restore from the right-click menu.
- **commands** — Keyboard shortcuts for selection mode and restore.
- **host_permissions (`<all_urls>`)** — The user can hide sections on any site they visit. No data is collected from those pages.

## Images

Required uploads:

| Asset | File | Size |
| --- | --- | --- |
| Store icon | `icons/icon128.png` | 128×128 PNG |
| Small promo tile | `store/promo-small-440x280.png` | 440×280 |
| Screenshots | `store/screenshots/*.png` | 1280×800 |

Optional: `store/promo-marquee-1400x560.png`

Screenshot captions:

1. Start hiding, then click any section
2. Restore from the bar on the page
3. Manage saved hides for every site

## Package and publish

```bash
chmod +x package.sh
./package.sh
```

Upload `dist/selective-content-hider.zip`. After upload, attach screenshots, the promo tile, and these URLs:

- Homepage: https://rohansonawane.github.io/Selective-Content-Hider/
- Privacy: https://rohansonawane.github.io/Selective-Content-Hider/privacy.html
- Support: https://rohansonawane.github.io/Selective-Content-Hider/support.html

Then add the permission justifications and submit for review.
