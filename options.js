// Options page logic.
(function () {
  'use strict';
  const api = (typeof browser !== 'undefined') ? browser : chrome;
  const DATA_KEY = 'projbal_pending_v1';
  const SET_KEY = 'projbal_settings';
  const DEFAULT_SETTINGS = { backend: 'sync', debug: true };

  const $ = s => document.querySelector(s);
  const areaFor = b => (b === 'sync' && api.storage.sync) ? api.storage.sync : api.storage.local;
  const status = (msg, ok) => { const el = $('#status'); el.textContent = msg; el.style.color = ok === false ? '#e0655f' : '#1a8f5a'; setTimeout(() => { el.textContent = ''; }, 4000); };

  async function getSettings() {
    const r = await api.storage.local.get(SET_KEY);
    return Object.assign({}, DEFAULT_SETTINGS, r[SET_KEY] || {});
  }
  async function getData(backend) { const r = await areaFor(backend).get(DATA_KEY); return r[DATA_KEY] || {}; }

  async function load() {
    const s = await getSettings();
    const el = document.querySelector(`input[name=backend][value="${s.backend}"]`);
    if (el) el.checked = true; else document.querySelector('input[name=backend][value="local"]').checked = true;
    $('#debug').checked = !!s.debug;
  }

  async function save() {
    const cur = await getSettings();
    const backend = (document.querySelector('input[name=backend]:checked') || {}).value || 'local';
    const debug = $('#debug').checked;
    if (cur.backend !== backend) {
      // migrate current register to the newly chosen backend
      try { const data = await getData(cur.backend); if (data && Object.keys(data).length) await areaFor(backend).set({ [DATA_KEY]: data }); }
      catch (e) { status('Could not copy data to the new backend (quota?). Setting saved anyway.', false); }
    }
    await api.storage.local.set({ [SET_KEY]: { backend, debug } });
    status('Saved. Reload your Monarch tab to apply.');
  }

  async function exportJson() {
    const s = await getSettings();
    const data = await getData(s.backend);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'projected-balance-register.json';
    a.click(); URL.revokeObjectURL(url);
  }

  function importJson() {
    const f = $('#file'); f.value = ''; f.click();
    f.onchange = async () => {
      const file = f.files && f.files[0]; if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (typeof data !== 'object' || Array.isArray(data)) throw new Error('unexpected shape');
        const s = await getSettings();
        await areaFor(s.backend).set({ [DATA_KEY]: data });
        status('Imported. Reload your Monarch tab.');
      } catch (e) { status('Import failed: ' + e.message, false); }
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();
    $('#save').addEventListener('click', save);
    $('#export').addEventListener('click', exportJson);
    $('#import').addEventListener('click', importJson);
  });
})();
