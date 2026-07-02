// Monarch — Projected Balance (extension page-world script). Injected into app.monarch.com.
// Storage is bridged to the extension via postMessage (see content.js); everything else is v0.7 logic.

/*
 * v0.6 — two additions on top of v0.5:
 *  (1) The register is now general "pending transactions": each item has a direction
 *      (money out / money in) and a type (check / transfer / ach / deposit / card / other).
 *      Anything committed-but-unposted, not just checks.
 *  (2) Confidence-gated matcher. On each refresh it pulls recently-posted transactions
 *      for the account and scores them against your pending items:
 *        high  (check # + amount exact) -> auto-clear, silent
 *        medium(amount match, close date, or check# w/ amount mismatch) -> ask to confirm
 *        low   -> leave pending, no prompt
 *      Auto-clear just removes the pending item (the real posted txn is already in the
 *      balance), which dissolves the duplicate problem. Type drives strategy: checks match
 *      on the number parsed from "CHECK # 0000001234"; others match on amount + date.
 *
 * Storage stays localStorage so we keep @grant none and retain window.__APOLLO_CLIENT__.
 */

(function () {
  'use strict';

  let DEBUG = true;
  const ACCENT = '#19c2c2', NEG = '#e0655f', POS = '#1a8f5a', PENDING = '#7c5cff';
  const AMOUNT_SIGN = 1;
  const HORIZONS = [['1 month', 30], ['3 months', 91], ['6 months', 182], ['1 year', 365], ['3 years', 1095], ['5 years', 1825]];
  const FREQ_DAYS = { daily: 1, weekly: 7, biweekly: 14, every_two_weeks: 14, semimonthly: 15, monthly: 30, quarterly: 91, semiannual: 182, semiannually: 182, yearly: 365, annually: 365 };
  const TYPES = ['check', 'transfer', 'ach', 'deposit', 'card', 'other'];
  const PKEY = 'projbal_pending_v1';
  const LOOKBACK_DAYS = 45; // window of posted transactions the matcher considers

  const log = (...a) => { if (DEBUG) console.log('%c[ProjBal]', 'color:#19c2c2;font-weight:bold', ...a); };
  const iso = d => new Date(d).toISOString().slice(0, 10);
  const fUSD = n => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const fUSDc = n => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const fDate = t => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const fDateStr = s => fDate(new Date(s + 'T00:00:00'));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- pending storage (bridged to the extension, keyed per account) ----------
  // This page-world script can't call chrome.storage, so data is relayed to/from the
  // extension (content.js) over postMessage. STORE is the in-memory mirror; the extension
  // owns the durable copy (chrome.storage sync or local, per the user's setting).
  let STORE = {};
  const _reqs = {}; let _rid = 0;
  function _bridge(type, payload) { return new Promise(res => { const reqId = ++_rid; _reqs[reqId] = res; window.postMessage(Object.assign({ source: 'projbal-page', type, reqId }, payload || {}), '*'); }); }
  window.addEventListener('message', ev => {
    const d = ev.data; if (!d || ev.source !== window || d.source !== 'projbal-content') return;
    if (d.reqId && _reqs[d.reqId]) { _reqs[d.reqId](d.result); delete _reqs[d.reqId]; return; }
    if (d.type === 'changed') { STORE = d.data || {}; const w = document.getElementById(CARD_ID); if (w) { renderPendingList(w); refresh(); } }
  });
  function loadPending(accountId) { return Array.isArray(STORE[accountId]) ? STORE[accountId] : []; }
  function savePending(accountId, items) { STORE[accountId] = items; window.postMessage({ source: 'projbal-page', type: 'save', data: STORE }, '*'); }
  function pendingEvents(accountId) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return loadPending(accountId).map(p => {
      let d = new Date(p.clear + 'T00:00:00'); if (+d < +start) d = new Date(+start);
      return { date: d, amount: p.amount, pending: true, label: (p.memo || 'Pending') + (p.check ? (' #' + p.check) : ''), kind: 'pending' };
    });
  }

  // ---------------------------- matcher ----------------------------
  function checkNumFromDesc(desc) { const m = (desc || '').match(/check\s*#?\s*0*(\d+)/i); return m ? m[1] : null; }
  const normNum = s => (s == null ? null : String(s).replace(/\D/g, '').replace(/^0+/, ''));

  function scoreMatch(p, t) {
    const pcheck = normNum(p.check);
    const tcheckRaw = checkNumFromDesc(t.plaidName || t.dataProviderDescription);
    const tcheck = tcheckRaw ? normNum(tcheckRaw) : null;
    const amtEqual = Math.abs(p.amount - t.amount) < 0.005;
    const days = Math.abs((new Date(t.date + 'T00:00:00') - new Date(p.clear + 'T00:00:00')) / 864e5);
    if (pcheck && tcheck && pcheck === tcheck && amtEqual) return { score: 1.0, tier: 'high', reason: `check #${tcheckRaw} + ${fUSDc(t.amount)} exact` };
    if (pcheck && tcheck && pcheck === tcheck && !amtEqual) return { score: 0.75, tier: 'medium', reason: `check #${tcheckRaw} matches, but posted ${fUSDc(t.amount)}` };
    if (amtEqual && days <= 10) return { score: 0.7, tier: 'medium', reason: `${fUSDc(t.amount)} posted ${fDateStr(t.date)}` };
    if (amtEqual && days <= 30) return { score: 0.5, tier: 'low', reason: `amount matches, ${Math.round(days)}d off` };
    return { score: 0 };
  }

  function runMatcher(accountId, posted) {
    let items = loadPending(accountId);
    const used = new Set();
    const autoCleared = [];
    // pass 1: high-confidence -> auto-clear
    items.forEach(p => {
      let best = null;
      posted.forEach(t => { if (used.has(t.id)) return; const s = scoreMatch(p, t); if (s.score >= 0.9 && (!best || s.score > best.s.score)) best = { t, s }; });
      if (best) { used.add(best.t.id); autoCleared.push({ p, reason: best.s.reason }); }
    });
    if (autoCleared.length) { const ids = new Set(autoCleared.map(a => a.p.id)); items = items.filter(p => !ids.has(p.id)); savePending(accountId, items); }
    // pass 2: medium -> suggest (skip dismissed pairs)
    const suggestions = [];
    items.forEach(p => {
      const dismissed = new Set(p.dismissed || []);
      let best = null;
      posted.forEach(t => { if (used.has(t.id) || dismissed.has(t.id)) return; const s = scoreMatch(p, t); if (s.score >= 0.6 && s.score < 0.9 && (!best || s.score > best.s.score)) best = { t, s }; });
      if (best) { used.add(best.t.id); suggestions.push({ pendingId: p.id, tid: best.t.id, memo: p.memo, reason: best.s.reason }); }
    });
    return { autoCleared, suggestions };
  }

  // ---- hand-built DocumentNode for account-linked recurring occurrences ----
  const N = v => ({ kind: 'Name', value: v });
  const F = (name, sel, args) => { const f = { kind: 'Field', name: N(name) }; if (args) f.arguments = args; if (sel) f.selectionSet = { kind: 'SelectionSet', selections: sel }; return f; };
  const vDef = (n, t) => ({ kind: 'VariableDefinition', variable: { kind: 'Variable', name: N(n) }, type: { kind: 'NonNullType', type: { kind: 'NamedType', name: N(t) } } });
  const vArg = (n, vn) => ({ kind: 'Argument', name: N(n), value: { kind: 'Variable', name: N(vn) } });
  const OCC_DOC = { kind: 'Document', definitions: [{
    kind: 'OperationDefinition', operation: 'query', name: N('PB_RecurringOccurrences'),
    variableDefinitions: [vDef('startDate', 'Date'), vDef('endDate', 'Date')],
    selectionSet: { kind: 'SelectionSet', selections: [
      F('recurringTransactionItems', [F('date'), F('amount'), F('account', [F('id')]), F('stream', [F('id'), F('frequency'), F('amount'), F('name')])], [vArg('startDate', 'startDate'), vArg('endDate', 'endDate')]),
    ] },
  }] };

  function waitForApollo(timeout = 15000) {
    return new Promise((res, rej) => {
      const t0 = Date.now();
      (function chk() {
        if (window.__APOLLO_CLIENT__ && window.__APOLLO_CLIENT__.query) return res(window.__APOLLO_CLIENT__);
        if (Date.now() - t0 > timeout) return rej(new Error('Apollo client not available'));
        setTimeout(chk, 300);
      })();
    });
  }

  function harvestDoc(name) {
    try {
      const qm = window.__APOLLO_CLIENT__.queryManager; const found = [];
      if (qm.getObservableQueries) qm.getObservableQueries('all').forEach(oq => { if (oq && oq.query) found.push(oq.query); });
      if (qm.queries && qm.queries.forEach) qm.queries.forEach(i => { if (i.document) found.push(i.document); if (i.observableQuery && i.observableQuery.query) found.push(i.observableQuery.query); });
      return found.find(d => { try { return d.definitions.find(x => x.kind === 'OperationDefinition').name.value === name; } catch (e) { return false; } }) || null;
    } catch (e) { return null; }
  }

  function getStartBalance(client, accountId) {
    try { const ex = client.cache.extract(); for (const k in ex) { const o = ex[k]; if (o && o.id === accountId && ('currentBalance' in o)) return o.currentBalance; } } catch (e) { log('cache read failed', e); }
    const root = document.querySelector('[class*="AccountBalanceGraph__Root"]');
    const m = root && (root.textContent || '').match(/\$[\d,]+\.\d{2}/);
    return m ? parseFloat(m[0].replace(/[$,]/g, '')) : 0;
  }

  async function getOccurrences(client, accountId, horizonDays) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(+start + horizonDays * 864e5);
    const r = await client.query({ query: OCC_DOC, variables: { startDate: iso(start), endDate: iso(end) }, fetchPolicy: 'network-only' });
    const items = ((r.data && r.data.recurringTransactionItems) || []).filter(x => x.account && x.account.id === accountId);
    let occ = items.map(x => ({ date: new Date(x.date + 'T00:00:00'), amount: x.amount * AMOUNT_SIGN, streamId: x.stream && x.stream.id, freq: x.stream && x.stream.frequency, label: (x.stream && x.stream.name) || 'Recurring', kind: 'recurring' }));
    const furthest = occ.reduce((m, o) => Math.max(m, +o.date), +start);
    if (+end > furthest + 3 * 864e5 && occ.length) {
      const byStream = {};
      occ.forEach(o => { const id = o.streamId || ('a' + o.amount); if (!byStream[id] || o.date > byStream[id].last) byStream[id] = { last: o.date, amount: o.amount, days: FREQ_DAYS[String(o.freq || '').toLowerCase()] || 30, label: o.label }; });
      Object.values(byStream).forEach(s => { let d = new Date(+s.last + s.days * 864e5); while (+d <= +end) { occ.push({ date: new Date(+d), amount: s.amount, extrapolated: true, label: s.label, kind: 'recurring' }); d = new Date(+d + s.days * 864e5); } });
    }
    return occ;
  }

  async function queryTx(client, accountId, startDate, endDate) {
    const doc = harvestDoc('Web_GetTransactionsList');
    if (!doc) { log('transactions query not loaded yet'); return null; }
    const r = await client.query({ query: doc, variables: { offset: 0, limit: 500, orderBy: 'date', filters: { accounts: [accountId], startDate, endDate } }, fetchPolicy: 'network-only' });
    return (r.data && r.data.allTransactions && r.data.allTransactions.results) || [];
  }

  async function getFutureTx(client, accountId, horizonDays) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(+start + horizonDays * 864e5);
    const todayStr = iso(start);
    try {
      const res = await queryTx(client, accountId, iso(start), iso(end));
      if (!res) return [];
      return res.filter(t => t.date > todayStr && !t.isRecurring).map(t => ({ date: new Date(t.date + 'T00:00:00'), amount: t.amount * AMOUNT_SIGN, scenario: true, label: (t.merchant && t.merchant.name) || 'Future transaction', kind: 'future' }));
    } catch (e) { log('future tx fetch failed', e); return []; }
  }

  async function getPostedTx(client, accountId) {
    const end = new Date();
    const start = new Date(+end - LOOKBACK_DAYS * 864e5);
    try {
      const res = await queryTx(client, accountId, iso(start), iso(end));
      if (!res) return [];
      return res.map(t => ({ id: t.id, amount: t.amount, date: t.date, plaidName: t.plaidName, dataProviderDescription: t.dataProviderDescription }));
    } catch (e) { log('posted tx fetch failed', e); return []; }
  }

  function buildSeries(startBalance, events, horizonDays) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(+start + horizonDays * 864e5);
    const pts = [{ t: +start, b: startBalance }];
    let bal = startBalance;
    events.forEach(o => { if (o.date < start || o.date > end) return; bal += o.amount; pts.push({ t: +o.date, b: bal, scenario: o.scenario, pending: o.pending, extrapolated: o.extrapolated, label: o.label, amt: o.amount, kind: o.kind }); });
    pts.push({ t: +end, b: bal });
    return pts;
  }

  function draw(el, pts) {
    const W = el.clientWidth || 1000, H = 230, pl = 8, pr = 8, pt = 16, pb = 26;
    const xs = pts.map(p => p.t), ys = pts.map(p => p.b);
    const xn = Math.min(...xs), xx = Math.max(...xs);
    let yn = Math.min(...ys, 0), yx = Math.max(...ys); if (yn === yx) { yn -= 1; yx += 1; } const pd = (yx - yn) * .1; yn -= pd; yx += pd;
    const X = t => pl + (xx === xn ? 0 : (t - xn) / (xx - xn)) * (W - pl - pr), Y = v => pt + (1 - (v - yn) / (yx - yn)) * (H - pt - pb);
    const dip = Math.min(...ys) < 0, col = dip ? NEG : ACCENT, z = Y(0);
    let ln = ''; pts.forEach((p, i) => ln += (i ? 'L' : 'M') + X(p.t) + ' ' + Y(p.b) + ' ');
    const ar = ln + 'L' + X(xx) + ' ' + Y(yn) + ' L' + X(xn) + ' ' + Y(yn) + ' Z';
    let marks = '';
    pts.forEach(p => { if (p.scenario || p.pending) marks += `<circle cx="${X(p.t)}" cy="${Y(p.b)}" r="3.5" fill="${PENDING}"/>`; });
    let ticks = ''; const d0 = new Date(xn); d0.setDate(1); const ms = [];
    for (let d = new Date(d0); +d <= xx; d.setMonth(d.getMonth() + 1)) if (+d >= xn) ms.push(new Date(+d));
    const st = Math.max(1, Math.ceil(ms.length / 8));
    ms.forEach((m, i) => { if (i % st) return; ticks += `<text x="${X(+m)}" y="${H - 8}" fill="#9aa0a6" font-size="11" text-anchor="middle">${m.toLocaleDateString('en-US', { month: 'short', year: ms.length > 14 ? '2-digit' : undefined })}</text>`; });
    el.innerHTML = `<svg width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="display:block;width:100%;height:${H}px">
      <defs><linearGradient id="pbg" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="${col}" stop-opacity=".28"/><stop offset="100%" stop-color="${col}" stop-opacity=".02"/></linearGradient></defs>
      ${(z > pt && z < H - pb) ? `<line x1="${pl}" x2="${W - pr}" y1="${z}" y2="${z}" stroke="${NEG}" stroke-dasharray="4 4" opacity=".6"/>` : ''}
      <path d="${ar}" fill="url(#pbg)"/>
      <path d="${ln}" fill="none" stroke="${col}" stroke-width="2.5"/>
      ${marks}
      <line class="pb-guide" y1="${pt}" y2="${H - pb}" stroke="#9aa0a6" stroke-dasharray="3 3" style="display:none"/>
      <circle class="pb-dot" r="4.5" fill="#fff" stroke="${col}" stroke-width="2.5" style="display:none"/>
      ${ticks}
    </svg>`;
    el._pb = { pts, xn, xx, yn, yx, pl, pr, pt, pb, W, H, col };
  }

  function onMove(chart, e) {
    const plot = chart.querySelector('.pb-plot'), tip = chart.querySelector('.pb-tip');
    const d = plot && plot._pb; if (!d) return;
    const svg = plot.querySelector('svg'); if (!svg) return;
    const rect = svg.getBoundingClientRect();
    let vx = (e.clientX - rect.left) * (d.W / rect.width);
    vx = Math.max(d.pl, Math.min(d.W - d.pr, vx));
    const time = d.xn + (d.W - d.pl - d.pr === 0 ? 0 : (vx - d.pl) / (d.W - d.pl - d.pr)) * (d.xx - d.xn);
    const pts = d.pts; let bal = pts[pts.length - 1].b;
    for (let i = 0; i < pts.length - 1; i++) { if (time >= pts[i].t && time <= pts[i + 1].t) { const span = pts[i + 1].t - pts[i].t; const f = span ? (time - pts[i].t) / span : 0; bal = pts[i].b + f * (pts[i + 1].b - pts[i].b); break; } }
    const X = t => d.pl + (d.xx === d.xn ? 0 : (t - d.xn) / (d.xx - d.xn)) * (d.W - d.pl - d.pr);
    const Y = v => d.pt + (1 - (v - d.yn) / (d.yx - d.yn)) * (d.H - d.pt - d.pb);
    const dvx = X(time), dvy = Y(bal);
    const guide = svg.querySelector('.pb-guide'), dot = svg.querySelector('.pb-dot');
    guide.setAttribute('x1', dvx); guide.setAttribute('x2', dvx); guide.style.display = '';
    dot.setAttribute('cx', dvx); dot.setAttribute('cy', dvy); dot.style.display = '';
    const thr = 14 * (d.W / rect.width);
    const near = d.pts.filter(p => p.label && Math.abs(X(p.t) - vx) <= thr);
    let evHtml = '';
    if (near.length) {
      evHtml = '<div style="margin-top:5px;padding-top:5px;border-top:1px solid #eee">' +
        near.slice(0, 4).map(p => { const out = p.amt < 0; return `<div style="font-size:11px;line-height:1.5"><span style="color:${out ? NEG : POS};font-weight:600">${out ? '' : '+'}${fUSDc(p.amt)}</span> <span style="color:#444">${esc(String(p.label).slice(0, 28))}</span></div>`; }).join('') +
        (near.length > 4 ? `<div style="font-size:11px;color:#9aa0a6">+${near.length - 4} more</div>` : '') + '</div>';
    }
    const sx = dvx * rect.width / d.W;
    tip.style.display = 'block';
    tip.style.left = Math.max(0, Math.min(rect.width - 170, sx - 54)) + 'px';
    tip.innerHTML = `<div style="font-weight:600;font-size:13px">${fUSDc(bal)}</div><div style="color:#9aa0a6;font-size:11px">${fDate(time)}</div>${evHtml}`;
  }
  function onLeave(chart) {
    const plot = chart.querySelector('.pb-plot'), tip = chart.querySelector('.pb-tip');
    const svg = plot && plot.querySelector('svg'); if (svg) { const g = svg.querySelector('.pb-guide'), d = svg.querySelector('.pb-dot'); if (g) g.style.display = 'none'; if (d) d.style.display = 'none'; }
    if (tip) tip.style.display = 'none';
  }

  // -------------------------------------------------------------- injection
  const CARD_ID = 'projbal-card';
  const state = { accountId: null, horizonDays: 91 };

  function findBalanceCard() {
    const root = document.querySelector('[class*="AccountBalanceGraph__Root"]');
    if (!root) return null;
    return { root, card: root.closest('[class*="Card__CardRoot"]') || root };
  }

  function renderPendingList(wrap) {
    const list = wrap.querySelector('.pb-pending-list'); if (!list) return;
    const items = loadPending(state.accountId);
    if (!items.length) { list.innerHTML = `<div style="font-size:12px;color:#9aa0a6;padding:6px 0">No pending transactions tracked. Add one the moment you commit money that hasn't posted yet.</div>`; return; }
    list.innerHTML = items.slice().sort((a, b) => (a.clear < b.clear ? -1 : 1)).map(p => {
      const out = p.amount < 0;
      return `<div class="pb-pend-row" style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;font-size:13px;border-bottom:1px solid #f3f4f6">
        <span><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${PENDING};margin-right:8px;vertical-align:middle"></span>${esc(p.memo || 'Item')} <span style="color:#9aa0a6;font-size:11px">${esc(p.type || 'other')}${p.check ? (' #' + esc(p.check)) : ''} · clears ${fDateStr(p.clear)}</span></span>
        <span><span style="color:${out ? NEG : POS};font-weight:600">${out ? '' : '+'}${fUSDc(p.amount)}</span> <button class="pb-pend-del" data-id="${esc(p.id)}" title="Clear / remove" style="border:none;background:none;color:#9aa0a6;cursor:pointer;font-size:16px;margin-left:10px;line-height:1">×</button></span>
      </div>`;
    }).join('');
    list.querySelectorAll('.pb-pend-del').forEach(b => b.addEventListener('click', () => {
      const id = b.getAttribute('data-id');
      savePending(state.accountId, loadPending(state.accountId).filter(x => String(x.id) !== String(id)));
      renderPendingList(wrap); refresh();
    }));
  }

  function renderReview(wrap, autoCleared, suggestions) {
    const box = wrap.querySelector('.pb-review'); if (!box) return;
    let html = '';
    (autoCleared || []).forEach(a => { html += `<div style="font-size:12px;color:${POS};padding:4px 0">✓ Auto-cleared “${esc(a.p.memo || 'item')}” — matched ${esc(a.reason)}</div>`; });
    (suggestions || []).forEach(s => {
      html += `<div class="pb-sugg" data-pid="${esc(s.pendingId)}" data-tid="${esc(s.tid)}" style="background:#fff8e1;border:1px solid #ffe08a;border-radius:8px;padding:8px 10px;margin:6px 0;font-size:12px">
        <div style="margin-bottom:6px">Possible match for <b>${esc(s.memo || 'item')}</b>: ${esc(s.reason)}. Clear it?</div>
        <button class="pb-sugg-yes" style="padding:4px 12px;background:${POS};color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;margin-right:6px">Confirm</button>
        <button class="pb-sugg-no" style="padding:4px 12px;background:#fff;color:#6b7280;border:1px solid #dadce0;border-radius:6px;font-size:12px;cursor:pointer">Not it</button>
      </div>`;
    });
    box.innerHTML = html;
    box.querySelectorAll('.pb-sugg').forEach(el => {
      const pid = el.getAttribute('data-pid'), tid = el.getAttribute('data-tid');
      el.querySelector('.pb-sugg-yes').addEventListener('click', () => {
        savePending(state.accountId, loadPending(state.accountId).filter(x => String(x.id) !== String(pid)));
        renderPendingList(wrap); refresh();
      });
      el.querySelector('.pb-sugg-no').addEventListener('click', () => {
        const items = loadPending(state.accountId); const it = items.find(x => String(x.id) === String(pid));
        if (it) { it.dismissed = (it.dismissed || []).concat(tid); savePending(state.accountId, items); }
        el.remove();
      });
    });
  }

  async function refresh() {
    const wrap = document.getElementById(CARD_ID); if (!wrap) return;
    const plot = wrap.querySelector('.pb-plot'), end = wrap.querySelector('.pb-end'), sub = wrap.querySelector('.pb-sub');
    plot.innerHTML = `<div style="padding:40px;text-align:center;color:#9aa0a6">Projecting…</div>`;
    try {
      const client = await waitForApollo();
      const startBal = getStartBalance(client, state.accountId);
      const [occ, futureTx, posted] = await Promise.all([
        getOccurrences(client, state.accountId, state.horizonDays),
        getFutureTx(client, state.accountId, state.horizonDays),
        getPostedTx(client, state.accountId),
      ]);
      const { autoCleared, suggestions } = runMatcher(state.accountId, posted);
      const pend = pendingEvents(state.accountId);
      const events = occ.concat(futureTx, pend).sort((a, b) => a.date - b.date);
      const pts = buildSeries(startBal, events, state.horizonDays);
      const endBal = pts[pts.length - 1].b, low = Math.min(...pts.map(p => p.b)), lowP = pts.find(p => p.b === low);
      log('acct', state.accountId, 'start', startBal, 'recurring', occ.length, 'future', futureTx.length, 'pending', pend.length, 'autoCleared', autoCleared.length, 'suggest', suggestions.length);
      draw(plot, pts);
      const dl = endBal - startBal;
      end.innerHTML = `${fUSDc(endBal)} <span style="font-size:14px;color:${dl >= 0 ? POS : NEG}">${dl >= 0 ? '↗' : '↘'} ${fUSDc(Math.abs(dl))} projected</span>`;
      sub.textContent = `${occ.length} recurring${futureTx.length ? ` · ${futureTx.length} future` : ''}${pend.length ? ` · ${pend.length} pending` : ''} · low point ${fUSD(low)} on ${fDate(lowP.t)}` + (events.some(o => o.extrapolated) ? ' · long horizon extrapolated' : '');
      renderPendingList(wrap);
      renderReview(wrap, autoCleared, suggestions);
    } catch (e) {
      plot.innerHTML = `<div style="padding:30px;text-align:center;color:${NEG}">Projection error: ${e.message}</div>`;
      log('error', e);
    }
  }

  function inject() {
    if (document.getElementById(CARD_ID)) return;
    const found = findBalanceCard(); if (!found) return;
    const subCls = (document.querySelector('[class*="AccountBalanceGraph__HeaderSubt"]') || {}).className || '';
    const wrap = document.createElement('div');
    wrap.id = CARD_ID; wrap.className = found.card.className;
    wrap.style.marginTop = '16px'; if (!wrap.style.padding) wrap.style.padding = '20px';
    const opts = HORIZONS.map(([l, d]) => `<option value="${d}" ${d === state.horizonDays ? 'selected' : ''}>${l}</option>`).join('');
    const typeOpts = TYPES.map(t => `<option value="${t}">${t}</option>`).join('');
    const inp = 'padding:6px 8px;border:1px solid #dadce0;border-radius:6px;font-size:13px;background:#fff';
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px">
        <div style="display:flex;flex-direction:column">
          <span class="${subCls}" style="letter-spacing:.06em">PROJECTED BALANCE</span>
          <span class="pb-end" style="font-size:26px;font-weight:600;line-height:1.2">—</span>
          <span class="pb-sub" style="font-size:12px;color:#9aa0a6"></span>
        </div>
        <select class="pb-range" style="padding:6px 10px;border:1px solid #dadce0;border-radius:8px;background:#fff;font-size:13px;cursor:pointer">${opts}</select>
      </div>
      <div class="pb-chart" style="position:relative">
        <div class="pb-plot"></div>
        <div class="pb-tip" style="position:absolute;top:2px;pointer-events:none;background:#fff;border:1px solid #e0e0e0;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.12);padding:6px 10px;display:none;white-space:nowrap;z-index:5"></div>
      </div>
      <div class="pb-pending" style="margin-top:16px;border-top:1px solid #eee;padding-top:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:12px;letter-spacing:.06em;color:#6b7280;font-weight:600">PENDING TRANSACTIONS</span>
          <button class="pb-add-toggle" style="padding:4px 12px;border:1px solid #dadce0;border-radius:8px;background:#fff;font-size:13px;cursor:pointer">+ Add</button>
        </div>
        <div class="pb-review"></div>
        <div class="pb-pending-list"></div>
        <div class="pb-pending-form" style="display:none;margin-top:10px;padding:12px;background:#fafafa;border:1px solid #eee;border-radius:8px">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <select class="pb-f-dir" style="${inp}"><option value="out">Money out</option><option value="in">Money in</option></select>
            <input class="pb-f-amt" type="number" step="0.01" placeholder="Amount" style="width:100px;${inp}">
            <select class="pb-f-type" style="${inp}">${typeOpts}</select>
            <input class="pb-f-clear" type="date" title="Expected clear date" style="${inp}">
            <input class="pb-f-memo" type="text" placeholder="Payee / memo" style="flex:1;min-width:130px;${inp}">
            <input class="pb-f-check" type="text" placeholder="Check / ref #" style="width:100px;${inp}">
            <button class="pb-pend-add" style="padding:6px 14px;background:#1a6b5f;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer">Add</button>
          </div>
          <div style="font-size:11px;color:#9aa0a6;margin-top:6px">Log anything committed but not yet posted. Enter the expected clear date — it rides the projection until then, and the matcher clears it when the real transaction posts (a check # makes that automatic).</div>
        </div>
      </div>`;
    found.card.parentElement.insertBefore(wrap, found.card.nextSibling);
    const chart = wrap.querySelector('.pb-chart');
    chart.addEventListener('mousemove', e => onMove(chart, e));
    chart.addEventListener('mouseleave', () => onLeave(chart));
    wrap.querySelector('.pb-range').addEventListener('change', e => { state.horizonDays = +e.target.value; refresh(); });

    const form = wrap.querySelector('.pb-pending-form');
    wrap.querySelector('.pb-add-toggle').addEventListener('click', () => { form.style.display = form.style.display === 'none' ? 'block' : 'none'; });
    wrap.querySelector('.pb-pend-add').addEventListener('click', () => {
      const amt = parseFloat(form.querySelector('.pb-f-amt').value);
      const clr = form.querySelector('.pb-f-clear').value;
      if (!amt || !clr) { form.querySelector('.pb-f-amt').style.borderColor = amt ? '#dadce0' : NEG; form.querySelector('.pb-f-clear').style.borderColor = clr ? '#dadce0' : NEG; return; }
      const dir = form.querySelector('.pb-f-dir').value;
      const signed = dir === 'in' ? Math.abs(amt) : -Math.abs(amt);
      const item = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), amount: signed, clear: clr, written: iso(new Date()), type: form.querySelector('.pb-f-type').value, check: (form.querySelector('.pb-f-check').value || '').trim() || null, memo: (form.querySelector('.pb-f-memo').value || '').trim() || 'Item', dismissed: [] };
      const items = loadPending(state.accountId); items.push(item); savePending(state.accountId, items);
      ['.pb-f-amt', '.pb-f-clear', '.pb-f-memo', '.pb-f-check'].forEach(s => { form.querySelector(s).value = ''; form.querySelector(s).style.borderColor = '#dadce0'; });
      form.style.display = 'none';
      renderPendingList(wrap); refresh();
    });

    renderPendingList(wrap);
    log('card injected for', state.accountId);
    refresh();
  }

  // ---------------------------------------------------------------- routing
  const acctId = () => { const m = location.pathname.match(/\/accounts\/details\/(\d+)/); return m ? m[1] : null; };
  function maybeInject() {
    const id = acctId(), existing = document.getElementById(CARD_ID);
    if (!id) { if (existing) existing.remove(); state.accountId = null; return; }
    if (id !== state.accountId && existing) existing.remove();
    state.accountId = id;
    if (!document.getElementById(CARD_ID)) inject();
  }
  ['pushState', 'replaceState'].forEach(fn => { const o = history[fn]; history[fn] = function () { const r = o.apply(this, arguments); window.dispatchEvent(new Event('pb:loc')); return r; }; });
  window.addEventListener('popstate', () => window.dispatchEvent(new Event('pb:loc')));
  window.addEventListener('pb:loc', () => setTimeout(maybeInject, 300));
  new MutationObserver(() => { if (acctId() && !document.getElementById(CARD_ID)) maybeInject(); }).observe(document.documentElement, { childList: true, subtree: true });
  async function boot() {
    try { const s = await _bridge('init'); if (s) { STORE = s.data || {}; if (s.settings && typeof s.settings.debug === 'boolean') DEBUG = s.settings.debug; } } catch (e) { }
    const w = document.getElementById(CARD_ID);
    if (w) { renderPendingList(w); refresh(); } else { maybeInject(); }
    log('booted (extension)');
  }
  boot();
})();
