# Parent Data Force — Tool Roadmaps & Feature Sets
## Development track at dev.parentdataforce.org → live at parentdataforce.org

Each tool below has: current status, feature set (SHIPPED / NEXT / LATER), revenue hooks, and test checklist status.
Legend: [x] shipped+tested, [~] shipped+needs test, [ ] planned

---

## 1. QR CODE GENERATOR
URL: /tools/qr  |  Repo: parentdataforce-tools  |  Backend: Node/Express + links.json

### Feature Set
- [x] Create QR from destination URL
- [x] Optional tracked redirect link (/r/:code)
- [x] First-party click counting (aggregate only, no PII)
- [x] Download as PNG
- [x] Label + optional tracking toggle
- [~] API: GET /api/qr/:code (metadata + click count)
- [ ] USER ACCOUNTS (NEXT) — email/password signup, session auth, per-user QR library
- [ ] Dashboard (NEXT) — list all my QRs, click stats, delete/edit
- [ ] Bulk generation (LATER) — CSV upload, 100+ at once
- [ ] Custom branding (LATER) — colors, logo embed in QR
- [ ] SVG/PDF export (LATER)
- [ ] API access for developers (LATER)

### Revenue Hooks
- Premium: unlimited QRs, full analytics, bulk, branding — $3/mo or $25/yr
- Ads on dashboard (Ezoic once traffic warrants)
- Referral: link shorteners, hosting

### Test Checklist
- [ ] Create tracked QR → redirect works → clicks increment
- [ ] Create untracked QR → no redirect, direct URL
- [ ] Invalid URL rejected (non-http(s), creds in URL)
- [ ] Duplicate code collision handling
- [ ] links.json persists across restart
- [ ] Auth flow (once accounts ship)

---

## 2. PDF TOOLS
URL: /tools/pdf  |  Repo: parentdataforce-tools  |  Backend: NONE (100% client-side)

### Feature Set
- [x] Merge PDF — multi-file, reorder, single output
- [x] Split PDF — page range → single PDF or individual PDFs
- [x] Rotate Pages — 90/180/270, page range select
- [x] Compress PDF — object-stream re-encode, 3 levels
- [x] PDF to Images — per-page PNG/JPG render, quality select
- [x] Images to PDF — PNG/JPG/BMP/GIF, page size select, reorder
- [x] Add Page Numbers — position, start number, format (1 / Page N / N of M), font size
- [x] Add Watermark — text, size, opacity slider, rotation, color
- [x] Form Filler — detect fields, fill, flatten, download
- [x] Redact PDF — draw boxes, auto-detect SSN/email/phone, permanent removal
- [ ] Auto-detect improvements (NEXT) — IP addresses, DOBs, names via regex presets
- [ ] OCR pass with docling/tesseract (NEXT) — detect text hidden behind black boxes (Joey's idea)
- [ ] Batch processing (LATER) — multi-file in one pass
- [ ] Cloud save (LATER) — premium only

### Revenue Hooks
- Premium: batch, OCR redaction audit, cloud save — $2/mo or $20/yr
- Ads between tools
- Referral: Adobe/Foxit alternatives, legal document services

### Test Checklist (10 tools)
- [ ] Merge: 2+ PDFs, reorder, output has all pages in order
- [ ] Split: range "1-3,5" → correct pages; individual mode → N files
- [ ] Rotate: all pages vs selected range; 90/180/270
- [ ] Compress: output smaller than input, still valid PDF
- [ ] PDF→Images: N pages → N images, correct format
- [ ] Images→PDF: correct order, page size honored
- [ ] Page numbers: position/format/start all respected
- [ ] Watermark: text visible, opacity applied, rotation angle
- [ ] Form filler: fields detected, values set, flatten works
- [ ] Redact: drawn boxes produce black boxes; auto-detect finds SSNs; underlying text removed (text layer check)

---

## 3. YOUTUBE TRANSCRIPT TOOL
URL: /tools/youtube  |  Repo: parentdataforce-tools  |  Backend: Node + youtube-transcript

### Feature Set
- [x] Extract transcript from youtube.com and youtu.be URLs
- [x] Video info card — title, channel, thumbnail
- [x] Full transcript with clickable timestamps (→ youtube at time)
- [x] Client-side search/filter within transcript
- [x] Copy All to clipboard
- [x] Download .txt
- [x] Download .srt (subtitle format)
- [~] Auto-generated captions vs manual detection
- [ ] AI summarizer (NEXT) — LLM call, premium feature
- [ ] Translation (LATER)
- [ ] Channel video list (LATER)
- [ ] Transcript in multiple languages (LATER)

### Revenue Hooks
- Premium: AI summaries, translation, unlimited — $3/mo or $25/yr
- Ads on results page
- Referral: AI tools, video courses

### Test Checklist
- [x] Long URL (youtube.com/watch?v=) extraction
- [x] Short URL (youtu.be/) extraction
- [x] Raw 11-char video ID
- [x] No-transcript video → friendly error
- [x] Invalid URL → friendly error
- [ ] Search filters correctly
- [ ] Copy All works
- [ ] .txt download format
- [ ] .srt download format + valid subtitle timing
- [ ] Timestamp links point to correct video time

---

## 4. EMAIL TRACKER (NOT STARTED)
URL: /tools/email  |  Repo: parentdataforce-email-tracker (private)  |  Backend: Node

### Feature Set
- [ ] Tracked links (redirect + click count) — same pattern as QR
- [ ] Open tracking pixel (opt-in only — we decided NO invisible tracking)
- [ ] Analytics dashboard per link
- [ ] Bulk creation via CSV
- [ ] API access

### Revenue Hooks
- Free: 50 tracked links; Premium: unlimited + API — $5/mo or $40/yr
- Referral: email marketing tools (Mailchimp, ConvertKit)

### Test Checklist
- [ ] Create tracked link → redirect works → count increments
- [ ] Dashboard shows per-link stats
- [ ] CSV bulk import
- [ ] Opt-in flow respected

---

## 5. PDF REDACTOR STANDALONE (future split from PDF tools)
URL: /tools/redact (redirect to /tools/pdf#redact for now)

### Feature Set
- [x] Visual redaction boxes (draw on page)
- [x] Auto-detect regex (SSN, email, phone)
- [x] Permanent text removal (not just black box)
- [ ] Redaction audit log (NEXT) — what was redacted, page, timestamp
- [ ] OCR hidden-text detection (NEXT) — find text under black boxes before sharing
- [ ] Batch redact (LATER)

### Revenue Hooks
- Premium: audit log, OCR detection, batch — $3/mo
- Referral: legal services, privacy tools
- Ties directly to PDF advocacy work (freelaw-xray skill)

### Test Checklist
- [x] Draw box → download → text gone from text layer
- [x] Auto-detect SSN/email/phone finds + boxes them
- [ ] Multiple pages redacted correctly
- [ ] Box removal (click to delete) works
- [ ] Scanned PDF (image-only) — needs OCR detection

---

## 6. ARTICLE / BLOG SITES
URL: parentdataforce.org/articles/ (+ /privacy, /tech later)  |  Repo: parentdataforce-articles

### Feature Set
- [ ] MA Special Education hub — district data, IEP guides, PRS complaint guides
- [ ] PDF Redaction/Privacy blog — bad redaction cases, public records guides
- [ ] AI/Tech for Parents — tools, reviews, education tech
- [ ] Static Markdown→HTML build, shared theme

### Revenue Hooks
- Ads (AdSense after 6mo domain age; Ezoic earlier)
- Referrals: legal, privacy, education services
- Donation CTAs

### Test Checklist
- [ ] Article renders, nav between articles
- [ ] SEO meta (title, description, OG tags)
- [ ] Sitemap + robots.txt
- [ ] Ad slot injection

---

## DEPLOYMENT & GO-LIVE GATE
Each tool: dev (this week) → internal QA → soft-launch (friends/family/advocacy circles) → live.

| Tool | Dev | QA | Soft-launch | Live | Premium |
|------|-----|-----|-------------|------|---------|
| QR | DONE | testing now | wk 2 | wk 4 | wk 4 |
| PDF tools | DONE | testing now | wk 2 | wk 3 | wk 4 |
| YouTube | DONE | testing now | wk 2 | wk 3 | wk 4 |
| Email tracker | wk 3 | wk 3 | wk 4 | wk 5 | wk 5 |
| Articles | wk 2 | wk 3 | wk 4 | wk 5 | — |
| Redactor split | wk 4 | wk 4 | wk 5 | wk 6 | wk 6 |

## MONTHLY REVENUE TARGETS
- Break even: $80/mo (server + domains)
- Month 1 realistic: $50–100 via donations + referrals
- Month 3: $150+ via ads + first premium subs
- Month 6: $300+ via ads + premium + referrals
