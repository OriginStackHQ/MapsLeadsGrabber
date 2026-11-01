# Maps Lead Grabber

A free, unlimited, fully local Chrome extension that captures Google Maps
business listings and exports them to CSV / Excel (XLSX) / JSON.

## Features

- **No accounts, no servers, no quotas** — nothing leaves your browser.
- **Dashboard page** — table view with search filter, live-updating while
  you scrape, and one-click CSV / Excel exports.
- Works with any search on Google Maps (e.g. `coffee shops in New York`).
- Auto-scrolls the results feed and captures every batch of listings.
- Deduplicates by Place ID and tags each lead with its **Search term**, so
  several searches can build one list.

## What it captures

| Field                | Example                                      |
| -------------------- | -------------------------------------------- |
| Name                 | `Blue Bottle Coffee`                         |
| Phone                | `+1 415-555-0123`                            |
| Website              | `https://bluebottlecoffee.com`               |
| Address              | `66 Mint St, San Francisco, CA 94103`        |
| Category             | `Coffee shop`                                |
| Rating / Reviews     | `4.6` / `1200`                               |
| Place ID / CID       | Google's listing identifiers                 |
| Latitude / Longitude | decimal coordinates                          |
| Hours                | e.g. `Monday 7 AM–6 PM \| Tuesday 7 AM–6 PM` |

## Exports

All exporting lives in the **Dashboard**:

- **Export CSV** — Excel/Sheets-ready, UTF-8 with BOM
- **Export Excel (.xlsx)** — via the bundled SheetJS library
- **Export JSON** — raw records

Exports include exactly what the table shows: search text and any applied
JSON filter are respected.

## Dashboard

Click **Open Dashboard** in the Maps overlay. It shows all captured leads
in a searchable table, live-updates while you scrape, and contains the
export buttons.

### Filter Builder

Click **Open Dashboard**. Under the header sits the **Filter Builder**
("pick a column + an operator, results and exports update live"):

- **Match [AND|OR] of the following** — sets the top-group logic
- Each row: column dropdown + operator dropdown + value input (value
  input only for operators that need one) + remove (×)
- **+ Add Condition** / **+ Add Nested Group** — nested groups carry their
  own AND/OR dropdown, remove button and add buttons, so mixed logic like
  `(A AND B) OR C` is built by clicking
- **Example** loads `(website isEmpty AND name isNotEmpty) OR category equals 'tech'`
- **Clear Filter** resets and shows all rows
- Every change applies live to the table **and to all exports**
- Incomplete rows (no column, or a value-operator with an empty value) are
  simply ignored — no errors

**Operators (exactly these 8):** `isEmpty` `isNotEmpty` `contains`
`doesNotContain` `equals` `notEquals` `isNull` `isNotNull`

### Advanced: edit as JSON

Collapsible **Advanced** area is two-way synced with the builder: edit the
JSON and press _Apply JSON_ to update the UI; every UI change updates the
JSON. Invalid JSON shows a short red error without breaking anything.

The JSON is the same single structure the UI uses — a group is
`{"logic": "and" | "or", "children": [...]}` and a condition is
`{"field": "<column>", "op": "<operator>", "value": ...}`. There is no NOT
node: negation comes from the four negative operators (`isNotEmpty`,
`isNotNull`, `doesNotContain`, `notEquals`). Example: `(website isNotEmpty
AND category contains 'tech') OR name equals 'Cozy Cafe'`:

```json
{
  "logic": "or",
  "children": [
    {
      "logic": "and",
      "children": [
        { "field": "website", "op": "isNotEmpty" },
        { "field": "category", "op": "contains", "value": "tech" }
      ]
    },
    { "field": "name", "op": "equals", "value": "Cozy Cafe" }
  ]
}
```

Comparisons are normalized (`String(v).trim().toLowerCase()`), so
`5 == "5"` and `true == "TRUE"`. Empty means missing, `null`, `""`, or
whitespace-only. `""` is empty but **not** null; `0`/`false` are neither;
`doesNotContain`/`notEquals` return true for null/missing values while
`contains`/`equals` return false.

### Usage example (works for any dataset)

```js
const { filterData } = require("./filterEngine.js");

const data = [
  { name: "TechMart", website: "https://techmart.example", category: "Electronics" },
  { name: "abc Diner", website: "", category: "" },
  { name: "Cozy Cafe", website: "https://cafe.example", category: "Cafe" },
];

filterData(data, {
  logic: "and",
  children: [
    { field: "name", op: "isNotEmpty" },
    { field: "name", op: "doesNotContain", value: "cafe" },
  ],
});
// -> [TechMart]
```

The engine (`filterEngine.js`, pure logic, browser + Node) and the UI
(`filterBuilder.js`) are dependency-free.

## Files

| Path                    | What                                                                      |
| ----------------------- | ------------------------------------------------------------------------- |
| `manifest.json`         | MV3 config (icons, toolbar action, content script)                        |
| `content.js`            | overlay panel + lead store (extension world)                              |
| `page.js`               | XHR/fetch hooks + response parser (page world)                            |
| `dashboard.html/css/js` | dashboard: table, filter builder, exports                                 |
| `filterEngine.js`       | generic JSON filter engine (pure, Node + browser)                         |
| `filterBuilder.js`      | interactive Filter Builder (recursive groups, two-way JSON sync)          |
| `bg.js`                 | service worker (toolbar icon opens dashboard)                             |
| `lib/xlsx.full.min.js`  | SheetJS - real `.xlsx` export                                             |
| `icons/`                | icon master (SVG + PNG) and the 16/32/48/128 set (blue map card, red pin) |
| `tools/genicons.js`     | regenerates the PNG icon set from the master (`node tools/genicons.js`)   |

## Install (Load unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the cloned repo folder `MapsLeadsGrabber`
4. Open <https://www.google.com/maps>, search for something, and a small
   panel appears on the **right side**
5. Click the toolbar icon (blue map pin) to open the Dashboard anytime
6. **After editing any file, press the ↻ reload icon on the extension card
   and reopen the Maps tab** (scripts must inject at page start)

## Use

1. Search on Google Maps.
2. Press **Start Auto Extract** — the panel scrolls the results feed
   automatically and the lead count ticks up. Press the button again (now
   **Stop**) to finish early.
3. **Export CSV** / **Export JSON** to download everything captured.
4. **Clear** wipes the stored leads.

Leads live in `chrome.storage.local` (per browser profile). Refreshing the
Maps page starts a **fresh session**: the store is wiped, so the dashboard
always reflects the current scrape. Press **Clear** to reset mid-session.

## Tips

- Sort/filter afterwards in any spreadsheet tool.
- Want only businesses _with_ websites or phones? Filter the CSV — every
  field is a separate column.
- To support your country's Google domain, add another
  `https://www.google.xx/maps/*` line to `matches` in `manifest.json`
  (20 popular ones are pre-listed).

## More domains

The manifest already covers 20 common regional Google domains. Add yours:

```json
"matches": [ "https://www.google.YOURTLD/maps/*", ... ]
```

## How it works (for the curious)

The extension injects `page.js` into the page itself, hooks
`XMLHttpRequest`/`fetch` there, and reads the internal `tbm=map` search
responses Maps issues while you scroll. Those responses are compact nested
arrays; positions like `[11]` (name), `[178][0][0]` (phone), `[78]`
(Place ID) are parsed defensively, with a deep-scan fallback in case Google
reshuffles the layout.

It never sends anyone any data, requires zero permissions, and adds no
network traffic of its own.

## Troubleshooting "0 leads"

Everything logs to the browser console with a `[MLG]` prefix.

1. Press **F12** on the Maps tab → **Console** tab → type `MLG` in the
   filter box.
2. Search on Maps, press **Start Auto Extract**, scroll a couple screens.
3. You should see, in order:
   - `[MLG] page.js v1.1.0 loaded on ...` — injector works
   - `[MLG] search hit #1 POST /search?...` — network hooks work
   - `[MLG] payload parsed: found N listings ...` — parser works
4. If a step is missing, that line tells you where the break is:
   - _No "page.js loaded"_ → extension not reloaded / wrong domain (add
     your Google domain to `matches` in `manifest.json`)
   - _"page.js loaded" but no "search hit"_ → Google changed its endpoint;
     note what URL the Network tab shows for the listing batches
   - _"search hit" but "unparseable payload"_ → Google changed the wrapper;
     the payload head in the log reveals the new shape
   - _"payload parsed: found 0"_ → the listing signature changed; needs a
     new field-index map

## Legal note

This scrapes publicly displayed Map listings for personal use. Respect
Google's Terms of Service: use sensible pacing (built in), don't hammer
results at massive scale, and follow your local data-protection laws
(GDPR/CCPA) when processing business contact data.

## License

Released under the [MIT License](LICENSE).
