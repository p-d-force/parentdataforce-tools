# ADS-SETUP.md — Adsterra wiring status + checklist

## STATUS (Aug 12, 2026)

**DONE:**
- ads.js loader (supports direct-script AND invoke.js+container patterns)
- 2 of 10 ad units wired:
  - `home-top` → unit `6b8ddd2e837ff59e63394784c2414e11` (hub, direct script)
  - `pdf-between` → unit `2efd918ee836f488cddb68507412cc0d` (PDF tools, invoke)
- Sponsor smartlink on hub: `h8t5smesg5` (parentdataforce smartlink)
- data-ad-slot attributes on ALL pages: PDF (2), YouTube (2), articles (2),
  QR Studio (1), Link Tracker (1), hub (1)
- nginx: root / → Node, /ads.js routed
- Deployed + verified: scripts inject, no page breakage

**PENDING (8 more units — Joey, 10 min when rested):**
1. Open Adsterra → Ad unit status → the table with GET CODE buttons
2. For each remaining unit, click GET CODE, copy the snippet
3. Paste into `C:/Users/LokiF/dev/parentdataforce-tools/ADS-CODES-local.md`
   with the unit name/format (Native, Banner, Popunder, etc.)
4. Tell Hermes which page each should go on — or just paste them
   and Hermes will assign to remaining slots:

## SLOT MAP (unused slots awaiting units)
```
youtube-results   → YouTube results area
youtube-bottom    → YouTube bottom
articles-sidebar  → articles hub (300x250 / 1x1 native)
articles-bottom   → articles hub bottom
qr-modal          → QR Studio (below generator)
email-detail      → Link Tracker (below generator)
```

## NOTES
- Adsterra serves empty JS to curl (bot protection) — always test in a
  real browser; browser UA + referer header returns the real 33-67KB script.
- Ad units won't FILL until (a) site approved in Adsterra dashboard and
  (b) served from the approved domain (parentdataforce.org, not dev.).
- The dev site keeps the reserved-placeholder until then — no breakage.
- Native ads (4x1 / 1x1 widget) recommended for content pages; guide:
  `Adsterra_Native_Ads_Guide.pdf` (2 pages: placements per page type).

## PAYOUT (from Adsterra docs)
- PayPal $25 min, Paxum $5 min
- Revenue accrues per impression/click once units fill
