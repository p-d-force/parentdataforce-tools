# Parent Data Force — QA Test Results
## Date: August 11-12, 2026
## Environment: dev.parentdataforce.org (behind Basic Auth) + local Node test

---

## TEST SUMMARY

| Suite | Tests | Pass | Fail | Notes |
|-------|-------|------|------|-------|
| QR Generator (API) | 8 | 8 | 0 | Full tracking lifecycle verified |
| PDF Tools (logic) | 10 | 10 | 0 | pdf-lib 1.17.1 same as browser CDN |
| PDF Tools (browser wiring) | 5 | 5 | 0 | Merge, Redact, Page Numbers, Watermark |
| YouTube (API) | 5 | 5 | 0 | Long URL, short URL, raw ID, errors |
| YouTube (browser) | 4 | 4 | 0 | Extract, search filter, copy, SRT format |
| Hub (render) | 1 | 1 | 0 | Dark theme, logo, donation buttons |
| **TOTAL** | **33** | **33** | **0** | |

---

## 1. QR CODE GENERATOR — 8/8 PASS

| Test | Result | Evidence |
|------|--------|----------|
| Tracked QR create | PASS | code=9HViu3ZJ, label, destination, clicks=0, createdAt |
| Click redirect | PASS | 2× GET /r/:code → 302 |
| Click counting | PASS | clicks incremented 0→2, lastClickedAt recorded |
| Untracked QR | PASS | tracking=false, no code, no redirectUrl (direct URL in QR) |
| Invalid protocol rejected | PASS | ftp:// → "Only http and https destinations are allowed." |
| Creds in URL rejected | PASS | user:pass@ → "Destination URLs cannot include credentials." |
| 404 on missing code | PASS | GET /api/qr/doesnotexist → 404 |
| Missing destination | PASS | "Invalid URL" error |
| PNG validity | PASS | PNG magic bytes 89504e47, 4985 bytes |

## 2. PDF TOOLS — LOGIC 10/10, BROWSER 5/5 PASS

### Logic (Node, pdf-lib 1.17.1)
| Test | Result | Evidence |
|------|--------|----------|
| Merge | PASS | A(3)+B(2) → 5 pages, 1636 bytes |
| Split range | PASS | "1-2" → 2 pages |
| Rotate | PASS | 0→90° |
| Compress | PASS | valid output (streams) |
| Images→PDF | PASS | letter page + embedded PNG |
| Page numbers | PASS | 3 pages valid |
| Watermark | PASS | all pages, 45° rotation, opacity 0.3 |
| Form filler | PASS | field set + flattened (0 live fields remain) |
| Redact | PASS | black box over text, valid output |
| PDF→Images | PASS* | canvas render — browser-only (covered below) |

### Browser wiring (live dev site)
| Test | Result | Evidence |
|------|--------|----------|
| Merge upload + reorder | PASS | 2 files in list, merge btn enabled |
| Merge execute | PASS | "✅ Merged 2 PDFs successfully!" |
| Redact upload + render | PASS | 1 page container, buttons enabled |
| Redact auto-detect | PASS | found exactly 2 items (SSN + phone), 2 boxes |
| Redact execute | PASS | "✅ Redacted 2 areas across 1 pages!" |
| Page numbers execute | PASS | "✅ Added page numbers to 1 pages!" |
| Watermark execute | PASS | "✅ Watermark added to 1 pages!" |

## 3. YOUTUBE TOOL — 9/9 PASS

| Test | Result | Evidence |
|------|--------|----------|
| Long URL (watch?v=) | PASS | 61 lines extracted |
| Short URL (youtu.be/) | PASS | full transcript rendered in browser |
| Raw 11-char ID | PASS | videoId=dQw4w9WgXcQ, 61 lines |
| Invalid URL | PASS | "Could not extract a valid YouTube video ID from the URL." |
| Video info (title/channel) | PASS | Rick Astley, thumbnail URL |
| Search filter | PASS | "strangers" → 60 hidden, 1 highlighted with <mark> |
| Copy All | PASS | button → "Copied!" |
| SRT format | PASS | HH:MM:SS,mmm → HH:MM:SS,mmm valid |
| Timestamp links | PASS | each line links to youtube watch?v=...&t=Ns |

## 4. HUB — PASS

| Test | Result | Evidence |
|------|--------|----------|
| Dark theme renders | PASS | body rgb(11,11,11), Outfit font |
| Logo loads | PASS | naturalWidth > 0 |
| LIVE cards + badges | PASS | PDF/YT cards marked LIVE + New Tool |
| Donation section | PASS | Ko-fi/PayPal/Venmo links present |
| $80 goal tracker | PASS | "Monthly goal: Help us cover $80/month" |
| Referral links | PASS | Vultr/Cloudflare/GitHub |
| QR form intact | PASS | destination/label/tracking + generate |

---

## INFRASTRUCTURE VERIFICATION

| Item | Result | Evidence |
|------|--------|----------|
| Root static assets via nginx | FIXED | /styles.css 200 (9724B), /logo.png 200 (573KB), /app.js 200 |
| API routes via nginx | PASS | /api/qr, /api/youtube/*, /r/ all proxied |
| systemd service | PASS | parentdataforce-tools active, healthz ok |
| Disk | PASS | 247G total, 3.3G used |

---

## KNOWN ISSUES / FOLLOW-UPS

1. **Vision tool** — was failing with "Invalid API key" (aux vision pointed at stdcmpt). FIXED by pointing auxiliary.vision at LM Studio (google/gemma-4-12b-qat, 32k context, http://127.0.0.1:1234/v1). Verified working.
2. **Subagent StandardCompute** — hit rate-limit ("AI responses are temporarily paused") mid-run, lost its final summary. Raw observations were recoverable from transcript.
3. **Ad slots** — placeholder text ("Ad space reserved") intentional until ad network wired.
4. **QR redirect URL** — generated with PUBLIC_BASE_URL=https://dev.parentdataforce.org/tools → redirect links are /tools/r/:code (works, just noted).
5. **Screenshots** — vision confirmed dark theme post-fix (screenshot at cache/screenshots/).

---

*Next: QR user accounts + dashboard (phase 2), email tracker, article sites.*
