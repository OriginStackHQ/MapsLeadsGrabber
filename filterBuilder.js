/**
 * filterBuilder.js - interactive Filter Builder UI. Browser only.
 *
 * The builder's state IS the filter JSON (same structure as filterEngine.js
 * evaluates) - there are no converters. Structural changes re-render; the
 * value input notifies the dashboard (debounced) without re-rendering, so
 * typing keeps focus.
 */

(function (global) {
  'use strict';

  let state = null;
  let mountEl = null;
  let opts = null; // { getColumns, onChange }

  const OPS = global.FilterEngine.OPS;

  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function textEl(t) {
    const e = el('span', 'builder-text');
    e.textContent = t;
    return e;
  }

  function debounce(fn, ms) {
    let t = null;
    return () => {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  function newCond() {
    const cols = opts ? opts.getColumns() : [];
    return { field: cols[0] || '', op: 'isNotEmpty', value: '' };
  }

  /** Any change: re-render (structural ones) and tell the dashboard. */
  function changed(structural = true) {
    if (structural) render();
    if (opts.onChange) opts.onChange();
  }

  function render() {
    if (!mountEl || !state) return;
    mountEl.innerHTML = '';
    mountEl.appendChild(renderNode(state, null, 0));
  }

  function renderNode(node, parent, index) {
    return Array.isArray(node.children)
      ? renderGroup(node, parent, index)
      : renderCond(node, parent, index);
  }

  function renderGroup(node, parent, index) {
    const box = el('div', parent ? 'group-block' : 'fb-top');
    const many = node.children.length > 1;

    // "Match X of the following:" only makes sense for 2+ children - a
    // single condition just shows its own row. Nested groups keep their
    // remove button (right-aligned when the bar has no label).
    if (many || parent) {
      const bar = el('div', 'group-bar ' + (many && !parent ? 'top' : 'nested'));
      if (many) {
        bar.appendChild(textEl('Match'));
        bar.appendChild(logicSelect(node));
        bar.appendChild(textEl('of the following:'));
      }
      if (parent) {
        const rm = removeBtn(() => { parent.children.splice(index, 1); changed(); });
        if (!many) rm.style.marginLeft = 'auto';
        bar.appendChild(rm);
      }
      box.appendChild(bar);
    }

    node.children.forEach((c, i) => box.appendChild(renderNode(c, node, i)));

    const btns = el('div', 'fb-group-buttons');
    btns.appendChild(addBtn('+ Add Condition', () => { node.children.push(newCond()); changed(); }));
    btns.appendChild(addBtn('+ Add Nested Group', () => {
      node.children.push({ logic: 'and', children: [newCond()] });
      changed();
    }));
    box.appendChild(btns);
    return box;
  }

  function renderCond(node, parent, index) {
    const line = el('div', 'cond-line');
    const row = el('div', 'cond-row');

    // column
    const fsel = el('select', 'f-field');
    const cols = opts.getColumns();
    if (!cols.includes(node.field)) {
      const ph = el('option');
      ph.value = '';
      ph.textContent = '— select column —';
      fsel.appendChild(ph);
    }
    cols.forEach((c) => {
      const o = el('option');
      o.value = c;
      o.textContent = c;
      fsel.appendChild(o);
    });
    fsel.value = node.field;
    fsel.addEventListener('change', () => { node.field = fsel.value; changed(); });
    row.appendChild(fsel);

    // operator (list read from the engine - single source of truth)
    const osel = el('select', 'f-op');
    Object.keys(OPS).forEach((op) => {
      const o = el('option');
      o.value = op;
      o.textContent = op;
      osel.appendChild(o);
    });
    osel.value = node.op;
    row.appendChild(osel);

    // value (only shown for value operators; debounced, no re-render on typing)
    const vin = el('input', 'f-value');
    vin.type = 'text';
    vin.placeholder = 'value';
    vin.value = node.value || '';
    const syncValue = () => {
      vin.style.display = OPS[node.op].needsValue ? '' : 'none';
    };
    syncValue();
    vin.addEventListener('input', debounce(() => { node.value = vin.value; changed(false); }, 250));
    row.appendChild(vin);

    osel.addEventListener('change', () => { node.op = osel.value; syncValue(); changed(); });

    row.appendChild(removeBtn(() => { parent.children.splice(index, 1); changed(); }));
    line.appendChild(row);
    return line;
  }

  function logicSelect(node) {
    const sel = el('select', 'f-logic');
    ['and', 'or'].forEach((v) => {
      const o = el('option');
      o.value = v;
      o.textContent = v.toUpperCase();
      sel.appendChild(o);
    });
    sel.value = node.logic || 'and';
    sel.addEventListener('change', () => { node.logic = sel.value; changed(); });
    return sel;
  }

  function addBtn(label, fn) {
    const b = el('button', 'fb-addbtn');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }

  function removeBtn(fn) {
    const b = el('button', 'f-remove');
    b.type = 'button';
    b.textContent = '×';
    b.title = 'Remove';
    b.addEventListener('click', fn);
    return b;
  }

  function init(config) {
    mountEl = typeof config.mount === 'string' ? document.querySelector(config.mount) : config.mount;
    opts = { getColumns: config.getColumns || (() => []), onChange: config.onChange || (() => {}) };
    state = config.state || { logic: 'and', children: [newCond()] };
    render();
  }

  const FilterBuilder = {
    init,
    newCond,
    getState: () => state,
    setState: (s) => { state = s; render(); },
    reRender: render,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = FilterBuilder;
  else global.FilterBuilder = FilterBuilder;
})(typeof self !== 'undefined' ? self : global);
