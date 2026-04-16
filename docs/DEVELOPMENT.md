# Property Finder — Development Context Document

**Date:** 2026-04-14  
**Status:** Active development — MVP built, matching accuracy is 0%  
**Author:** Frederik C + Claude  
**Purpose:** Full context document for handing off to an LLM to continue development

---

## 1. Project Overview

### What It Does

Property Finder is an AI-assisted web application that attempts to identify the physical street address of a property listed on Property24, given only the listing URL. Property24 listings never disclose the actual address — only the suburb. The tool reverse-engineers the address using:

1. Scraped listing photos and metadata
2. Claude Vision AI to extract a "property fingerprint" from those photos
3. Google Solar API (primary) + satellite tile scanning (fallback) to find matching buildings in the suburb
4. Google Street View to verify candidates

### The Problem It Solves

Estate agents in South Africa prospect for new mandates by identifying properties that competitors are actively selling. Without the address, they currently have to physically drive around suburbs hoping to spot a "For Sale" board — time-consuming and unreliable. With 5–10 competitor listings to investigate per week, this wastes several hours.

### Target User

A single non-technical estate agent operating in the Pretoria East "Old East" area of Gauteng, South Africa. Uses a browser on desktop or phone.

### Target Area

12 suburbs in Pretoria East (Old East):
- Moot, Queenswood, Kilner Park, Weavind Park, Capital Park, Colbyn
- Moregloed, Waverley, Villieria, Rietondale, Meyerspark, Silverton

These are established residential suburbs: mostly 600–1000m² plots, a mix of older face-brick (1960s–70s) and modernised properties, regular street grids, many boundary walls.

### Current Status (Honest Assessment)

The full pipeline runs end-to-end without crashing. However, it has never successfully identified a property's correct address in testing. Matching accuracy is effectively 0%. The infrastructure is built; the matching logic does not yet work reliably enough to be useful.

---

## 2. Architecture

### High-Level Pipeline

```
[Property24 URL]
     |
     v
[Listing Extractor]  — fetches HTML, parses photos + metadata
     |
     v
[Feature Extractor]  — sends photos to Claude Vision, gets JSON fingerprint
     |
     v
[Suburb Narrower]    — determines which suburb(s) to search
     |
     v
[Solar Scanner]      — queries Google Solar API for buildings in suburb
         |
         +-- if < 3 results --> [Satellite Tile Scanner]  — fallback
     |
     v
[Street View Verifier] — fetches Street View images, Claude scores match
     |
     v
[Results + UI]       — three-way comparison panel, confirm/reject, maps
```

### Tech Stack

| Component | Technology |
|-----------|-----------|
| Framework | Next.js 16 (App Router) with TypeScript |
| Styling | Tailwind CSS v4 |
| Database | SQLite via better-sqlite3 (single file, local) |
| AI | Anthropic Claude Sonnet 4.6 via @anthropic-ai/sdk |
| Maps / Imagery | Google Maps Platform (Static Maps, Street View Static, Geocoding) |
| Solar data | Google Solar API (buildingInsights:findClosest) |
| HTML parsing | Cheerio |
| Tests | Vitest |

### How Components Connect

- The Next.js API route `POST /api/search` creates a DB record and fires `runSearchPipeline()` in the background (no await — returns the search ID immediately).
- The UI polls `GET /api/search/:id` every 3 seconds to get updated status and candidates.
- Progress detail (tile counts, suburb name) is written to the `progress_detail` column in SQLite and returned on each poll.
- Cached satellite and Street View images are stored in `.cache/maps/` as JPEG files. The `GET /api/images/:key` route serves them.
- Property24 photos are proxied through `GET /api/proxy-image?url=...` to avoid CORS issues.

---

## 3. File Structure

Every file in the project with its purpose:

```
property-finder/
├── package.json                              — dependencies and npm scripts
├── next.config.ts                            — Next.js config
├── tsconfig.json                             — TypeScript config
├── tailwind.config.ts                        — Tailwind CSS v4 config
├── vitest.config.ts                          — Vitest test runner config
├── .env.example                              — required env vars (see section 11)
├── .env.local                                — actual secrets (gitignored)
├── .gitignore
├── data/                                     — SQLite DB lives here (gitignored)
│   └── property-finder.db
├── .cache/
│   ├── maps/                                 — cached Google Maps satellite + street view JPEGs
│   └── solar/                                — cached Google Solar API JSON responses
├── docs/
│   ├── DEVELOPMENT.md                        — this document
│   └── superpowers/
│       ├── specs/2026-04-14-property-finder-design.md   — original design spec
│       └── plans/2026-04-14-property-finder-mvp.md      — implementation plan with task checklist
└── src/
    ├── app/
    │   ├── layout.tsx                        — root layout: blue header, max-w-4xl container
    │   ├── page.tsx                          — dashboard: URL input + search history
    │   ├── globals.css                       — global Tailwind imports
    │   └── search/[id]/
    │       ├── page.tsx                      — search progress/results page (polls every 3s)
    │       └── debug/page.tsx               — diagnostic page: pipeline log, all buildings, raw data
    │
    ├── app/api/
    │   ├── search/route.ts                   — POST: start pipeline | GET: list search history
    │   ├── search/[id]/route.ts              — GET: search status + candidates + debug data
    │   ├── search/[id]/progress/route.ts     — GET: SSE stream (polls DB, emits on status change)
    │   ├── search/[id]/expand/route.ts       — POST: expand search to adjacent suburbs (background)
    │   ├── candidate/[id]/route.ts           — PATCH: confirm or reject a candidate
    │   ├── upload/route.ts                   — POST: manual photo upload (saves to data/uploads/)
    │   ├── images/[key]/route.ts             — GET: serves cached satellite/street view images
    │   ├── proxy-image/route.ts              — GET: proxies Property24 photo URLs (bypasses CORS)
    │   └── debug/suburb-bounds/[name]/route.ts — GET: redirects to Google Maps centered on suburb
    │
    ├── lib/
    │   ├── types.ts                          — all shared TypeScript interfaces (see section 4)
    │   ├── db.ts                             — SQLite singleton, schema, all query functions
    │   ├── listing-extractor.ts              — fetches + parses Property24 HTML with Cheerio
    │   ├── claude.ts                         — Anthropic SDK wrapper (single image, batch, base64)
    │   ├── google-maps.ts                    — Google Maps API wrapper with disk cache
    │   ├── feature-extractor.ts              — builds Claude prompt + parses fingerprint JSON
    │   ├── suburb-data.ts                    — hard-coded suburb bounds + adjacency map
    │   ├── suburb-narrower.ts                — picks which suburb zones to search
    │   ├── satellite-scanner.ts              — tile grid generator + two-pass Claude scan
    │   ├── solar-api.ts                      — Google Solar API wrapper with disk cache
    │   ├── solar-scanner.ts                  — samples buildings, scores against fingerprint
    │   ├── streetview-verifier.ts            — fetches Street View + runs Claude comparison
    │   └── search-pipeline.ts               — orchestrates all steps, writes progress to DB
    │
    └── components/
        ├── SearchInput.tsx                   — URL input field + "Search" button, client component
        ├── SearchHistory.tsx                 — recent searches list fetched from /api/search
        ├── ProgressTracker.tsx               — pipeline step indicator with animated dot + progress bar
        ├── ThreeWayComparison.tsx            — listing photo | street view | satellite side-by-side
        ├── FeatureMatchGrid.tsx              — table of matched/mismatched features with source badges
        ├── CandidateCard.tsx                 — single candidate summary card (score, address, features)
        ├── PhotoStrip.tsx                    — scrollable thumbnail row of listing photos
        ├── MapView.tsx                       — embedded Google Maps iframe + drive-by route link
        └── RoofSketch.tsx                    — SVG diagram of Solar API roof segments (debug page only)
```

---

## 4. Data Model

The SQLite database has two tables.

### `searches` table

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| property24_url | TEXT | Original URL submitted (or "manual-upload") |
| listed_suburb | TEXT | Suburb extracted from the listing title |
| listing_data | TEXT | JSON blob of `ListingData` — all listing fields |
| fingerprint | TEXT | JSON blob of `PropertyFingerprint` — AI-extracted features |
| status | TEXT | One of the `SearchStatus` enum values (see below) |
| progress_detail | TEXT | JSON blob with current tile scan progress |
| error_message | TEXT | Error message if status = "failed" |
| pipeline_log | TEXT | JSON array of timestamped pipeline events |
| buildings_found | TEXT | JSON array of all scored buildings from Solar API |
| created_at | TEXT | SQLite datetime('now') |

`SearchStatus` enum values: `extracting_listing`, `analysing_photos`, `narrowing_suburbs`, `scanning_satellite`, `verifying_streetview`, `ranking_results`, `complete`, `failed`

### `candidates` table

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| search_id | TEXT FK | References searches.id |
| address | TEXT | Human-readable address from reverse geocoding |
| latitude | REAL | GPS latitude |
| longitude | REAL | GPS longitude |
| confidence_score | INTEGER | 0–100 overall score |
| confidence_level | TEXT | "high" / "medium" / "low" |
| satellite_match_score | INTEGER | 0–100 from satellite scan phase |
| streetview_match_score | INTEGER | 0–100 from Street View verification |
| feature_matches | TEXT | JSON array of `FeatureMatch` objects |
| ai_explanation | TEXT | Plain-English paragraph from Claude |
| streetview_image_url | TEXT | `/api/images/<key>` for cached street view JPEG |
| satellite_image_url | TEXT | `/api/images/<key>` for cached satellite JPEG |
| status | TEXT | "pending" / "confirmed" / "rejected" |
| confirmed_at | TEXT | Timestamp when confirmed, null otherwise |

### Key TypeScript Types (src/lib/types.ts)

```typescript
interface PropertyFingerprint {
  houseNumber: string | null;        // if visible in photos
  streetClue: string | null;         // if a street sign is spotted
  exteriorFinish: ExteriorFinish;    // face_brick | plaster | painted | mixed | unknown
  exteriorColour: string | null;
  roofType: RoofType;                // tiles | ibr_sheeting | thatch | concrete | unknown
  roofColour: string | null;
  storeys: number;
  fenceType: FenceType;              // palisade | wall | precast | face_brick | none | unknown
  garageCount: number;
  poolShape: PoolShape;              // kidney | rectangle | freeform | round | none | unknown
  drivewayType: DrivewayType;        // circular | straight | double | none | unknown
  solarPanels: boolean;
  notableFeatures: string[];
  landmarks: string[];
  neighbourFeatures: string[];
  quickWins: QuickWin[];             // e.g. visible house number = skip satellite scan
  // Extended fields added to prompt but not in interface (accessed via `as any`):
  // roofOutline, garagePosition, poolPosition, locationClues, visibleText, photoClassification
}
```

---

## 5. Pipeline Flow — Step by Step

This is exactly what happens when a user pastes a URL and clicks Search.

### Step 1 — URL submitted

`POST /api/search` receives `{ url }`, validates it contains "property24", calls `createSearch()` to insert a DB row, then fires `runSearchPipeline(url, searchId)` without awaiting it. Returns `{ id, status: "extracting_listing" }`. The UI immediately navigates to `/search/<id>`.

### Step 2 — Listing Extraction

`extractListingFromUrl()` in `listing-extractor.ts`:
- Fetches the Property24 page with a Chrome User-Agent string
- Parses HTML with Cheerio using Property24-specific CSS class selectors (`.p24_price`, `.p24_propertyTitle`, `.p24_featureDetail`, etc.)
- Extracts photos in 5 passes:
  1. Gallery-specific selectors (`[.p24_galleryThumbnails img`, `.gallery img`, etc.)
  2. All `<img>` tags checking `src`, `data-src`, `data-lazy-src`, `data-hi-res-src`, etc.
  3. Regex scan of raw HTML for image URLs in JSON blobs
  4. JSON-LD structured data blocks
  5. Open Graph meta tags

Photos are filtered by `isLikelyPropertyPhoto()` which rejects SVGs, agent/logo URL patterns (`/logos/`, `/icons/`, `/agent`, `/agencies/`, `/avatar`, etc.), and images not from the `prop24.com` or `property24.com` domain.

### Step 3 — AI Feature Extraction

`extractFeaturesFromPhotos()` in `feature-extractor.ts`:
- Slices the first 20 photos
- Builds a prompt with `buildFeatureExtractionPrompt()` (see Section 7 — Key Algorithms)
- Sends all images + prompt in a single Claude API call via `analyseMultipleImagesWithPrompt()`
- Parses the JSON response with `parseFeatureResponse()`
- Saves the fingerprint to `searches.fingerprint` in DB

### Step 4a — Solar API Scan (Primary)

`scanSuburbWithSolarApi()` in `solar-scanner.ts`:
- Calls `sampleBuildingsInSuburb()` which creates a grid of lat/lng points at 0.0003-degree steps (~33m apart)
- For each grid point, calls `findClosestBuilding()` in `solar-api.ts` which queries `https://solar.googleapis.com/v1/buildingInsights:findClosest`
- Deduplicates buildings by `building.name` (Solar API returns the same name for the same building)
- Scores every building against the fingerprint with `scoreBuildingAgainstFingerprint()` (see Section 7)
- Returns top 20 scored buildings as `TilePropertyMatch[]`, plus all scored buildings for debug display
- All Solar API responses are cached in `.cache/solar/` as JSON files keyed by lat/lng MD5 hash

### Step 4b — Satellite Tile Scan (Fallback)

Runs only if Solar API returns fewer than 3 candidates.

`scanSuburbZones()` in `satellite-scanner.ts`:
- `generateTileGrid()` creates tiles at 0.001-degree steps with 50% overlap — meaning each tile is ~111m × 111m and tiles overlap by half. For a typical suburb this produces many hundreds of tiles.
- **Pass 1 (fast filter):** For each tile, fetches a 640×640 satellite image, sends it to Claude with `buildFastFilterPrompt()` asking only whether must-have features (pool, solar panels, roof colour) are present. Returns a simple `{"hasAny": true/false}`.
- **Pass 2 (detail scan):** Only tiles that pass the filter get a full scan with `buildSatelliteScanPrompt()` asking Claude to identify matching properties and estimate their lat/lng offset from the tile center.

### Step 5 — Street View Verification

`verifyCandidates()` in `streetview-verifier.ts`:
- Takes up to 10 candidates from the satellite/Solar scan
- For each: fetches Street View images at 4 headings (0°, 90°, 180°, 270°)
- Sends the first available Street View image to Claude with `buildStreetViewComparisonPrompt()` listing all expected features from the fingerprint
- Claude returns a score 0–100, confidence level, feature match array, and explanation paragraph
- Candidates scoring above 20 are kept and sorted by score
- Results are saved to the `candidates` table

### Step 6 — Complete

Status set to "complete". The UI poll picks this up, stops polling, and renders the results page.

---

## 6. External APIs Used

### Claude API (Anthropic)

- **SDK:** `@anthropic-ai/sdk` v0.88.0
- **Model:** `claude-sonnet-4-6`
- **Endpoints used:** `messages.create` (vision — images sent as base64)
- **Used for:** Feature extraction from listing photos, satellite tile scanning, Street View comparison
- **Cost per search (estimate):** ~$0.50–2.00 depending on suburb size and photo count
- **Token volumes:**
  - Feature extraction: ~20k input tokens (20 photos) + ~2k output
  - Solar scoring: no Claude calls (purely algorithmic)
  - Satellite tile scan (fallback only): ~2k tokens per tile × hundreds of tiles — very expensive if it runs
  - Street View verification: ~5k tokens per candidate × up to 10 candidates

### Google Maps Static API

- **Used for:** Fetching satellite imagery tiles for the tile scan fallback
- **Endpoint:** `https://maps.googleapis.com/maps/api/staticmap?center=LAT,LNG&zoom=19&size=640x640&maptype=satellite&key=KEY`
- **Zoom level 19** gives approximately 300m × 300m coverage at 640px
- **Cached** to `.cache/maps/` as JPEG files (keyed by MD5 of lat/lng/zoom/size)
- **Cost:** $0.002 per request; $200/month Google credit covers most usage

### Google Street View Static API

- **Used for:** Fetching street-level images of candidate locations
- **Endpoint (metadata check):** `https://maps.googleapis.com/maps/api/streetview/metadata?location=LAT,LNG&key=KEY`
- **Endpoint (image):** `https://maps.googleapis.com/maps/api/streetview?location=LAT,LNG&heading=H&size=640x480&pitch=0&fov=90&key=KEY`
- **Headings checked:** 0°, 90°, 180°, 270° (cardinal directions)
- **Cached** to `.cache/maps/` same as satellite
- **Cost:** $0.007 per request

### Google Geocoding API

- **Used for:** Converting lat/lng back to a human-readable address (`reverseGeocode()`), and potentially converting addresses to coords (`geocodeAddress()`)
- **Endpoint:** `https://maps.googleapis.com/maps/api/geocode/json?latlng=LAT,LNG&key=KEY`
- **Cost:** $0.005 per request

### Google Solar API

- **Used for:** Finding buildings in a suburb and getting their roof geometry (segment count, area, azimuth)
- **Endpoint:** `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=LAT&location.longitude=LNG&requiredQuality=LOW&key=KEY`
- **Returns:** Building center, bounding box, roof segment breakdown (pitch, azimuth, area), solar panel positions if modelled
- **Coverage:** Patchy in South Africa. Many suburbs return nothing or very sparse coverage. The API is primarily designed for solar energy assessment, not property identification.
- **Cached** to `.cache/solar/` as JSON files keyed by MD5 of rounded lat/lng
- **404 responses** (no building at this location) are also cached as `null` to avoid re-querying
- **Cost:** Unclear — appears to use same API key as Maps Platform but billing may vary

---

## 7. Key Algorithms

### Feature Extraction Prompt

The prompt in `buildFeatureExtractionPrompt()` (`src/lib/feature-extractor.ts`) instructs Claude to:

1. **Classify** each photo as EXTERIOR or INTERIOR
2. **OCR scan** every photo for visible text: house numbers, street signs, agent boards, address plates, kerb numbers
3. **Quick wins:** landmarks, identifiable neighbours, mountain/hill views indicating direction
4. **Extract exterior features:** finish type/colour, roof type/colour, storeys, fence type, garage count, pool shape, driveway type, solar panels, notable features, visible landmarks
5. **Roof outline:** describe the building shape from directly above (L-shaped, T-shaped, rectangular, etc.) — this is the most useful field for Solar API matching

The prompt demands a JSON-only response (no markdown) with a specific schema including extended fields like `roofOutline`, `garagePosition`, `poolPosition`, `locationClues`, `visibleText`, and `photoClassification`. These extended fields are not in the `PropertyFingerprint` TypeScript interface — they exist in the parsed JSON but must be accessed via `(fingerprint as any).roofOutline`.

### Solar API Scoring

`scoreBuildingAgainstFingerprint()` in `solar-scanner.ts` scores each building 0–100 based on:

| Feature | Weight | Logic |
|---------|--------|-------|
| Solar panels | 20 pts | If fingerprint says yes, check Solar API's `solarPanels` array |
| Roof shape | 25 pts | Maps `roofOutline` keywords ("L-shaped", "rectangular", "complex") to segment count |
| Storeys | 15 pts | Uses `wholeRoofStats.areaMeters2` as proxy: single-storey ~80–400m², double ~60–300m² |
| Imagery quality | 5 pts | Bonus for HIGH quality imagery |

**Total possible: 65 pts**, normalised to 100. A score of 70%+ = "high" confidence, 45–70% = "medium", below = "low".

This scoring is very coarse. It cannot use roof colour, fence type, pool, driveway, or exterior finish — none of that data is in the Solar API response. The Solar API only provides roof geometry and solar potential.

### Satellite Tile Grid

`generateTileGrid()` creates tiles covering a suburb with configurable step size and overlap:

```
stepDegrees = 0.001 (~111m per degree latitude at this latitude)
overlapRatio = 0.5 (50% overlap)
stride = stepDegrees × (1 - overlapRatio) = 0.0005

Tiles created at: lat = south + halfStep, south + halfStep + stride, ...
                  lng = west + halfStep, west + halfStep + stride, ...
```

At 50% overlap, a suburb like Queenswood (~2km × 2km) produces roughly 1,600 tiles. This is impractical for real-time scanning and is why the Solar API path is preferred.

### Two-Pass Satellite Scan

**Pass 1 (fast filter):**
- If the fingerprint has a pool, solar panels, or roof colour, sends a minimal prompt asking only whether those features appear in the tile image
- If no distinctive features are present, the filter prompt asks only whether the tile shows residential buildings at all
- Response is `{"hasAny": true/false}` or `{"hasResidential": true/false}`
- Purpose: eliminate ~60–70% of tiles cheaply

**Pass 2 (detail scan):**
- Only tiles passing the filter get the full `buildSatelliteScanPrompt()`
- Prompt lists all matchable features prioritised by satellite visibility: roof colour/shape first, then pool shape/position, then driveway, then boundary walls, then trees
- Claude must find properties matching at least 3 major features
- Returns `{"hasMatch": bool, "matches": [{estimatedLatOffset, estimatedLngOffset, matchingFeatures, confidence}]}`
- Lat/lng offsets are added to the tile center to estimate the property's position

### Street View Verification

`buildStreetViewComparisonPrompt()` lists the expected features from the fingerprint (exterior finish/colour, roof type/colour, fence type, garage count, storeys, notable features, neighbour features) and asks Claude to score 0–100 how well the Street View image matches.

Claude is explicitly told:
- Structural features are more reliable than cosmetic ones
- Street View may be 1–5 years old
- Be honest — false positives waste time

Only the first available cardinal direction is used for scoring (not all 4 angles). This is a known gap.

---

## 8. Current Issues and Limitations

### Critical: Matching Accuracy is 0%

The pipeline has never successfully identified a property's correct address in testing. This is the core problem. The reasons are structural:

### Photo Extraction Problems

**Lazy loading:** Property24 is a React SPA. Most photos are lazy-loaded by JavaScript after the initial HTML is served. The current extractor does a single HTTP fetch (like `curl`), so JavaScript never executes. The HTML at fetch time typically has placeholder `src=""` or `data-src` attributes. The 5-pass extraction tries many attribute variations and also scans raw HTML for JSON blobs that may contain image URLs — this partially works but is unreliable.

**Agent headshots getting through:** The `isLikelyPropertyPhoto()` filter excludes common agent/logo URL patterns but some agent profile photos still slip through because they use the same CDN domain as property photos. This means Claude sometimes analyses a person's face photo instead of a property exterior.

**Photo count inconsistency:** Some searches correctly get 15–20 listing photos; others get 0–3. When 0 photos are found, the pipeline throws immediately. When only 1–3 are extracted and they happen to be interior shots, the fingerprint is nearly empty.

**No fallback to Puppeteer/headless browser:** The correct fix is to use a headless browser (Puppeteer, Playwright) to render the page and wait for lazy-loaded images. This has not been implemented.

### Suburb Bounds Are Approximate

The suburb bounding boxes in `suburb-data.ts` are manually estimated GPS coordinates. They are rough approximations — not derived from official municipal boundaries. Some suburbs may be wrong by 200–500 metres, which at tile scan scale means entire streets are missed or wrong streets are included.

No automated mechanism exists to verify or correct these bounds. The debug endpoint `GET /api/debug/suburb-bounds/:name` redirects to Google Maps at the calculated center — useful for visual verification but no corrections have been made based on this.

### Solar API Coverage Gaps

The Google Solar API has poor and patchy coverage in Pretoria East. In several test runs, entire suburbs returned zero buildings or very sparse results (5–10 buildings out of potentially hundreds). When the Solar API returns 0 buildings, the pipeline falls back to tile scanning, which is slow and even less accurate.

Even when the Solar API does return buildings, its data only includes roof geometry (segment count, area, azimuth, solar panels). It has no information about:
- Roof colour or material
- Exterior finish (face brick / plaster)
- Pool presence or shape
- Fence or boundary wall type
- Number of storeys (only inferred poorly from roof area)

This means the Solar API scoring can only match on ~2 meaningful attributes (roof shape complexity, solar panels), making it impossible to differentiate typical residential houses from each other with any reliability.

### Satellite Tile Scan Accuracy

The tile scan fallback has fundamental accuracy problems:

**Claude Vision at satellite scale is unreliable.** At zoom 19, each 640×640px image covers roughly 300m × 300m. A single house occupies maybe 20×20px. Claude cannot reliably identify pool shapes, roof colours, or fence types at this resolution. The model frequently hallucinates matches (returns `hasMatch: true` with invented features) or misses obvious matches.

**Lat/lng offset estimation is guesswork.** When Claude identifies a matching property, it returns an `estimatedLatOffset` and `estimatedLngOffset` relative to the tile center. These offsets are the model's guess at where in the image the property sits, translated to geographic coordinates. There is no reliable way for a vision model to accurately estimate GPS offsets from an image — it effectively returns random small numbers. The resulting candidate coordinates are typically wrong by 50–200 metres.

**Tile overlap creates duplicate candidates.** With 50% overlap, the same property appears in up to 4 tiles. Each tile scan may produce a different (wrong) coordinate estimate, resulting in 4 candidates all pointing to slightly different wrong locations near the same property.

**Too many tiles, too expensive.** Even with the fast filter, scanning a full suburb at 50% overlap produces hundreds of tiles. At ~$0.01–0.02 per Claude vision call (input tokens), a single suburb scan can cost $5–10. This is 10–20x over the design budget.

### Street View Verification Does Not Meaningfully Verify

The Street View verifier receives candidate coordinates that are usually wrong (from the satellite scan or misestimated Solar API positions). When the coordinates are wrong, Street View shows the wrong property. Claude then compares the listing photos against the wrong property and either incorrectly confirms it (if the wrong property vaguely matches the features) or correctly rejects it.

Only one heading angle (the first available from the 4 checked) is currently sent to Claude for scoring. Multiple angles are fetched but only the first is analysed. This misses the case where the front of the property faces a different direction.

The 20-score threshold (`candidate.confidenceScore > 20`) for keeping a candidate is too low. It means nearly every Street View image gets through as a "candidate" regardless of whether it actually matches.

### No Integration with Property24's React App

Property24 renders in React client-side. The raw HTML that the server returns is a near-empty shell. All listing data (photos, price, description, agent) is loaded by JavaScript after the page loads. The current scraper catches some data from HTML, JSON-LD blobs, and OG meta tags, but misses the majority of photos because they are lazy-loaded.

This is the single biggest problem in the pipeline. Without the correct photos, the fingerprint is unreliable; without a reliable fingerprint, no amount of satellite or Solar API work will find the right property.

---

## 9. What Has Been Tried — Bug History

### Photo extraction iterations

The listing extractor went through 5 iterations of the photo extraction logic:
- **v1:** Simple `img[src]` selector — got almost nothing because Property24 uses `data-src` for lazy loading
- **v2:** Added `data-src`, `data-lazy-src`, `data-original`, `data-hi-res-src` attribute checks — improved photo count
- **v3:** Added exclusion selectors to filter agent/agency areas — still let some agent photos through
- **v4:** Added `isLikelyPropertyPhoto()` URL pattern filter with explicit blocklist of `/logos/`, `/icons/`, `/agent`, `/agencies/`, `/avatar`, `/profile`, etc.
- **v5 (current):** Added regex scan of raw HTML for JSON-embedded image URLs, JSON-LD structured data parsing, and Open Graph meta tag extraction — this catches photos that exist in JavaScript payloads but were serialised into the HTML (some Property24 pages do this, others don't)

Despite 5 iterations, the photo count remains inconsistent and sometimes wrong.

### Score threshold adjustment

The Street View candidate threshold was initially 50 (only keep candidates scoring 50%+). Lowered to 20 after no candidates were passing at all. The current threshold of 20 essentially keeps everything.

### Solar API integration added

The original design only used satellite tile scanning. Google Solar API was added as a faster, cheaper alternative because:
- It provides building-level data (not just tiles)
- It deduplicates buildings automatically
- It provides roof geometry that can (theoretically) be matched to the fingerprint

In practice, the Solar API has low coverage in Pretoria East and insufficient data fields for reliable matching.

### Debug page added

`/search/:id/debug` was added to diagnose pipeline failures. It shows:
- Full pipeline timeline with timestamps
- All listing photos as thumbnails
- Full fingerprint JSON
- All buildings returned by Solar API with SVG roof sketches
- All final candidates with coordinates

### Suburb expansion endpoint added

`POST /api/search/:id/expand` was added after repeated "no candidates found" failures. When a search returns 0 candidates, the UI offers a button to expand the search to adjacent suburbs. This runs the tile scan (not Solar API) on adjacent suburbs in the background.

### Progress detail in DB added

Progress updates were initially only emitted via the `ProgressCallback` function and lost after the pipeline finished. The `progress_detail` column was added to the `searches` table so the polling UI can show real-time tile scan progress.

### `pipeline_log` and `buildings_found` columns added

Added to `searches` table via auto-migration (`columnExists()` check) to support the debug page. The `buildings_found` column stores all Solar API buildings (including low-scoring ones) so the debug page can show roof sketches for every building found.

---

## 10. Proposed Improvements — What to Build Next

These are prioritised by likely impact on matching accuracy.

### Priority 1: Fix Photo Extraction (Blocks Everything Else)

The entire pipeline depends on getting good photos. Without them, nothing else matters.

**Option A: Puppeteer/Playwright headless browser**  
Render the Property24 page in a headless Chromium instance, wait for images to load (wait for `document.readyState === 'complete'` + additional 2s), then extract `document.querySelectorAll('.p24_galleryThumbnails img')`. This is the correct solution.

Implementation: Add `puppeteer` or `playwright` as a dependency. Create a `fetchWithBrowser(url)` function that opens a headless browser, navigates, waits, extracts photos, and returns them. Replace the `fetch()` call in `extractListingFromUrl()` with this.

**Complexity:** Medium. Puppeteer works in Node.js server context; headless Chrome can run on Windows and Linux. One concern: running a headless browser in Vercel serverless functions has size limits.

**Option B: Property24 API reverse-engineering**  
Property24 probably has an internal REST or GraphQL API that the React app calls to load listing data. Inspect network requests in Chrome DevTools when loading a listing page. If the API is unauthenticated (or uses only a cookie), use that directly.

**Option C: Selenium/browser automation with a visible browser**  
Only viable for local-run POC. Not suitable for server deployment.

### Priority 2: Improve Solar API Matching

The Solar API is the right approach if coverage improves. To make it work:

**Use satellite imagery to supplement Solar API data:**  
After identifying the top N Solar API candidates by roof shape, fetch a high-zoom satellite tile for each candidate and ask Claude to check the specific features the Solar API cannot provide: roof colour, pool presence, boundary wall style, driveway pattern. This two-stage approach (Solar API for initial candidate list, Claude Vision for detailed verification of specific coordinates) is far more efficient than tile scanning.

**Add roof area range filter:**  
Extend `scoreBuildingAgainstFingerprint()` to reject buildings whose roof area is implausible for the listing's plot size. A 3-bedroom house on a 650m² plot should have a roof area between 100–250m². Filter out buildings with <50m² or >500m² roof area.

**Improve roof shape matching:**  
The current string-matching on `roofOutline` keywords ("L-shaped", "rectangular") is fragile. Consider using segment count ranges more precisely:
- Gable (simple rectangle): 2 segments
- L-shape: 3–4 segments  
- Hip roof: 4–6 segments
- Complex/irregular: 7+ segments

### Priority 3: Fix Coordinate Accuracy

When a satellite match is found, the estimated coordinates are unreliable. 

**Snap to nearest Solar API building:**  
After any satellite tile scan returns a match, call `findClosestBuilding(estimatedLat, estimatedLng)` to snap the estimate to the nearest known building center. This would correct positional errors of 50–200m down to the true building center.

**Use bounding box from Solar API:**  
Once a building is identified via Solar API, its `boundingBox` (SW and NE corners) defines the exact property outline. Use the center of this bounding box as the Street View query location, and use the bounding box corners to determine which Street View angles are most likely to show the front of the property.

### Priority 4: Multi-Angle Street View Scoring

Currently only the first returned Street View angle is sent to Claude. Change `verifyCandidate()` to:
1. Fetch all 4 cardinal angles
2. Send all 4 images to Claude in a single multi-image call
3. Ask Claude to identify which angle shows the front of the property (if any) and score only that angle

### Priority 5: Suburb Bounds Verification and Correction

Each suburb boundary should be verified against the actual Google Maps suburb polygon. Steps:
1. Open each suburb URL from the debug endpoint: `GET /api/debug/suburb-bounds/:name`
2. Compare the centered map view to the actual suburb boundary visible in Google Maps
3. Correct the bounding boxes in `suburb-data.ts`

This is a manual task but important — wrong bounds mean wrong tiles are scanned.

### Priority 6: Confidence Score Calibration

The current confidence scores are not calibrated to reality. A score of 70 ("high") has no demonstrated relationship to actually being the correct property. 

Once even one correct identification is confirmed, use it to calibrate:
- What score did the correct candidate get?
- What scores did the wrong candidates get?
- Adjust the `scoreBuildingAgainstFingerprint()` weights accordingly

### Priority 7: Quick Win — House Number OCR

If Claude extracts a house number from the listing photos (e.g., "47" visible on the gate), the pipeline currently logs it but does not act on it. Instead of scanning the whole suburb, it should:
1. Geocode every address in the suburb: `47 <every street name> <suburb>`
2. Fetch Street View for each match
3. Verify the house number is visible and matches

This would give near-instant results for the ~30% of listings where a house number is visible somewhere in the photos.

---

## 11. Configuration — Environment Variables

Required in `.env.local` (copy from `.env.example`):

| Variable | Value | Purpose |
|----------|-------|---------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Claude API access |
| `GOOGLE_MAPS_API_KEY` | `AIza...` | All Google APIs (Maps, Street View, Geocoding, Solar) |
| `DATABASE_PATH` | `./data/property-finder.db` | SQLite database file location |

### Google Cloud Project Setup

All Google APIs use a single API key. The following APIs must be enabled in the Google Cloud Console:

1. Maps Static API
2. Street View Static API
3. Geocoding API
4. Solar API (under "Google Maps Platform" — may need to request access)

The same API key is used for all four. Ensure API key restrictions are set appropriately (HTTP referrer or IP restriction for production, unrestricted for local dev).

### API Key Restrictions for Production

If deploying publicly:
- Restrict the key to specific API methods
- Add HTTP referrer restrictions for Maps JavaScript API
- Consider creating separate keys for server-side (Solar, Geocoding, Static APIs) and client-side (Maps JavaScript)

---

## 12. How to Run

### Prerequisites

- Node.js 20+
- npm
- A Google Cloud account with Maps Platform enabled and billing set up
- An Anthropic API account

### Installation

```bash
cd "c:/Users/frederikc/OneDrive - TC Recoveries/Nutun OneDrive/AI/Personal/Property Finder"

# Install dependencies
npm install

# Copy and fill in environment variables
cp .env.example .env.local
# Edit .env.local and add your ANTHROPIC_API_KEY and GOOGLE_MAPS_API_KEY
```

### Running

```bash
# Development server (hot reload)
npm run dev
# Open http://localhost:3000

# Production build
npm run build
npm start

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Lint
npm run lint
```

### First-Time Data Directory

The `data/` directory is created automatically by `db.ts` if it doesn't exist. The SQLite database file is created and migrated on first run.

### Cache Directories

`.cache/maps/` and `.cache/solar/` are created automatically on first use. They can grow large if many searches are run. To clear cached images and Solar API data:

```bash
rm -rf .cache/
```

This forces fresh API requests on the next search.

### Running a Search

1. Open http://localhost:3000
2. Paste a Property24 listing URL (must contain "property24" in the URL)
3. Click Search
4. Wait 2–10 minutes (Solar API scan takes ~2 min per suburb; tile scan takes much longer)
5. If no results, click "Expand search to adjacent suburbs"
6. Use the Debug view (link in top-right of the results page) to diagnose what went wrong

---

## 13. API Endpoints — Quick Reference

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/search` | Start a new search from a Property24 URL |
| GET | `/api/search` | List last 20 searches (for history panel) |
| GET | `/api/search/:id` | Get full search data: listing, fingerprint, candidates, pipeline log, buildings |
| GET | `/api/search/:id/progress` | SSE stream — emits when status changes (polls DB every 1s) |
| POST | `/api/search/:id/expand` | Expand search to adjacent suburbs (background, tile scan only) |
| PATCH | `/api/candidate/:id` | Confirm or reject a candidate (`{ status: "confirmed" | "rejected" }`) |
| POST | `/api/upload` | Upload photos manually (multipart form, `photos[]` + `suburb`) |
| GET | `/api/images/:key` | Serve cached satellite or Street View JPEG from `.cache/maps/` |
| GET | `/api/proxy-image?url=...` | Proxy a Property24 photo URL (bypasses browser CORS) |
| GET | `/api/debug/suburb-bounds/:name` | Redirect to Google Maps centered on suburb (visual bounds check) |

---

## 14. Design Decisions and Tradeoffs

### Why SQLite and not Postgres?

Single-user POC running locally. SQLite is zero-setup, zero-cost, and the data volume is tiny (hundreds of rows). Migrating to Postgres later requires only changing the DB driver — the query layer uses prepared statements throughout.

### Why poll instead of SSE?

SSE (`GET /api/search/:id/progress`) is implemented but the UI uses polling (`GET /api/search/:id` every 3s). The SSE route was built but not wired up fully in the search page. The poll approach is simpler and works reliably even when the connection drops. At 3s intervals, progress feels near-real-time.

### Why run the pipeline in the background?

The full pipeline takes 2–10 minutes. If the API route awaited the pipeline, the HTTP connection would time out. The pattern is: create DB record, start pipeline async, return ID immediately, let UI poll.

Caveat: In Next.js App Router with Vercel, background async work may be killed after the response is sent. For local development this works. For Vercel deployment, a proper background job system (e.g., Vercel Cron + Upstash, or a separate long-running worker) would be needed.

### Why Google Solar API?

Added as a cheaper, faster alternative to tile scanning. The Solar API returns structured building data at sub-property granularity without needing Claude Vision for the initial scan. If coverage in Pretoria East were better, it would be clearly superior. Given the current coverage gaps, it often falls back to the tile scan anyway.

### Why not use Google Vision API or other OCR services?

Claude was chosen as the single AI provider to keep the integration simple and costs in one place. Google Vision API is cheaper for pure OCR but requires separate integration. If Claude's OCR on listing photos proves insufficient for reading house numbers, switching to Google Vision API specifically for the OCR step is worth considering.

---

## 15. Success Criteria (From Original Spec)

The MVP is considered successful if:

1. Given a Property24 listing URL, the tool correctly identifies the property address within the top 3 candidates at least 60% of the time
2. The full pipeline completes in under 3 minutes per search
3. Monthly running cost stays under R500
4. A non-technical estate agent can use the tool with no training beyond a 2-minute walkthrough

**Current status against these criteria:**

1. **0%** — No correct identifications in testing
2. **Partially met** — Solar API path completes in ~2–3 min; tile scan fallback takes 10–30 min
3. **Approximately met for Solar API path** — ~R20–50 per search at current usage; tile scan runs cost 10–20x more
4. **Met** — The UI is simple and usable by a non-technical person

The blocking failure is criterion 1. Everything else is secondary until matching accuracy improves.
