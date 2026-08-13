#!/usr/bin/env python3
"""PDF Forensics Lab service (Parent Data Force).

Localhost-only FastAPI app that runs evidence-grade analysis on uploaded
documents: hashing, metadata, structure check (qpdf), redaction X-Ray
(freelaw x-ray), malicious-PDF indicators (pdfid + peepdf), embedded file
inventory, and per-page text-layer coverage. Files are written to a temp
dir and always deleted after the scan.

Endpoints:
  GET /health   -> {"ok": true}
  POST /scan    -> raw binary body (headers: Content-Type, X-Filename)
"""
import hashlib
import io
import json
import os
import subprocess
import tempfile
import time
import uuid

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

TOOLS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools")
TMP_ROOT = "/var/lib/pdf-lab/tmp"
MAX_FILE_BYTES = 60 * 1024 * 1024
MAX_TEXT = 500  # cap per-finding redaction text length

app = FastAPI(title="PDF Forensics Lab", version="0.1.0")

def sha_hex(data, algo):
    h = hashlib.new(algo)
    h.update(data)
    return h.hexdigest()

def run(cmd, timeout=90, cap=12000):
    """Run a subprocess, return (exit_code, output capped at `cap` chars)."""
    try:
        p = subprocess.run(
            cmd,
            capture_output=True,
            timeout=timeout,
            stdin=subprocess.DEVNULL,
            text=True,
            errors="replace",
        )
        out = (p.stdout or "") + (p.stderr or "")
        return p.returncode, out[:cap]
    except subprocess.TimeoutExpired:
        return -1, f"[timeout after {timeout}s]"
    except Exception as exc:  # noqa: BLE001
        return -1, f"[error: {exc}]"

def pdfid_scan(path):
    script = os.path.join(TOOLS_DIR, "pdfid.py")
    if not os.path.exists(script):
        return {"available": False}
    code, out = run(["python3", script, "-n", path], timeout=60)
    counts = {}
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("/"):
            parts = line.split()
            if len(parts) == 2 and parts[1].isdigit():
                counts[parts[0]] = int(parts[1])
    return {"available": True, "exit": code, "counts": counts, "raw_tail": out[-1500:]}

def peepdf_scan(path):
    code, out = run(["peepdf", "-f", path], timeout=90)
    if code == -1 and "timeout" in out:
        return {"available": True, "timed_out": True, "summary": out}
    lines = out.splitlines()
    # Keep the object/stream summary portion (top of output) + suspicious markers
    keep = lines[:40]
    suspicious = [l for l in lines if any(k in l.lower() for k in ("suspicious", "javascript", "openaction", "launch", "malformed", "js:"))]
    keep.extend(suspicious[:20])
    return {"available": True, "exit": code, "summary": "\n".join(keep)[:6000]}

def xray_scan(path):
    try:
        import xray
        from importlib import metadata
        xray_version = metadata.version("x-ray")
    except Exception:
        return {"available": False, "error": "x-ray not installed"}
    try:
        result = xray.inspect(path) or {}
        pages = []
        total = 0
        for page_no in sorted(result, key=lambda k: int(k)):
            for f in result[page_no]:
                text = str(f.get("text", ""))
                bbox = f.get("bbox")
                pages.append({
                    "page": int(page_no),
                    "bbox": list(bbox) if bbox else None,
                    "text": text[:MAX_TEXT],
                    "severity": "CRITICAL" if len([c for c in text if c.isalnum()]) >= 20 else "WARNING",
                })
                total += 1
        return {"available": True, "xray_version": xray_version, "findings": total, "pages": pages}
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "error": str(exc)[:400]}

def pymupdf_scan(path):
    import fitz
    versions = {"pymupdf": fitz.version[0]}
    doc = fitz.open(path)
    try:
        meta = {k.lower(): (v if v is not None else "") for k, v in (doc.metadata or {}).items()}
        meta = {k: (v if v != "" else None) for k, v in meta.items()}
        meta["encrypted"] = bool(getattr(doc, "is_encrypted", False))
        meta["needs_password"] = bool(getattr(doc, "needs_pass", False))

        embedded = []
        try:
            for i in range(doc.embfile_count()):
                info = doc.embfile_info(i) or {}
                name = str(info.get("name", f"file{i}"))
                try:
                    data = doc.embfile_get(i)
                except Exception:
                    data = b""
                embedded.append({
                    "name": name,
                    "size": len(data),
                    "sha256": sha_hex(data, "sha256") if data else None,
                })
        except Exception:
            embedded = []

        coverage = []
        image_only = 0
        for page in doc:
            chars = len(page.get_text("text") or "")
            images = len(page.get_images(full=True) or [])
            flag = chars < 50 and images > 0
            if flag:
                image_only += 1
            coverage.append({"page": page.number + 1, "chars": chars, "images": images, "image_only": flag})

        return {
            "versions": versions,
            "metadata": meta,
            "page_count": doc.page_count,
            "embedded": embedded,
            "text_coverage": coverage,
            "image_only_pages": image_only,
        }
    finally:
        doc.close()

def qpdf_scan(path):
    code, out = run(["qpdf", "--check", path], timeout=60)
    ok = code == 0  # qpdf exits 0 when no syntax/stream errors are found
    return {"qpdf_ok": ok, "qpdf_exit": code, "qpdf_output": out[-5000:]}

def pdfparser_deep(path):
    """Deep object-level pass via Didier Stevens pdf-parser.

    Summarizes suspicious object types (JS, AA, OpenAction, Launch,
    EmbeddedFile, XFA, RichMedia) with their object ids — complements the
    pdfid counts with per-object detail.
    """
    script = os.path.join(TOOLS_DIR, "pdf-parser.py")
    if not os.path.exists(script):
        return {"available": False}
    code, out = run(["python3", script, "-f", path], timeout=120, cap=40000)
    suspicious_kinds = ["/JS", "/JavaScript", "/AA", "/OpenAction", "/Launch", "/EmbeddedFile", "/XFA", "/RichMedia", "/AcroForm", "/ObjStm"]
    found = {}
    current_obj = None
    for line in out.splitlines():
        line = line.strip()
        # pdf-parser prints "obj 1 0" style headers
        if line.startswith("obj ") and " Type:" in line:
            try:
                current_obj = line.split()[1]
            except Exception:
                current_obj = None
        for kind in suspicious_kinds:
            if kind in line:
                found.setdefault(kind, []).append(current_obj or line[:60])
    # Dedupe and cap
    for kind in found:
        seen = []
        for v in found[kind]:
            if v not in seen:
                seen.append(v)
        found[kind] = seen[:20]
    return {"available": True, "exit": code, "suspicious": found, "raw_tail": out[-2000:]}

def incremental_detect(path):
    """Detect incremental-update PDFs (multiple save revisions).

    PyMuPDF exposes the trailer dict; a /Prev key means at least one
    incremental update exists. We walk the /Prev chain to count revisions.
    """
    import fitz
    doc = fitz.open(path)
    try:
        # PyMuPDF >=1.24: trailer via pdf_trailer (dict of trailer keys)
        trailer = doc.pdf_trailer if hasattr(doc, "pdf_trailer") else doc.trailer
        revisions = 0
        prev = trailer.get("Prev") if isinstance(trailer, dict) else None
        while prev:
            revisions += 1
            try:
                xref = int(prev)
                parent = doc.xref_object(xref, compressed=True)
                # extract nested /Prev
                import re
                m = re.search(r"/Prev\s+(\d+)", parent)
                prev = int(m.group(1)) if m else None
            except Exception:
                break
        return {
            "incremental_updates": revisions,
            "is_incrementally_saved": revisions > 0,
        }
    except Exception as exc:
        return {"error": str(exc)[:300]}
    finally:
        doc.close()

def redaction_pixel(path):
    """Image-based redaction check: filled rectangles covering text spans.

    Renders vector drawings per page and flags large near-black/near-white
    fills whose bbox overlaps extractable text — the classic 'black box over
    text' redaction pattern that x-ray (text-layer based) can miss.
    """
    import fitz
    doc = fitz.open(path)
    findings = []
    try:
        for page in doc:
            pno = page.number + 1
            words = page.get_text("words")  # [x0,y0,x1,y1,word,...]
            if not words:
                continue
            drawings = page.get_drawings()
            for d in drawings:
                rect = d.get("rect")
                if not rect:
                    continue
                w = rect.width
                h = rect.height
                if w < 20 or h < 8:
                    continue
                fill = d.get("fill")
                if not fill:
                    continue
                r, g, b = fill[0], fill[1], fill[2]
                # near-black or near-white box
                dark = r < 0.25 and g < 0.25 and b < 0.25
                light = r > 0.75 and g > 0.75 and b > 0.75
                if not (dark or light):
                    continue
                # does the box cover any text?
                covered = [wd for wd in words if _rect_overlap(rect, wd)]
                if covered:
                    text = " ".join(str(wd[4]) for wd in covered[:12])
                    findings.append({
                        "page": pno,
                        "bbox": [round(rect.x0), round(rect.y0), round(rect.x1), round(rect.y1)],
                        "color": "dark" if dark else "light",
                        "covered_chars": sum(len(str(wd[4])) for wd in covered),
                        "covered_text_preview": text[:MAX_TEXT],
                    })
    except Exception as exc:
        return {"available": False, "error": str(exc)[:300]}
    finally:
        doc.close()
    return {"available": True, "findings": len(findings), "boxes": findings[:50]}

def _rect_overlap(rect, word):
    """True if a fitz.Rect overlaps a word tuple (x0,y0,x1,y1,...) by >30% of word area."""
    try:
        wx0, wy0, wx1, wy1 = word[0], word[1], word[2], word[3]
    except Exception:
        return False
    ix0 = max(rect.x0, wx0)
    iy0 = max(rect.y0, wy0)
    ix1 = min(rect.x1, wx1)
    iy1 = min(rect.y1, wy1)
    if ix1 <= ix0 or iy1 <= iy0:
        return False
    inter = (ix1 - ix0) * (iy1 - iy0)
    warea = (wx1 - wx0) * (wy1 - wy0)
    return warea > 0 and inter / warea > 0.3

def extract_tables_from_docling(docling_json: dict) -> list:
    """Walk a docling JSON document and return each table as {index, rows:[...]}.

    Docling v1 tables carry `grid` (list of cells with text + row/col spans)
    or `table_cells`. We normalize to a rectangular grid of strings.
    """
    tables = []
    walker = [docling_json]

    def collect(node):
        if isinstance(node, dict):
            if "tables" in node and isinstance(node["tables"], list):
                for i, t in enumerate(node["tables"]):
                    rows = _table_to_rows(t)
                    tables.append({"index": i, "rows": rows, "num_rows": len(rows)})
            for v in node.values():
                collect(v)
        elif isinstance(node, list):
            for v in node:
                collect(v)

    collect(walker[0])
    return tables

def _table_to_rows(table) -> list:
    grid = table.get("grid") or table.get("table_cells") or []
    if not grid:
        return []
    cells = []
    max_row = 0
    max_col = 0
    for c in grid:
        text = c.get("text") or c.get("orig") or ""
        row = int(c.get("row_span_start") or c.get("row") or c.get("bbox", {}).get("row", 0) or 0)
        col = int(c.get("col_span_start") or c.get("col") or c.get("bbox", {}).get("col", 0) or 0)
        row_span = int(c.get("row_span") or 1)
        col_span = int(c.get("col_span") or 1)
        max_row = max(max_row, row + row_span)
        max_col = max(max_col, col + col_span)
        cells.append({"row": row, "col": col, "row_span": row_span, "col_span": col_span, "text": text})
    # Build grid
    grid2 = [[""] * max_col for _ in range(max_row)]
    for c in cells:
        for r in range(c["row"], min(c["row"] + c["row_span"], max_row)):
            for cc in range(c["col"], min(c["col"] + c["col_span"], max_col)):
                if c["text"] and not grid2[r][cc]:
                    grid2[r][cc] = c["text"]
    return grid2

def tables_to_csv(rows: list) -> str:
    import csv
    import io
    buf = io.StringIO()
    w = csv.writer(buf)
    for row in rows:
        w.writerow([str(x).replace("\n", " ").replace("\r", " ") for x in row])
    return buf.getvalue()

def scan_bytes(data: bytes, filename: str, content_type: str) -> dict:
    os.makedirs(TMP_ROOT, exist_ok=True)
    tmp_path = os.path.join(TMP_ROOT, f"{uuid.uuid4().hex}-{os.path.basename(filename)[:80]}")
    report = {}
    try:
        with open(tmp_path, "wb") as fh:
            fh.write(data)
        report["evidence"] = {
            "filename": filename,
            "size": len(data),
            "mime": content_type or "application/octet-stream",
            "sha256": sha_hex(data, "sha256"),
            "sha1": sha_hex(data, "sha1"),
            "md5": sha_hex(data, "md5"),
            "scanned_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        report["structure"] = qpdf_scan(tmp_path)
        report["redaction"] = xray_scan(tmp_path)
        report["redaction_pixel"] = redaction_pixel(tmp_path)
        report["indicators"] = {"pdfid": pdfid_scan(tmp_path), "peepdf": peepdf_scan(tmp_path)}
        report["deep"] = pdfparser_deep(tmp_path)
        report["revisions"] = incremental_detect(tmp_path)
        try:
            pm = pymupdf_scan(tmp_path)
            report["metadata"] = pm["metadata"]
            report["evidence"]["page_count"] = pm["page_count"]
            report["embedded"] = pm["embedded"]
            report["text_coverage"] = pm["text_coverage"]
            report["image_only_pages"] = pm["image_only_pages"]
            pymupdf_version = pm.get("versions", {}).get("pymupdf")
        except Exception as exc:  # noqa: BLE001
            report["pymupdf_error"] = str(exc)[:400]
            pymupdf_version = None
        report["tools"] = {
            "xray": (report.get("redaction") or {}).get("xray_version"),
            "pymupdf": pymupdf_version,
            "pdfid": bool((report.get("indicators") or {}).get("pdfid", {}).get("available")),
            "peepdf": bool((report.get("indicators") or {}).get("peepdf", {}).get("available")),
            "qpdf": True,
        }
        return report
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass

@app.get("/health")
def health():
    return {"ok": True, "service": "pdf-lab", "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

@app.post("/scan")
async def scan(request: Request):
    data = await request.body()
    if not data:
        return JSONResponse(status_code=400, content={"error": "Empty body"})
    if len(data) > MAX_FILE_BYTES:
        return JSONResponse(status_code=413, content={"error": "File too large (max 60MB)"})
    filename = request.headers.get("x-filename", "document.pdf")
    content_type = request.headers.get("content-type", "application/octet-stream")
    try:
        report = scan_bytes(data, filename, content_type)
        return JSONResponse(content=report)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(status_code=500, content={"error": str(exc)[:500]})

# ── Table extraction from a docling JSON document ─────────────
# Body: the docling json_content object (e.g. from /api/docling/convert).
# Returns per-table CSV rows + optional XLSX (openpyxl) if format=xlsx.
@app.post("/extract-tables")
async def extract_tables(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "Body must be docling JSON"})
    if not isinstance(body, dict):
        return JSONResponse(status_code=400, content={"error": "Body must be a JSON object"})
    fmt = request.query_params.get("format", "csv")
    tables = extract_tables_from_docling(body)
    if not tables:
        return JSONResponse(status_code=404, content={"error": "No tables found in document", "tables": []})

    if fmt == "xlsx":
        try:
            import openpyxl
        except Exception:
            return JSONResponse(status_code=500, content={"error": "openpyxl not installed on server"})
        wb = openpyxl.Workbook()
        wb.remove(wb.active)
        for t in tables:
            ws = wb.create_sheet(title=f"table_{t['index']}")
            for row in t["rows"]:
                ws.append([str(x) for x in row])
        buf = io.BytesIO()
        wb.save(buf)
        return Response(
            content=buf.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="tables.xlsx"'},
        )

    # default: JSON of CSV strings per table
    payload = {
        "count": len(tables),
        "tables": [
            {"index": t["index"], "num_rows": t["num_rows"], "num_cols": len(t["rows"][0]) if t["rows"] else 0,
             "csv": tables_to_csv(t["rows"])}
            for t in tables
        ],
    }
    return JSONResponse(content=payload)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=5100)
