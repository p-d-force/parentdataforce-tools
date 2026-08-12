// Parent Data Force — ad slot loader
// Slots are <div class="ad-slot" data-ad-slot="KEY"></div>
// Each slot maps to an Adsterra unit config. Two loader patterns exist:
//   { src: 'https://plX.../....js' }                        → direct script
//   { invoke: 'https://plX.../invoke.js', id: 'container-X' } → invoke.js + container div
// Until a unit is configured, the slot keeps its placeholder.
window.PDF_ADS = {
  UNITS: {
    'home-top': { src: 'https://pl30806433.effectivecpmnetwork.com/6b/8d/dd/6b8ddd2e837ff59e63394784c2414e11.js' },
    'pdf-between': { invoke: 'https://pl30806434.effectivecpmnetwork.com/2efd918ee836f488cddb68507412cc0d/invoke.js', id: 'container-2efd918ee836f488cddb68507412cc0d' },
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
