#!/usr/bin/env python3
"""Split the single-page PDF tools index.html into 10 standalone tool pages
plus a hub index. Each tool page gets its own eager multi-size ad slots.

Tool pages: /tools/pdf/<slug>.html
Hub:        /tools/pdf/index.html  (grid of links to all tools)
"""
import io, re, os

SRC = r"C:/Users/LokiF/dev/parentdataforce-tools/public/tools/pdf/index.html"
OUT = r"C:/Users/LokiF/dev/parentdataforce-tools/public/tools/pdf"

# The source 10-panel page lives in git history (20331cb~1) because index.html
# is now the hub. If the on-disk file is the hub (no pdf-lib script), restore
# the source from git so the splitter stays reproducible.
def load_source():
    with io.open(SRC, encoding="utf-8") as fh:
        txt = fh.read()
    if 'src="https://unpkg.com/pdf-lib' in txt:
        return txt
    import subprocess
    out = subprocess.run(
        ["git", "-C", r"C:/Users/LokiF/dev/parentdataforce-tools",
         "show", "20331cb~1:public/tools/pdf/index.html"],
        capture_output=True, text=True, check=True)
    print("NOTE: index.html is the hub; splitter sourced from git 20331cb~1")
    return out.stdout

html = load_source()

# ---- 1. Extract shared chrome -------------------------------------------------
# Everything from <!doctype> through the hero section close </section>
head_end = html.index("  <div class=\"ad-slot\" data-ad-slot=\"pdf-between\">")
shared_head = html[:head_end]  # doctype..hero

# Donation + footer + script bootstrap (from the donation section to EOF)
tail_start = html.index('<section class="donation-section">')
tail = html[tail_start:]

# The shared JS helper preamble (from <script> after the CDN libs up to the
# first tool section comment)
script_start = html.index("<script src=\"https://unpkg.com/pdf-lib")
helpers_end = html.index("/* ====== MERGE PDF ====== */")
helpers = html[script_start:helpers_end]

# ---- 2. Extract per-tool JS sections -----------------------------------------
TOOL_JS = {
    "merge": "MERGE PDF",
    "split": "SPLIT PDF",
    "rotate": "ROTATE PAGES",
    "compress": "COMPRESS PDF",
    "pdf-to-images": "PDF TO IMAGES",
    "images-to-pdf": "IMAGES TO PDF",
    "page-numbers": "PAGE NUMBERS",
    "watermark": "WATERMARK",
    "form-filler": "FORM FILLER",
    "redact": "REDACT PDF",
}
def extract_js(section_label):
    m = re.search(r"/\* ====== %s ====== \*/\n(.*?)(?=\n/\* ====== |</script>)"
                  % re.escape(section_label), html, re.S)
    if not m:
        raise SystemExit("JS section not found: " + section_label)
    return m.group(1)

# ---- 3. Extract per-tool panels ----------------------------------------------
# Tool slugs != ad-slot names for 5 tools; map explicitly.
PANEL_SLOT = {
    "merge": "pdf-merge",
    "split": "pdf-split",
    "rotate": "pdf-rotate",
    "compress": "pdf-compress",
    "pdf-to-images": "pdf-p2i",
    "images-to-pdf": "pdf-i2p",
    "page-numbers": "pdf-pn",
    "watermark": "pdf-wm",
    "form-filler": "pdf-ff",
    "redact": "pdf-redact",
}
panels = {}
for tool in TOOL_JS:
    pid = "panel-" + tool
    # Find the id, then scan BACKWARD for the panel's opening <div> tag
    # (the opening tag precedes the id attribute).
    idpos = html.index('id="%s"' % pid)
    start = html.rindex('<div class="tool-panel', 0, idpos)
    # the panel ends after its ad-slot div closes: find slot start, its close,
    # then the panel's own closing </div>
    slot_start = html.index('data-ad-slot="%s"' % PANEL_SLOT[tool], start)
    slot_div_close = html.index('</div>', slot_start) + len('</div>')
    panel_close = html.index('</div>', slot_div_close) + len('</div>')
    panels[tool] = html[start:panel_close]

# ---- 4. Per-tool ad slot block (3 DIFFERENT sizes, eager) --------------------
# UNIFORM LOOK: every per-tool slot is the same fixed-height centered box, so
# all 10 pages look identical whether the fill is square/wide/tall. The ad
# renders at its native size centered inside the uniform frame.
AD_SIZES = ["468x60", "300x250", "160x300", "320x50"]
def ad_block(tool):
    divs = []
    for i, size in enumerate(AD_SIZES[:3]):
        divs.append(
            '<div class="ad-slot ad-slot-tool" data-ad-slot="pdf-%s-%d">Ad space reserved</div>'
            % (tool, i + 1)
        )
    return "\n".join(divs)

# ---- 5. Per-tool sidebar links -----------------------------------------------
SIDEBAR = [
    ("merge", "Merge PDF"),
    ("split", "Split PDF"),
    ("rotate", "Rotate Pages"),
    ("compress", "Compress PDF"),
    ("pdf-to-images", "PDF to Images"),
    ("images-to-pdf", "Images to PDF"),
    ("page-numbers", "Add Page Numbers"),
    ("watermark", "Add Watermark"),
    ("form-filler", "PDF Form Filler"),
    ("redact", "Redact PDF"),
]
def sidebar(active_tool):
    items = []
    for slug, label in SIDEBAR:
        cls = ' class="active"' if slug == active_tool else ""
        href = slug + ".html"
        items.append('        <li%s><a href="%s" style="display:flex;align-items:center;gap:10px;color:inherit;text-decoration:none;width:100%%">'
                     '<span class="tool-num">%02d</span> %s</a></li>'
                     % (cls, href, SIDEBAR.index((slug, label)) + 1, label))
    return "\n".join(items)

def tool_page(tool, title, lede, badge):
    head = shared_head.replace(
        "<title>PDF Tools | Parent Data Force</title>",
        "<title>%s | PDF Tools | Parent Data Force</title>" % title
    )
    # Uniform ad-frame CSS injected into every generated page
    head = head.replace(
        '<link rel="stylesheet" href="/styles.css">',
        '<link rel="stylesheet" href="/styles.css">\n'
        '<style>\n'
        '/* UNIFORM per-tool ad frame */\n'
        '.ad-slot-tool{min-height:300px;margin:14px 0;padding:10px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;overflow:hidden}\n'
        '.ad-slot-tool .ad-copy{display:flex;justify-content:center;align-items:center;min-height:280px}\n'
        '</style>'
    )
    # hero: keep generic lede; per-tool page replaces h1 + lede
    head = head.replace("<h1>PDF Tools</h1>", "<h1>PDF Tools</h1>")
    head = head.replace(
        '<p class="lede">Merge, split, rotate, compress, redact, and more — all processing happens in your browser. Files are never uploaded to any server.</p>',
        '<p class="lede">%s</p>' % lede
    )
    js = extract_js(TOOL_JS[tool])
    # remove the old single ad-slot from the panel; we inject the 3-size block
    # at the same spot (after the panel's status div)
    panel = panels[tool]
    # keep the status div, drop the old ad-slot
    panel = re.sub(r'\n\s*<div class="ad-slot" data-ad-slot="pdf-[^"]*".*?</div>\s*', '\n', panel, flags=re.S)
    panel = panel.replace(' class="tool-panel hidden"', ' class="tool-panel"')
    panel = panel.replace('class="active"', '', 1)  # no sidebar-active in panel
    # append the 3-size ad block at the end of the panel (after status div)
    panel = panel.rstrip() + "\n      " + ad_block(tool) + "\n    "
    page = head
    page += '\n\n  <div class="ad-slot" data-ad-slot="pdf-between">Ad space reserved</div>\n'
    page += '\n  <div class="pdf-layout">\n    <aside class="sidebar">\n      <h2>Tools</h2>\n      <ul class="tool-list">\n'
    page += sidebar(tool) + "\n"
    page += '      </ul>\n    </aside>\n'
    page += '\n    ' + panel + '\n'
    page += '\n  </div>\n'
    page += '\n  <div class="ad-slot" data-ad-slot="pdf-side" style="margin:20px 30px">Ad space reserved</div>\n'
    # donation + footer (reuse tail, strip its scripts — we re-add ours)
    tail_body = tail[:tail.index("<script")]
    page += "\n" + tail_body
    page += "\n<script src=\"https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js\"></script>"
    page += '\n<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>'
    page += "\n<script>\nif (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';\n"
    page += helpers[helpers.index("const { PDFDocument"):]
    page += js
    page += "\n</script>\n  <script src=\"/ads.js\" defer></script>\n</body>\n</html>\n"
    return page

TOOLS = {
    "merge":        ("Merge PDF", "Combine multiple PDF files into one. Drag files to reorder.", "🔒 100% Client-Side — No Upload"),
    "split":        ("Split PDF", "Extract specific pages or split a PDF into individual pages.", "🔒 100% Client-Side"),
    "rotate":       ("Rotate Pages", "Rotate pages 90, 180, or 270 degrees.", "🔒 100% Client-Side"),
    "compress":     ("Compress PDF", "Reduce PDF file size by re-encoding with optimized settings.", "🔒 100% Client-Side"),
    "pdf-to-images":("PDF to Images", "Convert each page of a PDF to PNG or JPG images.", "🔒 100% Client-Side"),
    "images-to-pdf":("Images to PDF", "Convert images (PNG, JPG, BMP) into a single PDF document.", "🔒 100% Client-Side"),
    "page-numbers": ("Add Page Numbers", "Add page numbers to every page of a PDF.", "🔒 100% Client-Side"),
    "watermark":    ("Add Watermark", "Add a text watermark to every page of a PDF.", "🔒 100% Client-Side"),
    "form-filler":  ("PDF Form Filler", "Fill form fields in a fillable PDF, then flatten and download.", "🔒 100% Client-Side"),
    "redact":       ("Redact PDF", "Draw redaction boxes over sensitive information. The redacted text is permanently removed — not just covered with a black box.", "🔒 100% Client-Side — Permanent Redaction"),
}

written = []
for slug in TOOLS:
    title, lede, badge = TOOLS[slug]
    page = tool_page(slug, title, lede, badge)
    with io.open(os.path.join(OUT, slug + ".html"), "w", encoding="utf-8", newline="") as fh:
        fh.write(page)
    written.append(slug + ".html")
print("wrote:", ", ".join(written))
