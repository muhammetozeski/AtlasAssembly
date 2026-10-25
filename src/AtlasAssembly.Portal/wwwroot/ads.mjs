// One optional publisher unit per document; gameplay never waits for advertising.
let configuration;
let loader;
let current;
let requested = false;

function report(stage, error) {
  console.warn('Atlas Assembly advertising unavailable.', { stage, type: error?.name ?? 'Error' });
}

async function settings() {
  if (!configuration) configuration = (async () => {
    try {
      const response = await fetch('/revenue-config.json', { credentials: 'omit' });
      if (!response.ok) return null;
      const { adSense } = await response.json();
      return adSense?.enabled === true && /^ca-pub-\d{16}$/.test(adSense.client) && /^\d{5,20}$/.test(adSense.slot) ? adSense : null;
    } catch (error) { report('configuration', error); return null; }
  })();
  return configuration;
}

function ready(client) {
  if (loader) return loader;
  loader = new Promise(resolve => {
    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.atlasAdvertisement = 'true';
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
    script.addEventListener('load', () => resolve(true), { once: true });
    script.addEventListener('error', () => resolve(false), { once: true });
    document.head.append(script);
  });
  return loader;
}

function alive(state) { return current === state && !state.disposed && state.element.isConnected; }

/** Adds one configured unit to a non-game surface; unavailable configuration leaves it empty. */
export async function mount(element) {
  if (!element?.isConnected || requested) return false;
  if (current && !current.disposed) return current.element === element ? current.pending : false;
  const state = { element, disposed: false, observer: null, pending: null };
  current = state;
  state.pending = (async () => {
    try {
      const config = await settings();
      if (!config || !alive(state)) return false;
      if (!await ready(config.client) || !alive(state) || requested) return false;
      const section = document.createElement('section');
      section.setAttribute('aria-label', 'Advertisement');
      section.style.cssText = 'margin:1.5rem auto;max-width:100%;overflow:hidden';
      const label = document.createElement('small');
      label.textContent = 'Advertisement';
      const unit = document.createElement('ins');
      unit.className = 'adsbygoogle';
      unit.style.display = 'block';
      unit.dataset.adClient = config.client;
      unit.dataset.adSlot = config.slot;
      unit.dataset.adFormat = 'auto';
      unit.dataset.fullWidthResponsive = 'true';
      section.append(label, unit);
      element.replaceChildren(section);
      state.observer = new MutationObserver(() => {
        if (unit.dataset.adStatus === 'unfilled') dispose(element);
      });
      state.observer.observe(unit, { attributes: true, attributeFilter: ['data-ad-status'] });
      window.adsbygoogle = window.adsbygoogle || [];
      requested = true;
      window.adsbygoogle.push({});
      return true;
    } catch (error) { report('unit', error); dispose(element); return false; }
    finally {
      // A disabled or failed mount must not lock out a later eligible surface.
      if (current === state && !state.element.childNodes.length) current = null;
    }
  })();
  return state.pending;
}

/** Removes the visible unit and cancels pending rendering when entering a game. */
export function dispose(element) {
  if (!element) return;
  if (current?.element === element) {
    current.disposed = true;
    current.observer?.disconnect();
    current = null;
  }
  element.replaceChildren();
}
