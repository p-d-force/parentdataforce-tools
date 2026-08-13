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
    ok = code == 0 and "no errors found" in out.lower()
    return {"qpdf_ok": ok, "qpdf_exit": code, "qpdf_output": out[-5000:]}

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
        report["indicators"] = {"pdfid": pdfid_scan(tmp_path), "peepdf": peepdf_scan(tmp_path)}
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=5100)
