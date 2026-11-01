/**
 * filterEngine.js - generic filter engine. Pure logic, no DOM.
 * Browser: window.FilterEngine. Node: module.exports.
 *
 * ONE structure serves as filter JSON and as the UI's state:
 *   group      { "logic": "and" | "or", "children": [ node, ... ] }
 *   condition  { "field": "<column>", "op": "<operator>", "value"?: <v> }
 * There is no NOT: the four negative operators (isNotEmpty, isNotNull,
 * doesNotContain, notEquals) are already the exact inverse of their twins.
 *
 * The operator table below is the single source of truth for this project:
 * the builder UI and the dashboard read it from here. "inv" marks operators
 * that are the plain logical inverse of their twin, so all four negative
 * operators are exactly !positive (e.g. doesNotContain is TRUE for
 * null/missing cells, because contains is FALSE for them).
 *
 * Comparisons are normalized: String(v).trim().toLowerCase() on both sides,
 * so 5 == "5" and true == "TRUE". contains/equals are FALSE for null/missing.
 * isEmpty: null/undefined/""/whitespace. isNull: null/undefined only.
 */

(function (global) {
  'use strict';

  const OPS = {
    isEmpty: { needsValue: false },
    isNotEmpty: { needsValue: false, inv: 'isEmpty' },
    isNull: { needsValue: false },
    isNotNull: { needsValue: false, inv: 'isNull' },
    contains: { needsValue: true },
    doesNotContain: { needsValue: true, inv: 'contains' },
    equals: { needsValue: true },
    notEquals: { needsValue: true, inv: 'equals' },
  };

  function validateFilter(filter) {
    if (!filter || typeof filter !== 'object') {
      throw new Error('Filter node must be an object.');
    }
    if (Array.isArray(filter.children)) {
      if (!filter.children.length) {
        throw new Error('Group must have a non-empty children list.');
      }
      if (filter.logic !== 'and' && filter.logic !== 'or') {
        throw new Error('Unknown logic ' + JSON.stringify(filter.logic) + '.');
      }
      filter.children.forEach(validateFilter);
    } else {
      if (!filter.field || typeof filter.field !== 'string') {
        throw new Error('Condition needs a non-empty "field".');
      }
      if (!OPS[filter.op]) {
        throw new Error(
          'Unknown operator ' +
            JSON.stringify(filter.op) +
            '. Supported: ' +
            Object.keys(OPS).join(', ') +
            '.'
        );
      }
      if (OPS[filter.op].needsValue && filter.value === undefined) {
        throw new Error('Operator "' + filter.op + '" requires a "value".');
      }
    }
    return true;
  }

  function isEmptyCell(cell) {
    return cell == null || (typeof cell === 'string' && cell.trim() === '');
  }

  function matches(op, cell, value) {
    if (cell == null) return false; // contains/equals are FALSE for null/missing
    const a = String(cell).trim().toLowerCase();
    const b = String(value).trim().toLowerCase();
    return op === 'contains' ? a.includes(b) : a === b;
  }

  function evalNode(node, row) {
    if (Array.isArray(node.children)) {
      return node.logic === 'or'
        ? node.children.some((c) => evalNode(c, row))
        : node.children.every((c) => evalNode(c, row));
    }
    const spec = OPS[node.op];
    const baseOp = spec.inv || node.op; // evaluate the positive twin, invert if needed
    const cell = row == null ? undefined : row[node.field];
    const res =
      baseOp === 'isEmpty'
        ? isEmptyCell(cell)
        : baseOp === 'isNull'
          ? cell == null
          : matches(baseOp, cell, node.value);
    return spec.inv ? !res : res;
  }

  function evaluateFilter(row, filter) {
    validateFilter(filter);
    return evalNode(filter, row);
  }

  function filterData(data, filter) {
    if (!Array.isArray(data)) throw new Error('filterData expects an array.');
    validateFilter(filter); // once
    return data.filter((row) => evalNode(filter, row));
  }

  const FilterEngine = { OPS, validateFilter, evaluateFilter, filterData };

  if (typeof module !== 'undefined' && module.exports) module.exports = FilterEngine;
  else global.FilterEngine = FilterEngine;
})(typeof self !== 'undefined' ? self : global);
