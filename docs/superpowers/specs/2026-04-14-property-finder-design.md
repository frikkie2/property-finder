# Property Finder — Design Specification

**Date:** 2026-04-14
**Status:** Draft
**Author:** Frederik C + Claude

---

## 1. Overview

Property Finder is an AI-assisted web application that helps estate agents identify the physical address of properties listed by competing agents on Property24. The agent pastes a listing URL, and the tool uses Claude Vision, Google Street View, and Google Satellite imagery to reverse-engineer the property's location.

### Problem

Estate agents in South Africa prospect for new mandates by identifying properties that competitors are selling. Property24 listings never show the actual address — only the suburb. Agents currently drive around suburbs trying to spot the property manually, which is time-consuming and unreliable.

### Solution

An automated identification pipeline that:

1. Extracts listing photos and metadata from a Property24 URL
2. Uses AI (Claude Vision) to identify distinguishing features from the photos
3. Scans satellite imagery of target suburbs to find matching properties
4. Verifies candidates against Google Street View
5. Presents ranked results with three-way visual comparison (listing photo / street view / satellite)

### Target User

- Non-technical estate agent
- Uses: phone, browser, WhatsApp, email, PropCtrl
- Operates in Pretoria East (Old East) suburbs
- Investigates 5–10 competitor listings per week

### Target Area

12 suburbs in Pretoria East (Old East):

- Moot, Queenswood, Kilner Park, Weavind Park, Capital Park, Colbyn
- Moregloed, Waverley, Villieria, Rietondale, Meyerspark, Silverton

Characteristics: established residential, mostly 600–1000m² plots, mix of older face-brick and modernised properties, regular street grid layouts, many boundary walls.

---

## 2. Architecture

### High-Level Pipeline

```
[Property24 URL] → [Listing Extractor] → [AI Feature Extraction] → [Suburb Narrowing]
    → [Satellite Tile Scanner] → [Street View Verifier] → [Results Ranking] → [UI]
```

### Tech Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Frontend | Next.js (React) | Simple, fast, works on mobile browser. Free hosting on Vercel. |
| Backend/API | Next.js API routes | Co-located with frontend, no separate server needed. |
| AI Engine | Claude API (Vision) | Analyses listing photos, satellite tiles, street view images. Single AI provider keeps costs simple. |
| Maps & Imagery | Google Maps Platform | Street View Static API, Maps Static API (satellite), Geocoding API. |
| Database | SQLite (via better-sqlite3) | Local file-based, zero-cost, sufficient for single-user POC. Easily migrated to Postgres later. |
| Hosting | Local Node server (dev/POC) | Run locally on agent's machine for POC. Move to Vercel + Postgres when ready to deploy remotely. |

### Cost Estimate (5–10 listings/week)

| Service | Monthly Cost (ZAR) |
|---------|-------------------|
| Google Maps APIs | ~R100–200 |
| Claude API (Vision) | ~R100–200 |
| Hosting (Vercel free tier) | R0 |
| **Total** | **~R200–400/month** |

---

## 3. Detailed Component Design

### 3.1 Listing Extractor

**Input:** Property24 listing URL

**Process:**
- Fetch the listing page (single HTTP request, same as a browser visit)
- Parse HTML to extract:
  - All property photos (image URLs)
  - Price
  - Bedrooms, bathrooms, parking
  - Plot size / floor size
  - Listed suburb
  - Property type (house, townhouse, etc.)
  - Listing description text
  - Agent name and agency (to exclude own listings)

**Fallback:** Manual photo upload via drag-and-drop if URL extraction fails. Agent can also upload screenshots taken at show days.

**Output:** Structured listing data + array of image URLs/files.

### 3.2 AI Feature Extraction

**Input:** All listing photos

**Process:** Send each photo (or batched) to Claude Vision with a structured prompt requesting identification of:

**Exterior clues:**
- House number (if visible on wall, gate, or letterbox)
- Street name (if visible on signs)
- Exterior finish — face brick, plaster, painted (and colour)
- Roof type — tiles, IBR sheeting, thatch
- Roof colour — terracotta, charcoal, green, etc.
- Number of storeys
- Gate/fence style — palisade, wall, precast, face brick
- Garage doors — count, type, colour

**Property clues:**
- Swimming pool — shape (kidney, rectangle, freeform), approximate size
- Large trees — type and position relative to house
- Driveway layout — circular, straight, double, paved/concrete
- Boundary wall height and material
- Garden features — lapa, braai area, wendy house
- Solar panels on roof
- Neighbouring buildings visible (distinctive features)
- Power lines, water towers, landmarks in background

**Quick wins (checked first):**
- Visible house number → near-instant identification, just confirm suburb
- Street sign in background → massive shortcut
- Unique landmark (church, school, park) → narrows to a block or two
- Competitor's "Sold" board from previous sale → sometimes visible in old Street View
- Neighbour with identifiable features → identify neighbour first, then target is next door

**Output:** Property fingerprint — structured JSON of all identified features with confidence levels.

### 3.3 Suburb Narrowing

**Input:** Property fingerprint + listing metadata

**Process:**
1. **Adjacent suburb expansion:** The listed suburb plus all directly adjacent suburbs (agents often list in a "better" neighbouring suburb). Pre-configured adjacency map for all 12 target suburbs.
2. **Price/size filter:** Cross-reference listing price and plot size against known property value ranges per suburb area to exclude unlikely zones.
3. **Architectural style filter:** Older face-brick houses concentrate in specific parts of these suburbs (e.g., 1960s–70s stock near the Moot). Use this to prioritise certain areas.

**Output:** Ordered list of suburb zones to scan, with priority ranking.

### 3.4 Satellite Tile Scanner

**Input:** Target suburb zones + property fingerprint

**Process:**
1. Divide each suburb zone into a grid of tiles (~100m × 100m)
2. Fetch Google Maps Static API satellite image for each tile at zoom level 19–20
3. Send each tile to Claude Vision: "Does any property in this tile match these features: [pool shape], [roof colour/type], [driveway pattern]?"
4. Flag matching tiles as candidates
5. For matching tiles, zoom in on individual properties for detailed comparison

**Cost control strategies:**
- **Pre-cache suburb tiles:** Download satellite images for all 12 suburbs once (~R50 one-time cost per suburb). Reuse for all future searches.
- **Smart filtering:** If the fingerprint says "has a pool," skip all tiles where no pool is visible. Eliminates 60–70% of tiles immediately.
- **Feature index (Phase 2):** Over time, build a database indexing each property's aerial features. Future searches query the index instead of re-scanning tiles.

**Output:** List of candidate property locations (GPS coordinates).

### 3.5 Street View Verifier

**Input:** Candidate locations + listing exterior photos

**Process:**
1. For each candidate (typically 3–10):
   - Fetch Google Street View Static API image at the candidate address
   - Multiple headings (angles) if needed
2. Send to Claude Vision: "Compare this Street View image with the listing front-of-house photo. Score the match on: boundary wall, gate style, facade, garage, roof visible from street, neighbouring properties."
3. Score each candidate: High (80%+), Medium (50–80%), Low (<50%)

**Considerations:**
- Street View imagery can be 1–5 years old. Properties may have been renovated.
- Weight structural features (roof shape, plot layout) higher than cosmetic features (paint colour, garden maturity).
- Historical Street View: Google keeps older captures. If current view doesn't match, check older imagery — listing photos may show the pre-renovation state.

**Output:** Ranked candidates with confidence scores and match explanations.

### 3.6 Results & UI

Three main screens:

#### Screen 1: Dashboard
- Clean URL-paste input field with "Search" button
- "Upload screenshots" fallback link
- Recent search history with status badges:
  - Green: "92% match found"
  - Yellow: "3 candidates (65%)"
  - Red: "No match"

#### Screen 2: Processing
- Live progress indicator showing each pipeline stage
- Displays extracted features as they're identified
- Progress bar for satellite scan (e.g., "Tile 34 of 120")
- Expected duration: 1–3 minutes per search

#### Screen 3: Results
- **Three-way comparison panel:** Listing Photo | Street View | Satellite — side by side
- **Feature match breakdown:** Each feature listed with check/cross and which source confirmed it (street view, satellite, or both)
- **AI explanation:** Plain-English paragraph explaining why the AI thinks it's a match, including observations about neighbours, vegetation age, etc.
- **Listing photo strip:** Scrollable thumbnails of all listing photos, colour-coded by which were used for street matching, satellite matching, or contained street clues
- **Action buttons:**
  - "Confirm Match" — saves to database as confirmed
  - "Open in Google Maps" — opens location in Google Maps
  - "Not a match" — rejects candidate, shows next
- **Other candidates:** Listed below with condensed feature match and confidence score
- **Drive-by route:** "Plan drive-by route" button — opens Google Maps navigation with all candidates as waypoints

---

## 4. Feature Roadmap

### MVP (Build First)

1. **Paste URL & Identify** — Core pipeline end-to-end
2. **Manual Photo Upload** — Drag-and-drop fallback
3. **Results with Three-Way Comparison** — Listing photo / Street View / Satellite
4. **Search History** — All past searches saved with results, confirmations, rejections

### Phase 2 — Smart Features (After MVP Proves Out)

5. **Suburb Intelligence Cache** — Pre-scan and index all 12 suburbs. Every property catalogued by roof type, pool, boundary style, driveway. Future searches query the index instead of live scanning — near-instant results.
6. **Mandate Expiry Tracker** — Estimate when competitor's mandate expires (typically 3 months from listing date). Alert: "This mandate likely expires in ~6 weeks — add to follow-up?"
7. **New Listing Alerts** — Daily monitoring of Property24 for new competitor listings in the 12 suburbs. Notification via WhatsApp or email: "New listing in Queenswood — want me to identify it?"
8. **WhatsApp Integration** — One-tap sharing of results: property address, confidence score, Google Maps link, Street View photo.
9. **Drive-By Route Planner** — Batch all unconfirmed candidates from the week into an optimised driving route.
10. **Area Intelligence Dashboard** — Suburb activity trends, average listing prices, most active competing agents.

### Phase 3 — Power Features (If Commercialised)

11. **Multi-Agency / Team Support** — Shared suburb intelligence cache, user accounts, permissions.
12. **Deeds Office Integration** — Auto-lookup owner via WinDeed or similar after identification.
13. **PropCtrl / CRM Sync** — Push confirmed properties as leads into PropCtrl. Status tracking: identified → visited → contacted → listed.
14. **Configurable Areas** — Any agent can set up their own suburb cluster in any SA city. Subscription model per area.

---

## 5. Additional Identification Techniques

Beyond the core pipeline, these techniques improve identification accuracy:

- **Show day reconnaissance:** Agent attends a competitor's open house, photographs the approach/street. Upload those photos as extra clues — different angles, neighbouring houses, street views not available from Google.
- **Historical Street View:** When current Street View doesn't match (property was renovated), check Google's older captures. Listing photos may show the pre-renovation state that matches older Street View.
- **Reverse image search:** Run listing photos through Google reverse image search. Sometimes the same property appears on other portals, blogs, or old listings with the address visible.
- **Municipal records cross-reference:** City of Tshwane municipal valuation rolls are available online. Cross-reference bedrooms, plot size, and valuation with listing data to narrow candidates.
- **For-sale board detection:** When scanning Street View imagery, detect competitor "For Sale" boards. Confirms active listings and their approximate location.
- **Neighbour matching:** If listing photos show neighbouring properties with distinctive features, identify the neighbours first (often easier — visible house numbers, unique features). The target is immediately next door.

---

## 6. Data Model

### Listing
- `id` — UUID
- `property24_url` — Original URL
- `listed_suburb` — Suburb from listing
- `price` — Listed price
- `bedrooms`, `bathrooms`, `parking` — Counts
- `plot_size`, `floor_size` — Square metres
- `property_type` — house, townhouse, etc.
- `description` — Listing text
- `agent_name`, `agency_name` — Competitor info
- `listing_date` — When first listed (for mandate tracking)
- `photos` — JSON array of photo URLs/paths
- `created_at` — When search was initiated

### PropertyFingerprint
- `id` — UUID
- `listing_id` — FK to Listing
- `house_number` — If detected (nullable)
- `street_clue` — If detected (nullable)
- `exterior_finish` — face brick / plaster / painted
- `roof_type` — tiles / IBR / thatch
- `roof_colour` — terracotta / charcoal / green / etc.
- `storeys` — Number
- `fence_type` — palisade / wall / precast
- `garage_count` — Number
- `pool_shape` — kidney / rectangle / freeform / none
- `driveway_type` — circular / straight / double
- `solar_panels` — Boolean
- `features_json` — Full structured feature data from AI
- `quick_wins` — Any instant-identification clues found

### Candidate
- `id` — UUID
- `listing_id` — FK to Listing
- `address` — Estimated street address
- `latitude`, `longitude` — GPS coordinates
- `confidence_score` — 0–100
- `confidence_level` — high / medium / low
- `satellite_match_score` — 0–100
- `streetview_match_score` — 0–100
- `feature_matches` — JSON of which features matched/mismatched
- `ai_explanation` — Plain-English reasoning
- `streetview_image_url` — Cached Street View image
- `satellite_image_url` — Cached satellite image
- `status` — pending / confirmed / rejected
- `confirmed_at` — Timestamp

### SuburbTile (for satellite cache)
- `id` — UUID
- `suburb` — Suburb name
- `tile_x`, `tile_y` — Grid position
- `bounds` — GPS bounding box
- `satellite_image_path` — Cached image file
- `features_index` — JSON of detected features per property in tile
- `last_scanned` — Timestamp

---

## 7. API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/search` | Start a new property search from URL or uploaded photos |
| GET | `/api/search/:id` | Get search status and results |
| GET | `/api/search/:id/progress` | SSE stream for live progress updates |
| PATCH | `/api/candidate/:id` | Confirm or reject a candidate |
| GET | `/api/history` | List all past searches |
| GET | `/api/route` | Generate drive-by route for unconfirmed candidates |
| POST | `/api/upload` | Upload photos manually |

---

## 8. External API Usage

### Google Maps Platform

| API | Usage | Free Tier |
|-----|-------|-----------|
| Maps Static API (satellite) | Fetch satellite tiles for suburb scanning | $200/month credit covers ~28,000 requests |
| Street View Static API | Fetch street-level images for verification | $200/month credit covers ~28,000 requests |
| Geocoding API | Convert addresses to GPS coordinates | $200/month credit covers ~40,000 requests |
| Maps JavaScript API | Interactive map on results page | $200/month credit covers ~28,000 loads |

All covered by the $200/month free tier for this usage volume.

### Claude API (Vision)

| Task | Estimated Tokens per Search |
|------|----------------------------|
| Feature extraction (18 photos) | ~20,000 input + ~2,000 output |
| Satellite tile scanning (50–120 tiles) | ~100,000 input + ~10,000 output |
| Street View verification (3–10 candidates) | ~15,000 input + ~3,000 output |
| **Total per search** | **~135,000 input + ~15,000 output** |

At ~8 searches/week: approximately $15–25/month (R250–400).

---

## 9. Security & Legal Considerations

- **Property24 ToS:** No automated bulk scraping. The tool fetches a single listing page per search (equivalent to a browser visit). Manual upload fallback available.
- **Google Maps ToS:** All imagery used via official APIs with proper attribution. Satellite images cached locally for performance but not redistributed.
- **Personal information:** The tool identifies property addresses, not personal data. Owner lookup (Phase 3) would use official channels (Deeds Office).
- **API keys:** Stored server-side in environment variables, never exposed to the client.

---

## 10. Success Criteria (MVP)

The POC is successful if:

1. Given a Property24 listing URL, the tool correctly identifies the property address within the top 3 candidates at least 60% of the time
2. The full pipeline completes in under 3 minutes per search
3. Monthly running cost stays under R500
4. A non-technical estate agent can use the tool with no training beyond a 2-minute walkthrough
