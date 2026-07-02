# Projected Balance for Monarch Money

> **Unofficial.** Not affiliated with, endorsed by, or sponsored by Monarch Money.
> Use at your own risk.

A browser extension that adds the one thing [Monarch Money](https://www.monarchmoney.com)
doesn't have: a **forward-looking, day-by-day balance projection** for a single account —
so you can answer *"if I write this check, will my balance survive before payday?"*

It adds three things to any Monarch account page, right beneath the Current balance graph:

- **Projected balance graph** — projects your balance forward using Monarch's recurring
  items and your future-dated transactions. Hover to see the balance and the payees/amounts
  driving each change; the line turns red and flags the date if you'd dip below zero.
  Ranges: 1M / 3M / 6M / 1Y / 3Y / 5Y.
- **Outstanding-items register ("Pending Transactions")** — log a check or transfer the
  moment you commit it, before the bank sees it. It rides the projection as a committed
  outflow (or inflow) until it clears. Stored in your browser only.
- **Confidence-gated reconciler** — matches your pending items against posted transactions.
  An exact check-number + amount match clears silently; a plausible amount/date match asks
  you to confirm; anything uncertain is left alone. This dissolves the duplicate problem you
  get from entering a future transaction directly in Monarch.

## Privacy

Everything runs locally in your browser against Monarch's own in-page data. **No data is
sent to the author or any third party.** Your pending-items register is stored via the
browser's storage — your choice of **synced** (across your own browsers, via the browser
vendor's account sync) or **local only** (never leaves the machine). There is no server.

## Install

### Chrome / Edge / Brave
1. Download or clone this repo.
2. Go to `chrome://extensions`, enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Open Monarch and visit any account page. Click the toolbar icon for info and **Settings**.

### Firefox
1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select `manifest.json`.
3. Open Monarch and visit any account page.

> Firefox temporary add-ons unload on restart; a permanent install requires signing via
> addons.mozilla.org. The code is identical either way.

## Settings

Click the toolbar icon → **Settings** (or `chrome://extensions` → Details → Extension options):

- **Storage backend** — Sync across your browsers, or Local only.
- **Export / Import JSON** — back up your register (drop the file in your own cloud folder
  if you like; the extension can't reach those folders directly).
- **Verbose logging** — `[ProjBal]` console output for debugging.

## How it works (and what can break it)

The extension injects a page-world script (`page.js`) that reads your balance and
transactions from Monarch's own in-page GraphQL client, computes the projection, and draws
the card. A content script (`content.js`) bridges storage, since page-world code can't call
`chrome.storage` directly. It depends on Monarch internals (the in-page client, a couple of
GraphQL operations, and a DOM anchor), so a Monarch redesign can break it. When something
looks off, open the console and filter for `[ProjBal]`.

Notes:
- The projection only includes what Monarch flags as recurring, plus your future-dated
  transactions and pending-register items. Irregular income won't appear unless you mark it
  recurring in Monarch or add it to the register as a money-in item.
- Whether a cleared check exposes its check number (enabling the reconciler's silent
  auto-clear) depends on your bank's feed. When it doesn't, matches are surfaced for you to
  confirm rather than cleared automatically.

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by Monarch Money, Inc.
"Monarch" and "Monarch Money" are trademarks of their respective owner and are used here
only to describe compatibility. This is an independent, community-built tool that uses
undocumented, unofficial interfaces of the Monarch web app; it may stop working at any time.
Provided "as is", without warranty of any kind. See [LICENSE](LICENSE).

## License

MIT — see [LICENSE](LICENSE).
