// Monarch — Projected Balance: content script (extension world).
// 1) Injects page.js into Monarch's page world (so it can reach window.__APOLLO_CLIENT__).
// 2) Bridges storage: page.js can't call chrome.storage, so it asks us over postMessage.
//    The backend (chrome.storage.sync vs local) is chosen by the user's setting.

(function () {
  'use strict';
  const api = (typeof browser !== 'undefined') ? browser : chrome;
  const DATA_KEY = 'projbal_pending_v1';
  const SET_KEY = 'projbal_settings';
  const DEFAULT_SETTINGS = { backend: 'sync', debug: true };

  // Settings always live in local storage, so we can read them to decide where data goes.
  async function getSettings() {
    try { const r = await api.storage.local.get(SET_KEY); return Object.assign({}, DEFAULT_SETTINGS, r[SET_KEY] || {}); }
    catch (e) { return Object.assign({}, DEFAULT_SETTINGS); }
  }
  function areaFor(backend) {
    // Fall back to local if sync isn't available (e.g. disabled) so we never lose writes.
    if (backend === 'sync' && api.storage.sync) return api.storage.sync;
    return api.storage.local;
  }
  async function getData(backend) {
    try { const r = await areaFor(backend).get(DATA_KEY); return r[DATA_KEY] || {}; }
    catch (e) { return {}; }
  }
  async function setData(backend, data) {
    try { await areaFor(backend).set({ [DATA_KEY]: data }); }
    catch (e) { /* sync quota exceeded etc. — fall back to local */ try { await api.storage.local.set({ [DATA_KEY]: data }); } catch (e2) { } }
  }

  function reply(reqId, result) { window.postMessage({ source: 'projbal-content', reqId, result }, '*'); }
  function pushChange(data) { window.postMessage({ source: 'projbal-content', type: 'changed', data: data || {} }, '*'); }

  // Handle requests from page.js
  window.addEventListener('message', async (ev) => {
    const d = ev.data;
    if (!d || ev.source !== window || d.source !== 'projbal-page') return;
    if (d.type === 'init') {
      const settings = await getSettings();
      const data = await getData(settings.backend);
      reply(d.reqId, { settings, data });
    } else if (d.type === 'save') {
      const settings = await getSettings();
      await setData(settings.backend, d.data || {});
    }
  });

  // Relay external changes (another tab, another synced device, or a backend switch) back to page.js
  api.storage.onChanged.addListener(async (changes, area) => {
    const settings = await getSettings();
    if (area === (settings.backend === 'sync' && api.storage.sync ? 'sync' : 'local') && changes[DATA_KEY]) {
      pushChange(changes[DATA_KEY].newValue || {});
    }
    if (area === 'local' && changes[SET_KEY]) {
      // backend may have changed — re-send data from the (possibly new) backend
      const ns = Object.assign({}, DEFAULT_SETTINGS, changes[SET_KEY].newValue || {});
      pushChange(await getData(ns.backend));
    }
  });

  // Inject the page-world script (listener is already registered above)
  const s = document.createElement('script');
  s.src = api.runtime.getURL('page.js');
  s.onload = function () { s.remove(); };
  (document.head || document.documentElement).appendChild(s);
})();
