// Parent Data Force — ad slot loader
// Slots are <div class="ad-slot" data-ad-slot="KEY"></div>
// Each slot maps to an Adsterra unit config. Two loader patterns exist:
//   { src: 'https://plX.../....js' }                        → direct script
//   { invoke: 'https://plX.../invoke.js', id: 'container-X' } → invoke.js + container div
// Until a unit is configured, the slot keeps its placeholder.
//
// UNITS — approved site: tools.parentdataforce.org (Aug 12, 2026)
// All banner units use the highperformanceformat.com invoke pattern.
// NO popunder / adult-ads units wired — family-safe only.
window.PDF_ADS = {
  UNITS: {
    // Hub leaderboard (replaces the old popunder — adult-ad source)
    'home-top': { invoke: 'https://www.highperformanceformat.com/cfc10471417c6e261f17aa91ce4a6a36/invoke.js', id: 'container-cfc10471417c6e261f17aa91ce4a6a36' },
    // PDF tools — between tools
    'pdf-between': { invoke: 'https://www.highperformanceformat.com/c8861c32088bb3814ecdd9cb556a9460/invoke.js', id: 'container-c8861c32088bb3814ecdd9cb556a9460' },
    // PDF tools — sidebar box
    'pdf-side': { invoke: 'https://www.highperformanceformat.com/a4b8142bcbe93c04601223e2f7cc1044/invoke.js', id: 'container-a4b8142bcbe93c04601223e2f7cc1044' },
    // YouTube results — mobile leaderboard
    'youtube-results': { invoke: 'https://www.highperformanceformat.com/2a5e0a571057868d17de3b619b5582b4/invoke.js', id: 'container-2a5e0a571057868d17de3b619b5582b4' },
    // Articles — sidebar skyscraper
    'articles-sidebar': { invoke: 'https://www.highperformanceformat.com/c22c4d61ef65608804e05e0a1bd38c72/invoke.js', id: 'container-c22c4d61ef65608804e05e0a1bd38c72' },
    // QR Studio modal — box
    'qr-modal': { invoke: 'https://www.highperformanceformat.com/a4b8142bcbe93c04601223e2f7cc1044/invoke.js', id: 'container-a4b8142bcbe93c04601223e2f7cc1044' },
    // Email tracker detail — box
    'email-detail': { invoke: 'https://www.highperformanceformat.com/a4b8142bcbe93c04601223e2f7cc1044/invoke.js', id: 'container-a4b8142bcbe93c04601223e2f7cc1044' },
  },
  init() {
    document.querySelectorAll('.ad-slot[data-ad-slot]').forEach((el) => {
      const unit = this.UNITS[el.dataset.adSlot];
      if (!unit) return; // keep placeholder
      el.innerHTML = '';
      if (unit.invoke) {
        const div = document.createElement('div');
        div.id = unit.id;
        el.appendChild(div);
        const scr = document.createElement('script');
        scr.async = true;
        scr.setAttribute('data-cfasync', 'false');
        scr.src = unit.invoke;
        el.appendChild(scr);
      } else if (unit.src) {
        const scr = document.createElement('script');
        scr.async = true;
        scr.src = unit.src;
        el.appendChild(scr);
      }
    });
  }
};
document.addEventListener('DOMContentLoaded', () => window.PDF_ADS.init());
