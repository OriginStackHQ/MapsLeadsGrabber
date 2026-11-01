/**
 * content.js - runs in the extension's isolated world.
 *
 * 1. At document_start, injects page.js into the page JS world (where the
 *    Maps network calls live) via chrome.runtime.getURL.
 * 2. Listens for lead batches posted by page.js, dedupes them, and stores
 *    them in chrome.storage.local (the dashboard page reads from there).
 * 3. Builds a minimal overlay panel. All EXPORTS live in dashboard.html.
 */

(() => {
  'use strict';

  // ---------------------------------------------------------------
  // 1. Inject page.js into the page world (needed to hook Maps' XHR).
  // ---------------------------------------------------------------
  const inject = document.createElement('script');
  inject.src = chrome.runtime.getURL('page.js');
  inject.onload = () => inject.remove();
  (document.head || document.documentElement).appendChild(inject);

  // ---------------------------------------------------------------
  // 2. Lead store (chrome.storage.local - shared with dashboard.html)
  // ---------------------------------------------------------------
  const leads = [];
  const seen = new Set();

  // Page-load policy: unless "Keep previous leads" is ticked, every Maps
  // page load starts a fresh session and the previous scrape is wiped.
  // With it ticked, stored leads come back into memory (dedupe set
  // included), so several searches can build one list - the dashboard
  // reads the same storage. Captures are saved only after this step
  // finishes (the "loaded" guard), so kept rows can never be overwritten
  // mid-load.
  let loaded = false;
  chrome.storage.local.get('keepLeads', (setting) => {
    if (setting && setting.keepLeads === true) {
      chrome.storage.local.get('leads', (res) => {
        for (const lead of (res && res.leads) || []) addLead(lead, false);
        loaded = true;
        updateStatus();
      });
    } else {
      chrome.storage.local.set({ leads: [] }, () => {
        loaded = true;
        updateStatus();
      });
    }
  });

  function persist() {
    chrome.storage.local.set({ leads });
  }

  function dedupeKey(lead) {
    return lead.placeID || `${lead.name}|${lead.address}`;
  }

  // The term currently searched, from /maps/search/<term>/ in the URL
  // ("plumbers+in+Pune" -> "plumbers in Pune"). Empty if not a search URL.
  function currentSearchTerm() {
    const m = (location.pathname || '').match(/\/maps\/search\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  }

  function addLead(lead, save = true) {
    if (!lead || (!lead.name && !lead.phone && !lead.website)) return false;
    const key = dedupeKey(lead);
    if (seen.has(key)) return false;
    seen.add(key);
    if (save) lead.searchTerm = currentSearchTerm();
    leads.push(lead);
    if (save && loaded) persist();
    return true;
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    if (ev.data && ev.data.type === 'mlg-leads') {
      try {
        const batch = JSON.parse(ev.data.data);
        let added = 0;
        for (const lead of batch) if (addLead(lead)) added++;
        if (added && loaded) {
          persist();
          updateStatus();
        }
      } catch (e) {
        console.warn('[MLG] bad lead batch', e);
      }
    }
  });

  // ---------------------------------------------------------------
  // 3. Overlay UI (scrape controls only - exporting happens in the dashboard)
  // ---------------------------------------------------------------
  const STYLE = `
    #mlg-panel {
      --p-bg: #ffffff;
      --p-text: #1f2328;
      --p-muted: #656d76;
      --p-title: #1a73e8;
      --p-border: #d0d7de;
      --p-shadow: rgba(0, 0, 0, 0.18);
      --p-green: #188038;            /* Start Auto Extract */
      --p-red: #d93025;              /* running / Stop */
      --p-amber: #f9ab00;            /* Open Dashboard */
      --p-blue-btn: #4167b2;         /* Clear */
      --p-on-accent: #ffffff;        /* text on green/red/blue buttons */
      --p-on-accent-strong: #202124; /* text on the amber button */
      position: fixed; top: 70px; right: 12px; z-index: 2147483647;
      background: var(--p-bg); color: var(--p-text);
      border: 1px solid var(--p-border);
      border-radius: 10px; padding: 12px 14px;
      font: 13px/1.4 Roboto, Arial, sans-serif;
      box-shadow: 0 4px 18px var(--p-shadow);
      width: 190px; user-select: none;
    }
    @media (prefers-color-scheme: dark) {
      #mlg-panel {
        --p-bg: #202124;
        --p-text: #e8eaed;
        --p-muted: #9aa0a6;
        --p-title: #8ab4f8;
        --p-border: #3c4043;
        --p-shadow: rgba(0, 0, 0, 0.45);
        --p-green: #1e8e3e;
        --p-red: #e25444;
        --p-amber: #fbbc04;
        --p-on-accent: #ffffff;
        --p-on-accent-strong: #202124;
      }
    }
    #mlg-panel h3 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: var(--p-title); }
    #mlg-panel .mlg-status { margin: 0 0 8px; color: var(--p-muted); font-size: 12px; }
    #mlg-panel button {
      display: block; width: 100%; margin: 5px 0; padding: 7px 8px;
      border: none; border-radius: 6px; cursor: pointer;
      font: 12px/1 Roboto, Arial, sans-serif; color: var(--p-on-accent);
    }
    #mlg-start { background: var(--p-green); }
    #mlg-start.mlg-running { background: var(--p-red); }
    #mlg-dash  { background: var(--p-amber); color: var(--p-on-accent-strong); font-weight: 600; }
    #mlg-clear { background: var(--p-blue-btn); }
    #mlg-panel button:hover { filter: brightness(1.15); }
    #mlg-panel .mlg-keep {
      display: block; margin: 0 0 6px;
      font-size: 11px; cursor: pointer; user-select: none;
      color: var(--p-text);
    }
    #mlg-panel .mlg-keep input { vertical-align: middle; margin: 0 4px 2px 0; }
    #mlg-hint { margin: 8px 0 0; font-size: 10px; color: var(--p-muted); }
  `;

  function buildUI() {
    if (document.getElementById('mlg-panel')) return;

    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'mlg-panel';
    panel.innerHTML = `
      <h3>Maps Lead Grabber</h3>
      <p class="mlg-status" id="mlg-status">Leads: ${leads.length}</p>
      <label class="mlg-keep"><input type="checkbox" id="mlg-keep"> Keep previous leads</label>
      <button id="mlg-start">Start Auto Extract</button>
      <button id="mlg-dash">Open Dashboard</button>
      <button id="mlg-clear">Clear</button>
      <p id="mlg-hint">Export CSV / Excel / JSON from the Dashboard.</p>
    `;
    document.body.appendChild(panel);

    document.getElementById('mlg-start').addEventListener('click', onStartClick);
    document.getElementById('mlg-dash').addEventListener('click', () => {
      window.open(chrome.runtime.getURL('dashboard.html'), '_blank');
    });
    // "Keep previous leads" - value takes effect on the NEXT page load;
    // changing it mid-session only saves, nothing is wiped or reloaded.
    const keep = document.getElementById('mlg-keep');
    chrome.storage.local.get('keepLeads', (res) => {
      keep.checked = !!(res && res.keepLeads === true);
    });
    keep.addEventListener('change', () => {
      chrome.storage.local.set({ keepLeads: keep.checked });
    });
    // Clear always wipes everything, regardless of the toggle.
    document.getElementById('mlg-clear').addEventListener('click', () => {
      leads.length = 0;
      seen.clear();
      chrome.storage.local.remove('leads');
      updateStatus();
    });

    updateStatus();
  }

  function updateStatus() {
    const el = document.getElementById('mlg-status');
    const btn = document.getElementById('mlg-start');
    if (el) el.textContent = `Leads: ${leads.length}`;
    if (btn && !running) btn.textContent = 'Start Auto Extract';
  }

  // ---------------------------------------------------------------
  // 4. Auto-extract: scroll the results feed so Maps loads every batch
  // ---------------------------------------------------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let running = false;

  async function waitFor(selector, timeout = 15000) {
    const t0 = Date.now();
    for (;;) {
      const el = document.querySelector(selector);
      if (el) return el;
      if (Date.now() - t0 > timeout) return null;
      await sleep(400);
    }
  }

  function resetButton(btn) {
    btn.textContent = 'Start Auto Extract';
    btn.classList.remove('mlg-running');
  }

  async function onStartClick(e) {
    const btn = e.target;

    if (running) {
      running = false;
      resetButton(btn);
      return;
    }

    running = true;
    btn.textContent = 'Stop Auto Extract';
    btn.classList.add('mlg-running');

    // If no results feed is open yet, trigger the search once.
    let feed = document.querySelector('div[role="feed"]');
    if (!feed) {
      const searchBtn =
        document.querySelector('button[aria-label*="Search"]') ||
        document.querySelector('div[role="search"] button');
      if (searchBtn) {
        searchBtn.click();
        await sleep(3000);
      }
    }
    feed = await waitFor('div[role="feed"]');
    if (!feed) {
      alert('Open a Google Maps search first, then press Start.');
      running = false;
      resetButton(btn);
      return;
    }

    // Scroll to the bottom until: the end banner appears, the feed stops
    // growing for a while, or you press Stop.
    let unchanged = 0;
    let lastHeight = -1;
    while (running) {
      feed = document.querySelector('div[role="feed"]');
      if (!feed || !feed.isConnected) break; // user navigated away

      feed.scrollTop = feed.scrollHeight;
      await sleep(1000 + Math.floor(Math.random() * 2000)); // polite pacing

      // "You've reached the end of the list." banner
      if (document.querySelector('.HlvSq')) break;

      if (feed.scrollHeight === lastHeight) {
        if (++unchanged >= 20) break; // stalled
      } else {
        unchanged = 0;
        lastHeight = feed.scrollHeight;
      }
    }

    running = false;
    resetButton(btn);
    updateStatus();
  }

  // ---------------------------------------------------------------
  // 5. Boot
  // ---------------------------------------------------------------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildUI);
  } else {
    buildUI();
  }
})();
