# Property Finder — Development Context (v3, 2026-06-11)

> The previous version of this document described the v1/v2 architecture
> (OSM building footprints, Solar API grid scan, multi-angle Street View).
> That pipeline never produced a correct match and was replaced wholesale.
> Git history has the old document if needed.

## 1. What it does

Paste a Property24 listing URL → the app identifies the actual street address
of the property by matching the listing's photos against satellite imagery and
Google Street View within a configured list of Pretoria suburbs. Output: top
3–5 candidate addresses, ranked, with confidence and reasoning.

## 2. Why v1/v2 failed (read before changing anything)

Five compounding root causes, all verified on 2026-06-11:

1. **Every hardcoded suburb bounding box was 2–4 km west of the real suburb.**
   The old "Silverton" box had *zero overlap* with Silverton. All scanning
   happened in the wrong place. Bounds now come from Google Geocoding
   sublocality `geometry.bounds` (verified static table in
   `src/lib/suburb-data.ts` + runtime refresh with disk cache).
2. **OSM building footprints cover ~10% of these suburbs** (376 buildings in
   all of Silverton). Enumerating candidates from OSM silently excluded the
   right answer. v3 enumerates by sweeping satellite tiles — coverage is
   complete by construction.
3. **Street View images were fetched at fixed compass headings 0/90/180/270**
   — four photos mostly pointing at nothing, 4× the cost. v3 reads the
   panorama's location from the metadata endpoint and computes the bearing to
   the target stand, fetching one aimed image.
4. **Failures showed no error message**: `emitProgress` wrote
   `error_message = null` after the catch block had set it. Errors are now
   written only in the catch block, last.
5. **The listing description was truncated** (parsed from the meta tag, which
   cuts off mid-sentence — losing e.g. "swimming pool and jacuzzi", the single
   most satellite-visible feature). The full text lives in
   `.p24_expandedText` / `.p24_descriptionContainer`.

Additionally the office network blocks nearly all outbound HTTPS (only
`*.googleapis.com`, `api.anthropic.com`, `api.firecrawl.dev` get through), so
every Property24 fetch simply timed out. See §5.

## 3. The v3 pipeline (`src/lib/search-pipeline.ts`)

A staged funnel — cheap wide stages feeding expensive narrow ones:

| # | Stage | Module | Model | Typical volume |
|---|-------|--------|-------|----------------|
| 1 | Listing scrape (direct fetch → Firecrawl fallback) | `listing-extractor.ts`, `net.ts` | — | 1 page |
| 2 | Fingerprint: aerial + facade signatures, OCR quick wins | `feature-extractor.ts` | Sonnet 4.6 | 1 call, ≤20 photos by URL |
| 3 | Quick win: geocode OCR'd house number + street, verify via Street View | `adjudicator.ts#tryQuickWin` | Sonnet 4.6 | 0–1 calls |
| 4 | Suburb bounds | `suburb-data.ts` | — | 1 geocode |
| 5 | Satellite sweep: zoom-18 `scale=2` tiles (≈344 m, 0.27 m/px), flag matching stands, pixel→lat/lng via Web Mercator | `tile-sweep.ts` | Sonnet 4.6 | ~150 tiles (Silverton) |
| 6 | Close-up confirm: zoom-20 per candidate, score vs aerial signature | `tile-sweep.ts#confirmCandidates` | Sonnet 4.6 | ≤60 |
| 7 | Street View compare: bearing-aimed image vs facade photos (photos passed by URL) | `streetview-compare.ts` | Sonnet 4.6 | ≤25 |
| 8 | Final adjudication: one call with all evidence, calibrated ranking | `adjudicator.ts` | Opus 4.8 | 1 call, top 8 |
| 9 | Reverse geocode → street addresses, persist top 5 | — | — | ≤5 geocodes |

Cost per full search ≈ $2–4 in Claude calls + cents of Google Static
Maps/Street View. Satellite tiles, sweep verdicts (keyed by aerial-signature
hash) and Street View comparisons are all cached under `.cache/`, so re-runs
are nearly free.

Listing photos are sent to Claude as **URL image sources** —
Anthropic's servers fetch them, which works even when this machine cannot
reach `images.prop24.com`.

## 4. Key modules

- `src/lib/net.ts` — `fetchPage`: direct fetch with 12 s timeout → Firecrawl
  `/v2/scrape` fallback (needs `FIRECRAWL_API_KEY`). Also defeats Cloudflare.
- `src/lib/suburb-data.ts` — verified suburb bounds + adjacency +
  `normalizeSuburbName` ("Silverton, Pretoria" → "Silverton").
- `src/lib/tile-sweep.ts` — Mercator math (unit-tested), tile grid, sweep +
  confirm stages, candidate dedupe (28 m radius).
- `src/lib/google-maps.ts` — Static Maps (with `scale`), Street View metadata
  + `fetchStreetViewAimedAt` (bearing-aimed), geocode/reverse-geocode.
- `src/lib/claude.ts` — model tiers (`MODELS`), `visionJson` (URL/base64
  images + JSON parsing), `mapWithConcurrency`.
- `src/lib/adjudicator.ts` — final Opus ranking + quick-win path.
- `src/lib/search-pipeline.ts` — orchestration, progress, persistence,
  `expandSearchToAdjacent`.

## 5. Network reality (office)

Only `*.googleapis.com`, `api.anthropic.com` and `api.firecrawl.dev` are
reachable from the office network. Consequences baked into the design:

- Listing pages: Firecrawl fallback in `net.ts`.
- Listing photos for AI: Anthropic URL image sources.
- Listing photos for the browser UI: `/api/proxy-image` tries direct fetch
  (works at home, cached thereafter) and serves a labelled SVG placeholder
  when blocked. Satellite/Street View images always display (served from
  `.cache/maps` via `/api/images/[key]`).
- Anything OSM/Overpass: unusable directly; avoid depending on it.

## 6. Environment

`.env.local`: `ANTHROPIC_API_KEY`, `GOOGLE_MAPS_API_KEY` (Static Maps, Street
View Static, Geocoding enabled), `FIRECRAWL_API_KEY`, `DATABASE_PATH`
(optional).

## 7. Testing

- `npm test` — Mercator round-trips, tile grid coverage, dedupe, bearings,
  suburb bounds sanity (incl. regression: Silverton box must contain the real
  centre), and the listing parser against **a real captured Property24 page**
  (`tests/fixtures/property24-live-2026.html`) asserting the full description
  (pool sentence), erf size, bed/bath counts and photo dedupe.
- Live E2E: `npm run dev`, POST `{"url": ...}` to `/api/search`, follow
  `/search/[id]` (or `/search/[id]/debug` for per-candidate evidence).

## 8. Debugging a wrong match

Work the funnel backwards on `/search/[id]/debug`:
1. Is the full description present and the fingerprint sensible (pool, stand
   size, roof)? If not → extractor/fingerprint.
2. Did the sweep flag the right stand at all (`buildings_found`,
   `pipeline_log`)? If not → sweep prompt or suburb bounds.
3. Did close-up/Street View scoring rank it down? → comparison prompts.
4. Did adjudication pick the wrong finalist? → adjudicator prompt.
