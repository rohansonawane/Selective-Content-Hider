# Selective Content Hider

Chrome extension that hides distracting sections on a page. Hides are stored per website, can be restored one at a time, and survive reloads when you want them to.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked** and select this folder

## Use

1. Click the extension icon and press **Start hiding**
2. Click any section on the page to hide it
3. Press **↑** to hide a larger parent section, **Esc** when you are done
4. Restore from the bar left on the page, from the popup, or with the shortcut

You can also right-click an element and choose **Hide this element**, or **Pause or unpause hiding on this site**.

**Manage all sites** in the popup opens a page to review every hostname, export a JSON backup, and import it on another machine. Settings sync through Chrome when you are signed in; large rule lists may not fit in sync quota, so export is the full backup.

### Shortcuts

| Action | Shortcut |
| --- | --- |
| Toggle selection mode | Ctrl+Shift+H (⌘⇧H on Mac) |
| Restore this page | Ctrl+Shift+Y (⌘⇧Y on Mac) |

### Settings

- **Hover highlight** — outline the section under your cursor
- **Remember after reload** — keep hidden sections on later visits to the same site
- **Hide similar items** — ask before hiding matching sections together
- **Restore stubs** — leave a Hidden / Restore bar where a section was
- **Pause this site** — keep the rules, show the page in full until you unpause

## Privacy

Rules and settings stay in your browser. If Chrome Sync is on, settings (and as many rules as quota allows) can follow your account. Export is a local JSON file. Nothing is sent to a server we operate. See [PRIVACY.md](PRIVACY.md).

## License

GPL-3.0. See [LICENSE](LICENSE).

## Chrome Web Store

Listing copy, image sizes, and permission justifications are in [STORE.md](STORE.md).

```bash
./package.sh
```

Upload `dist/selective-content-hider.zip`, then add screenshots from `store/screenshots/` and the promo tile.
