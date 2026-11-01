/**
 * page.js - runs in the page's own JS world (injected by content.js).
 *
 * Hooks XMLHttpRequest + fetch, watches for Maps' internal search/batch
 * responses, parses listing batches from them, and hands them to the
 * content script via window.postMessage.
 *
 * Console lines are prefixed with [MLG] so they are easy to filter.
 * Set DEBUG to false once everything works for you.
 */

(() => {
  'use strict';

  const DEBUG = true;
  let hits = 0; // throttle debug logging

  // A prefix the code (or content.js) can use to check the build is live.
  if (DEBUG) console.log('[MLG] page.js v1.1.0 loaded on', location.href);

  // ========================================================================
  // Network hooks
  // ========================================================================

  function isSearchUrl(url) {
    return (
      typeof url === 'string' &&
      (url.includes('/search') ||
        url.includes('batchexecute') ||
        url.includes('tbm=map'))
    );
  }

  const proto = XMLHttpRequest.prototype;
  const origOpen = proto.open;
  const origSend = proto.send;

  proto.open = function (method, url) {
    this._mlgUrl = url;
    this._mlgMethod = method;
    return origOpen.apply(this, arguments);
  };

  proto.send = function () {
    this.addEventListener('load', () => {
      try {
        if (this.readyState === 4 && isSearchUrl(this._mlgUrl)) {
          noteHit(this._mlgMethod, this._mlgUrl);
          handlePayload(String(this.responseText || ''), this._mlgUrl);
        }
      } catch (e) {
        if (DEBUG) console.warn('[MLG] XHR read error', e);
      }
    });
    return origSend.apply(this, arguments);
  };

  // Maps issues most batches over XHR, but also hook fetch for robustness.
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input) {
      const url =
        typeof input === 'string' ? input : (input && input.url) || '';
      const promise = origFetch.apply(this, arguments);
      if (isSearchUrl(url)) {
        promise
          .then((res) => {
            try {
              res
                .clone()
                .text()
                .then((t) => {
                  noteHit('GET', url);
                  handlePayload(t, url);
                })
                .catch(() => {});
            } catch (e) {
              /* ignore */
            }
          })
          .catch(() => {});
      }
      return promise;
    };
  }

  function noteHit(method, url) {
    hits++;
    if (DEBUG && hits <= 8) {
      console.log(
        `[MLG] search hit #${hits} ${method} ${String(url).slice(0, 150)}`
      );
    } else if (DEBUG && hits === 9) {
      console.log('[MLG] ...further hits are processed silently');
    }
  }

  // ========================================================================
  // Parsing
  // ========================================================================

  function tryParse(text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  /**
   * Accept whatever wrapper Google currently uses. Known shapes:
   *   1. sentinel-wrapped JSON object holding the payload in a "d" string
   *      (classic wrapper: d = ")]}'\n[[ payload ]]")          (shape A)
   *   2. ")]}'\n[[ payload ]]" (bare batch payload)              (shape B)
   *   3. "[[ payload ]]" (plain JSON)                            (shape C)
   * The payload itself may be nested inside another string; recurse.
   */
  function parsePayload(raw) {
    if (typeof raw !== 'string' || raw.length < 10) return null;

    const cleaned = raw.replace(/\/\*""\*\//g, '').trim();

    const outer = tryParse(cleaned);
    if (Array.isArray(outer)) return outer;

    if (outer && typeof outer === 'object') {
      // Wrapper object: the payload is (usually) the longest string member.
      let best = null;
      let bestLen = 0;
      for (const v of Object.values(outer)) {
        if (typeof v === 'string' && v.length > bestLen) {
          best = v;
          bestLen = v.length;
        }
      }
      if (best) return parseWrapped(best);
      return null;
    }

    if (outer === null) {
      // Bare batch, prefixed with ")]}'" or similar: cut to the first '['.
      const li = cleaned.indexOf('[');
      if (li === -1) return null;
      return tryParse(cleaned.slice(li));
    }

    return null;
  }

  function parseWrapped(text) {
    let t = String(text).replace(/\/\*""\*\//g, '').trim();
    let value = tryParse(t);
    if (value === null) {
      const li = t.indexOf('[');
      if (li === -1) return null;
      value = tryParse(t.slice(li));
    }
    // Strings may nest one more level.
    if (typeof value === 'string') return parseWrapped(value);
    return value;
  }

  /**
   * A listing's signature: string name at [11], address-array at [2],
   * numeric latitude/longitude at [9][2] / [9][3], decent length.
   */
  function looksLikeListing(a) {
    return (
      Array.isArray(a) &&
      a.length >= 20 &&
      typeof a[11] === 'string' && a[11].length > 0 &&
      Array.isArray(a[2]) &&
      Array.isArray(a[9]) &&
      isFinite(a[9][2]) &&
      isFinite(a[9][3])
    );
  }

  function deepScan(node, out, visited) {
    if (!node || typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);
    if (Array.isArray(node)) {
      if (looksLikeListing(node)) {
        out.push(node);
        return;
      }
      for (const child of node) deepScan(child, out, visited);
    } else {
      for (const key of Object.keys(node)) deepScan(node[key], out, visited);
    }
  }

  function handlePayload(raw, url) {
    try {
      const inner = parsePayload(raw);
      if (!inner) {
        if (DEBUG && hits <= 8) {
          console.log(
            `[MLG] unparseable payload (${raw.length} bytes) from ${String(
              url
            ).slice(0, 80)} head: ${raw.slice(0, 160)}`
          );
        }
        return;
      }

      let listings = [];

      // Primary: the feed container historically sits at signature [64],
      // and each entry's last element is the listing object.
      const feed = Array.isArray(inner) && inner[64];
      if (Array.isArray(feed)) {
        for (const item of feed) {
          if (Array.isArray(item) && item.length) {
            const tail = item[item.length - 1];
            if (looksLikeListing(tail)) listings.push(tail);
          }
        }
      }

      // Fallback: deep-scan the payload for anything listing-shaped.
      if (!listings.length) {
        const found = [];
        deepScan(inner, found, new Set());
        listings = found;
      }

      const out = listings.map(toLead).filter((l) => l.name || l.phone || l.website);

      if (DEBUG && hits <= 8) {
        console.log(
          `[MLG] payload parsed: found ${listings.length} listings, keeping ${out.length}`
        );
      }

      if (out.length) {
        window.postMessage({ type: 'mlg-leads', data: JSON.stringify(out) }, '*');
      }
    } catch (e) {
      if (DEBUG) console.error('[MLG] handlePayload error', e);
    }
  }

  /** Convert a raw listing array into a clean lead record. All fields optional. */
  function toLead(a) {
    const get = (fn) => {
      try {
        return fn() || '';
      } catch (e) {
        return '';
      }
    };

    return {
      name: get(() => a[11]),
      phone: get(() => a[178][0][0]),
      website: get(() => a[7][0]),
      category: get(() => (a[13] || []).join('; ')),
      address: get(() => (a[2] || []).join(', ')),
      rating: get(() => a[4][7]),
      reviews: get(() => a[4][8]),
      placeID: get(() => a[78]),
      cid: get(() => a[37][0][0][29][1]),
      latitude: get(() => a[9][2]),
      longitude: get(() => a[9][3]),
      hours: get(() => {
        const rows = (a[203] && a[203][0]) || [];
        return rows
          .map(
            (r) => `${r[0]} ${(r[3] || []).map((v) => v[0]).join(', ')}`.trim()
          )
          .join(' | ');
      }),
    };
  }
})();
