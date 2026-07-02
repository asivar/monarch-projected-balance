# Chrome Web Store — Listing Copy

Paste each field into the matching box in the Web Store Developer Dashboard.
Notes and caveats are marked ⚠️.

---

## Name  (max 75 chars)

Projected Balance for Monarch Money

⚠️ **Naming caveat:** Google may flag a third-party product name ("Monarch Money") in the
extension *title* during review. This "for X" pattern is common and usually accepted when the
listing clearly states it's unofficial, but if review pushes back, fall back to one of:
- `Projected Balance — Companion for Monarch Money`
- `Projected Balance (unofficial, for Monarch Money)`
You can always reference Monarch freely in the **description** (nominative use); the risk is
only in the title.

---

## Summary  (max 132 chars)

A day-by-day projected-balance graph, pending-check tracking, and auto-reconciliation for your Monarch Money accounts. Unofficial.

---

## Category

Productivity  →  (subcategory: Workflow & Planning)

---

## Single purpose  (required field)

This extension adds a forward-looking, day-by-day balance projection and an outstanding-transaction
tracker to Monarch Money account pages, so a user can forecast a single account's balance before
transactions post.

---

## Description  (max ~16,000 chars)

Monarch Money shows you where your money has been. This extension shows you where a single account
is GOING — day by day, before the transactions post.

It adds three things to your Monarch account pages:

📈 Projected balance graph
A forward-looking, day-by-day projection for the account you're viewing, built from your recurring
items and upcoming transactions. It answers the question Monarch can't: "if I pay this now, will my
balance survive before payday?" — and it turns red and flags the exact date if you'd dip below zero.

📝 Pending-transactions register
Log a check or transfer the moment you commit it, before your bank posts it. It rides the projection
as a committed outflow (or inflow) until it clears — so your forecast reflects money that's already
spoken for.

✅ Confidence-gated reconciler
When a pending item matches a posted transaction (exact check number and amount), it clears
automatically. A plausible match asks you to confirm. Anything uncertain is left alone — so you
never get surprise duplicates.

YOUR DATA STAYS YOURS
Everything runs locally in your browser against Monarch's own on-page data. The extension has no
server and sends nothing to the developer or any third party. Your pending-items list is stored via
the browser — your choice of synced across your own browsers, or local-only. You can export and
import it as JSON at any time.

UNOFFICIAL
This is an independent, community-built tool. It is not affiliated with, endorsed by, or sponsored
by Monarch Money, Inc. "Monarch" and "Monarch Money" are trademarks of their respective owner and
are used only to describe what this extension is compatible with.

Open source (MIT): https://github.com/asivar/monarch-projected-balance

---

## Permission justifications  (required — one per permission)

storage
Used only to save the user's list of pending (not-yet-posted) transactions and their
sync-vs-local preference. This is the only data the extension stores, and it never leaves the
browser.

Host permission — https://app.monarch.com/*
The extension runs only on the user's own Monarch Money account pages. There it reads the
account's balance and transactions from the page's existing data to compute the projection and
render its UI. It does not run on, or read data from, any other website.

(No other permissions are requested. The extension contains no remotely hosted code — all logic is
bundled in the package.)

---

## Privacy practices tab  (data disclosures + certifications)

Privacy policy URL:
https://asivar.github.io/monarch-projected-balance/
(the Privacy section of the landing page — provide this once GitHub Pages is live)

What user data does this item collect?
- None that leaves the device. The extension does not collect, transmit, or sell any user data.
  The only data it stores is the user's own list of pending transactions, kept in the browser's
  local/synced storage. If the dashboard requires you to check data categories for anything that is
  merely read on-page (e.g. "financial information"), disclose that it is processed locally and
  never transmitted.

Required certifications (check all — they are true for this extension):
- ✅ I do not sell or transfer user data to third parties, outside of approved use cases.
- ✅ I do not use or transfer user data for purposes unrelated to the item's single purpose.
- ✅ I do not use or transfer user data to determine creditworthiness or for lending purposes.

---

## Assets you'll need to upload (dimensions matter)

- Store icon: 128×128 PNG — you have it (icons/icon128.png).
- Screenshots: at least 1, either 1280×800 or 640×400 (landscape). ⚠️ The full-page mock is
  1600×2000 (portrait), so it won't fit the screenshot slot as-is — you need a landscape crop/render.
  (Ask and I'll generate a 1280×800 version.)
- Small promo tile (optional but recommended): 440×280 PNG.
- Marquee promo (optional): 1400×560 PNG.

---

## Also note

- Firefox (addons.mozilla.org) is a separate submission with its own listing fields, but this same
  copy adapts directly. AMO signs the extension so it installs permanently (unlike the temporary
  add-on flow used during development).
- The gecko id in manifest.json (projected-balance@monarch-tools.dev) is the Firefox add-on id;
  keep it stable across releases.
