/**
 * dashboard.js - lead table + Filter Builder + CSV / XLSX / JSON export.
 *
 * The filter's single structure (filterEngine.js format) flows straight from
 * the builder: prune incomplete rows -> validate -> JSON textarea -> status
 * -> render. The table AND all three exports use the same filtered set.
 */

'use strict';

const PREFERRED_FIELDS = [
  'name',
  'searchTerm',
  'phone',
  'website',
  'address',
  'category',
  'rating',
  'reviews',
  'placeID',
  'cid',
  'latitude',
  'longitude',
  'hours',
];
const FILTER_KEY = 'mapsLeadGrabber.filter';

const { OPS, validateFilter, filterData } = window.FilterEngine;
const Builder = window.FilterBuilder;

// Example: (website isEmpty AND name isNotEmpty) OR category equals 'tech'
const EXAMPLE_STATE = {
  logic: 'or',
  children: [
    {
      logic: 'and',
      children: [
        { field: 'website', op: 'isEmpty' },
        { field: 'name', op: 'isNotEmpty' },
      ],
    },
    { field: 'category', op: 'equals', value: 'tech' },
  ],
};

let allLeads = [];
let activeFilter = null;

// ------------------------------------------------------------------
// Load + live refresh
// ------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  Builder.init({
    mount: '#filter-builder',
    getColumns: () => collectColumns(allLeads),
    state: loadSaved(),
    onChange: applyFilter,
  });

  chrome.storage.local.get('leads', (res) => {
    allLeads = (res && res.leads) || [];
    render();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.leads) {
      allLeads = changes.leads.newValue || [];
      render();
    }
  });

  bindActions();
});

function loadSaved() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(FILTER_KEY) || 'null');
  } catch (e) {
    /* ignore */
  }
  if (saved) {
    try {
      validateFilter(saved);
    } catch (e) {
      saved = null;
    }
  }
  activeFilter = saved; // a valid saved filter applies immediately
  return saved;
}

// ------------------------------------------------------------------
// Filter application: prune -> build -> text -> status -> render
// Called by every action: UI change, Apply JSON, Example, Clear.
// ------------------------------------------------------------------
function applyFilter() {
  let active = null;
  try {
    active = prune(Builder.getState());
    if (active) validateFilter(active);
  } catch (e) {
    setFilterStatus(e.message, 'err');
    render();
    return;
  }

  activeFilter = active;
  const json = active ? JSON.stringify(active, null, 2) : '';
  document.getElementById('filter-input').value = json;
  try {
    if (active) localStorage.setItem(FILTER_KEY, json);
    else localStorage.removeItem(FILTER_KEY);
  } catch (e) {
    /* ignore */
  }
  setFilterStatus(active ? 'Filter applied.' : 'No filter - showing all rows.', 'ok');
  render();
}

/** Copy of the state minus incomplete rows (no column / empty value). */
function prune(node) {
  if (Array.isArray(node.children)) {
    const kids = node.children.map(prune).filter(Boolean);
    return kids.length ? { logic: node.logic, children: kids } : null;
  }
  if (!node.field || !OPS[node.op]) return null;
  if (OPS[node.op].needsValue && !node.value) return null;
  const out = { field: node.field, op: node.op };
  if (OPS[node.op].needsValue) out.value = node.value;
  return out;
}

function applyJson() {
  const raw = document.getElementById('filter-input').value.trim();
  if (!raw) return clearFilter();
  try {
    const parsed = JSON.parse(raw);
    validateFilter(parsed); // throws on bad JSON/shape - state stays intact
    Builder.setState(parsed);
    applyFilter();
  } catch (e) {
    setFilterStatus(e.message, 'err');
  }
}

function clearFilter() {
  Builder.setState({ logic: 'and', children: [Builder.newCond()] });
  applyFilter();
}

function loadExample() {
  Builder.setState(JSON.parse(JSON.stringify(EXAMPLE_STATE)));
  applyFilter();
}

function setFilterStatus(message, kind) {
  const el = document.getElementById('filter-status');
  if (!message) {
    el.textContent = '';
  } else {
    el.textContent = (kind === 'err' ? '✕ ' : '✓ ') + message;
    el.className = 'filter-status ' + (kind === 'err' ? 'err' : 'ok');
  }
}

// ------------------------------------------------------------------
// Table rendering
// ------------------------------------------------------------------
function collectColumns(rows) {
  const union = new Set();
  for (const r of rows) for (const k of Object.keys(r)) union.add(k);
  const cols = PREFERRED_FIELDS.filter((f) => union.has(f));
  for (const f of [...union].sort()) {
    if (!cols.includes(f)) cols.push(f);
  }
  return cols.length ? cols : PREFERRED_FIELDS;
}

function filteredRows() {
  let rows = allLeads;
  if (activeFilter) rows = filterData(rows, activeFilter);
  const q = (document.getElementById('search').value || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    Object.values(r).some((v) => String(v == null ? '' : v).toLowerCase().includes(q))
  );
}

function render() {
  const rows = filteredRows();
  const cols = collectColumns(allLeads);

  const head = document.getElementById('table-head');
  head.innerHTML = '';
  const hr = document.createElement('tr');
  for (const c of cols) {
    const th = document.createElement('th');
    th.textContent =
      c === 'cid' ? 'CID' : c.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
    hr.appendChild(th);
  }
  const actionsTh = document.createElement('th');
  actionsTh.textContent = 'Maps Link';
  hr.appendChild(actionsTh);
  head.appendChild(hr);

  const body = document.getElementById('table-body');
  body.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    for (const c of cols) {
      const td = document.createElement('td');
      td.textContent = r[c] == null ? '' : String(r[c]);
      tr.appendChild(td);
    }
    const td = document.createElement('td');
    if (r && r.placeID) {
      const a = document.createElement('a');
      a.href = `https://www.google.com/maps/place/?q=place_id:${r.placeID}`;
      a.target = '_blank';
      a.textContent = 'open';
      td.appendChild(a);
    }
    tr.appendChild(td);
    body.appendChild(tr);
  }

  const empty = document.getElementById('empty');
  document.getElementById('summary').textContent = allLeads.length
    ? `Leads: ${rows.length} shown (of ${allLeads.length})`
    : 'Leads: 0';
  empty.hidden = !!allLeads.length;
}

// ------------------------------------------------------------------
// Export helpers (CSV keeps a UTF-8 BOM so Excel opens it correctly)
// ------------------------------------------------------------------
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes()
  )}`;
}

function makeCSV(rows, cols) {
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const lines = [cols.map(esc).join(',')];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(','));
  return '\uFEFF' + lines.join('\r\n');
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function makeSheet(rows, cols) {
  const data = rows.map((r) => {
    const o = {};
    for (const c of cols) o[c] = r[c] == null ? '' : String(r[c]);
    return o;
  });
  const sheet = XLSX.utils.json_to_sheet(data, { header: cols });
  sheet['!cols'] = cols.map((c) => ({
    wch: Math.min(
      45,
      Math.max(c.length + 2, ...rows.slice(0, 120).map((r) => String(r[c] || '').length + 2))
    ),
  }));
  return sheet;
}

// ------------------------------------------------------------------
// Action buttons
// ------------------------------------------------------------------
function bindActions() {
  document.getElementById('search').addEventListener('input', render);

  document.getElementById('example-filter').addEventListener('click', loadExample);
  document.getElementById('clear-filter').addEventListener('click', clearFilter);
  document.getElementById('apply-json').addEventListener('click', applyJson);

  document.getElementById('export-csv').addEventListener('click', () => {
    const rows = filteredRows();
    if (!rows.length) return alert('Nothing to export.');
    download(`maps-leads-${stamp()}.csv`, makeCSV(rows, collectColumns(rows)), 'text/csv');
  });

  document.getElementById('export-xlsx').addEventListener('click', () => {
    const rows = filteredRows();
    if (!rows.length) return alert('Nothing to export.');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, makeSheet(rows, collectColumns(rows)), 'Leads');
    XLSX.writeFile(wb, `maps-leads-${stamp()}.xlsx`);
  });

  document.getElementById('export-json').addEventListener('click', () => {
    const rows = filteredRows();
    if (!rows.length) return alert('Nothing to export.');
    download(`maps-leads-${stamp()}.json`, JSON.stringify(rows, null, 2), 'application/json');
  });

  document.getElementById('clear').addEventListener('click', () => {
    if (!confirm('Delete all captured leads?')) return;
    allLeads = [];
    chrome.storage.local.remove('leads');
    // Full reset: search text + saved filter + builder all back to clean
    document.getElementById('search').value = '';
    clearFilter();
  });
}
