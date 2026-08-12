// Parent Data Force — ad slot loader
// Slots are <div class="ad-slot" data-ad-slot="KEY"></div>
// Each slot maps to an Adsterra unit config. Three loader patterns exist:
//   { src: 'https://plX.../....js' }                        → direct script
//   { invoke: 'https://plX.../invoke.js', id: 'container-X' } → invoke.js + container div
//   { native: 'https://plX.../invoke.js', id: 'container-X' } → native banner (script + container, NO atOptions)
// Until a unit is configured, the slot keeps its placeholder.
//
// CRITICAL: the Adsterra atOptions invoke pattern requires the global
// `atOptions` config block to be set BEFORE the invoke script executes:
//   <script> atOptions = { 'key': K, 'format': 'iframe', 'height': H, 'width': W, 'params': {} }; </script>
//   <script src="https://www.highperformanceformat.com/K/invoke.js"></script>
// We must emit BOTH pieces or the invoke script has no config and renders
// nothing (this was the "no ads visible" bug). Native banners (pl30817...)
// do NOT use atOptions — plain script + container div.
//
// UNITS — approved site: tools.parentdataforce.org (Aug 12, 2026)
// NO popunder / adult-ads units wired — family-safe only.
window.PDF_ADS = {
  UNITS: {
    // Hub leaderboard (replaces the old popunder — adult-ad source)
    'home-top': { key: 'cfc10471417c6e261f17aa91ce4a6a36', width: 728, height: 90, invoke: 'https://www.highperformanceformat.com/cfc10471417c6e261f17aa91ce4a6a36/invoke.js', id: 'container-cfc10471417c6e261f17aa91ce4a6a36' },
    // Hub bottom — native 4:1 wide strip (no atOptions pattern)
    'home-bottom': { native: 'https://pl30817073.effectivecpmnetwork.com/5f5e0035e31b5c6b4e4c2fc59b1dd58b/invoke.js', id: 'container-5f5e0035e31b5c6b4e4c2fc59b1dd58b' },
    // PDF tools — always-visible page slots use UNIQUE keys (Adsterra fills only
    'pdf-merge-1': { key: 'c8861c32088bb3814ecdd9cb556a9460', width: 468, height: 60, invoke: 'https://www.highperformanceformat.com/c8861c32088bb3814ecdd9cb556a9460/invoke.js', id: 'container-merge-1' },
    'pdf-merge-2': { key: 'a4b8142bcbe93c04601223e2f7cc1044', width: 300, height: 250, invoke: 'https://www.highperformanceformat.com/a4b8142bcbe93c04601223e2f7cc1044/invoke.js', id: 'container-merge-2' },
    'pdf-merge-3': { key: 'b0fe5d20d0ccd9493655ce160f41bf1e', width: 160, height: 300, invoke: 'https://www.highperformanceformat.com/b0fe5d20d0ccd9493655ce160f41bf1e/invoke.js', id: 'container-merge-3' },
    'pdf-split-1': { key: 'a4b8142bcbe93c04601223e2f7cc1044', width: 300, height: 250, invoke: 'https://www.highperformanceformat.com/a4b8142bcbe93c04601223e2f7cc1044/invoke.js', id: 'container-split-1' },
    'pdf-split-2': { key: 'b0fe5d20d0ccd9493655ce160f41bf1e', width: 160, height: 300, invoke: 'https://www.highperformanceformat.com/b0fe5d20d0ccd9493655ce160f41bf1e/invoke.js', id: 'container-split-2' },
    'pdf-split-3': { key: '2a5e0a571057868d17de3b619b5582b4', width: 320, height: 50, invoke: 'https://www.highperformanceformat.com/2a5e0a571057868d17de3b619b5582b4/invoke.js', id: 'container-split-3' },
    'pdf-rotate-1': { key: 'b0fe5d20d0ccd9493655ce160f41bf1e', width: 160, height: 300, invoke: 'https://www.highperformanceformat.com/b0fe5d20d0ccd9493655ce160f41bf1e/invoke.js', id: 'container-rotate-1' },
    'pdf-rotate-2': { key: '2a5e0a571057868d17de3b619b5582b4', width: 320, height: 50, invoke: 'https://www.highperformanceformat.com/2a5e0a571057868d17de3b619b5582b4/invoke.js', id: 'container-rotate-2' },
    'pdf-rotate-3': { key: 'c8861c32088bb3814ecdd9cb556a9460', width: 468, height: 60, invoke: 'https://www.highperformanceformat.com/c8861c32088bb3814ecdd9cb556a9460/invoke.js', id: 'container-rotate-3' },
    'pdf-compress-1': { key: '2a5e0a571057868d17de3b619b5582b4', width: 320, height: 50, invoke: 'https://www.highperformanceformat.com/2a5e0a571057868d17de3b619b5582b4/invoke.js', id: 'container-compress-1' },
    'pdf-compress-2': { key: 'c8861c32088bb3814ecdd9cb556a9460', width: 468, height: 60, invoke: 'https://www.highperformanceformat.com/c8861c32088bb3814ecdd9cb556a9460/invoke.js', id: 'container-compress-2' },
    'pdf-compress-3': { key: 'a4b8142bcbe93c04601223e2f7cc1044', width: 300, height: 250, invoke: 'https://www.highperformanceformat.com/a4b8142bcbe93c04601223e2f7cc1044/invoke.js', id: 'container-compress-3' },
    'pdf-pdf-to-images-1': { key: 'c8861c32088bb3814ecdd9cb556a9460', width: 468, height: 60, invoke: 'https://www.highperformanceformat.com/c8861c32088bb3814ecdd9cb556a9460/invoke.js', id: 'container-pdf-to-images-1' },
    'pdf-pdf-to-images-2': { key: 'a4b8142bcbe93c04601223e2f7cc1044', width: 300, height: 250, invoke: 'https://www.highperformanceformat.com/a4b8142bcbe93c04601223e2f7cc1044/invoke.js', id: 'container-pdf-to-images-2' },
    'pdf-pdf-to-images-3': { key: 'b0fe5d20d0ccd9493655ce160f41bf1e', width: 160, height: 300, invoke: 'https://www.highperformanceformat.com/b0fe5d20d0ccd9493655ce160f41bf1e/invoke.js', id: 'container-pdf-to-images-3' },
    'pdf-images-to-pdf-1': { key: 'a4b8142bcbe93c04601223e2f7cc1044', width: 300, height: 250, invoke: 'https://www.highperformanceformat.com/a4b8142bcbe93c04601223e2f7cc1044/invoke.js', id: 'container-images-to-pdf-1' },
    'pdf-images-to-pdf-2': { key: 'b0fe5d20d0ccd9493655ce160f41bf1e', width: 160, height: 300, invoke: 'https://www.highperformanceformat.com/b0fe5d20d0ccd9493655ce160f41bf1e/invoke.js', id: 'container-images-to-pdf-2' },
    'pdf-images-to-pdf-3': { key: '2a5e0a571057868d17de3b619b5582b4', width: 320, height: 50, invoke: 'https://www.highperformanceformat.com/2a5e0a571057868d17de3b619b5582b4/invoke.js', id: 'container-images-to-pdf-3' },
    'pdf-page-numbers-1': { key: 'b0fe5d20d0ccd9493655ce160f41bf1e', width: 160, height: 300, invoke: 'https://www.highperformanceformat.com/b0fe5d20d0ccd9493655ce160f41bf1e/invoke.js', id: 'container-page-numbers-1' },
    'pdf-page-numbers-2': { key: '2a5e0a571057868d17de3b619b5582b4', width: 320, height: 50, invoke: 'https://www.highperformanceformat.com/2a5e0a571057868d17de3b619b5582b4/invoke.js', id: 'container-page-numbers-2' },
    'pdf-page-numbers-3': { key: 'c8861c32088bb3814ecdd9cb556a9460', width: 468, height: 60, invoke: 'https://www.highperformanceformat.com/c8861c32088bb3814ecdd9cb556a9460/invoke.js', id: 'container-page-numbers-3' },
    'pdf-watermark-1': { key: '2a5e0a571057868d17de3b619b5582b4', width: 320, height: 50, invoke: 'https://www.highperformanceformat.com/2a5e0a571057868d17de3b619b5582b4/invoke.js', id: 'container-watermark-1' },
    'pdf-watermark-2': { key: 'c8861c32088bb3814ecdd9cb556a9460', width: 468, height: 60, invoke: 'https://www.highperformanceformat.com/c8861c32088bb3814ecdd9cb556a9460/invoke.js', id: 'container-watermark-2' },
    'pdf-watermark-3': { key: 'a4b8142bcbe93c04601223e2f7cc1044', width: 300, height: 250, invoke: 'https://www.highperformanceformat.com/a4b8142bcbe93c04601223e2f7cc1044/invoke.js', id: 'container-watermark-3' },
    'pdf-form-filler-1': { key: 'c8861c32088bb3814ecdd9cb556a9460', width: 468, height: 60, invoke: 'https://www.highperformanceformat.com/c8861c32088bb3814ecdd9cb556a9460/invoke.js', id: 'container-form-filler-1' },
    'pdf-form-filler-2': { key: 'a4b8142bcbe93c04601223e2f7cc1044', width: 300, height: 250, invoke: 'https://www.highperformanceformat.com/a4b8142bcbe93c04601223e2f7cc1044/invoke.js', id: 'container-form-filler-2' },
    'pdf-form-filler-3': { key: 'b0fe5d20d0ccd9493655ce160f41bf1e', width: 160, height: 300, invoke: 'https://www.highperformanceformat.com/b0fe5d20d0ccd9493655ce160f41bf1e/invoke.js', id: 'container-form-filler-3' },
    'pdf-redact-1': { key: 'a4b8142bcbe93c04601223e2f7cc1044', width: 300, height: 250, invoke: 'https://www.highperformanceformat.com/a4b8142bcbe93c04601223e2f7cc1044/invoke.js', id: 'container-redact-1' },
    'pdf-redact-2': { key: 'b0fe5d20d0ccd9493655ce160f41bf1e', width: 160, height: 300, invoke: 'https://www.highperformanceformat.com/b0fe5d20d0ccd9493655ce160f41bf1e/invoke.js', id: 'container-redact-2' },
    'pdf-redact-3': { key: '2a5e0a571057868d17de3b619b5582b4', width: 320, height: 50, invoke: 'https://www.highperformanceformat.com/2a5e0a571057868d17de3b619b5582b4/invoke.js', id: 'container-redact-3' },
  },
  init() {
    document.querySelectorAll('.ad-slot[data-ad-slot]').forEach((el) => {
      const unit = this.UNITS[el.dataset.adSlot];
      if (!unit) return; // keep placeholder
      if (unit.lazy) return; // lazy slots load when activated (tool panels)
      this.load(el, unit);
    });
    // Load the lazy slot of whichever tool panel is visible on first paint
    const visible = document.querySelector('.tool-panel:not(.hidden) .ad-slot[data-ad-slot]');
    if (visible) this.loadSlot(visible.dataset.adSlot);
  },
  // Load (or force-reload) a single slot, e.g. window.PDF_ADS.loadSlot('pdf-merge')
  loadSlot(slot) {
    const el = document.querySelector('.ad-slot[data-ad-slot="' + slot + '"]');
    const unit = this.UNITS[slot];
    if (!el || !unit) return;
    if (el.dataset.loaded === '1') return; // already loaded
    this.load(el, unit);
  },
  load(el, unit) {
    el.dataset.loaded = '1';
    el.innerHTML = '';
    // Load the unit `count` times (default 1). Per-tool slots use count 3 with
    // a `copies` array of DISTINCT unit keys so all three actually fill
    // (Adsterra serves one ad per unit key per page view).
    let copiesArr;
    if (unit.copies && unit.copies.length) copiesArr = unit.copies;
    else copiesArr = [unit];
    for (let i = 0; i < copiesArr.length; i++) {
      const u = copiesArr[i];
      const wrap = document.createElement('div');
      wrap.className = 'ad-copy';
      wrap.style.cssText = 'display:flex;justify-content:center;margin:6px auto;';
      // Container id must be unique per SLOT+COPY (multiple tool slots share
      // unit keys); fall back to the unit's own container id when slot has none.
      const cid = 'container-' + (el.dataset.adSlot || u.key) + (copiesArr.length > 1 ? '-' + (i + 1) : '');
      if (u.native) {
        // Native banner: script + container div, no atOptions needed
        const div = document.createElement('div');
        div.id = cid;
        wrap.appendChild(div);
        const scr = document.createElement('script');
        scr.async = true;
        scr.setAttribute('data-cfasync', 'false');
        scr.src = u.native;
        wrap.appendChild(scr);
      } else if (u.invoke) {
        // Container div the invoke script writes into
        const div = document.createElement('div');
        div.id = cid;
        wrap.appendChild(div);
        // 1) set the global atOptions config for THIS unit
        const cfg = document.createElement('script');
        cfg.text = "atOptions = " + JSON.stringify({
          key: u.key,
          format: 'iframe',
          height: u.height,
          width: u.width,
          params: {}
        }) + ";";
        wrap.appendChild(cfg);
        // 2) load the invoke script — MUST be async=false so it executes
        // in document order, right after its own atOptions config. Without
        // this, dynamic scripts default to async and ALL copies race: each
        // invoke reads the LAST atOptions (one orphaned ad at wrong size).
        const scr = document.createElement('script');
        scr.async = false;
        scr.setAttribute('data-cfasync', 'false');
        scr.src = u.invoke;
        wrap.appendChild(scr);
      } else if (u.src) {
        const scr = document.createElement('script');
        scr.async = true;
        scr.src = u.src;
        wrap.appendChild(scr);
      }
      el.appendChild(wrap);
    }
  }
};
// Per-tool slots load 3 ad copies of DIFFERENT sizes (different unit keys,
// so each fills). Stack them centered with spacing.
(function () {
  const s = document.createElement('style');
  s.textContent = '.ad-slot[data-loaded="1"]{flex-direction:column;gap:0;padding:4px 0}';
  document.head.appendChild(s);
})();
document.addEventListener('DOMContentLoaded', () => window.PDF_ADS.init());
