// --- Listing ---

export interface ListingData {
  property24Url: string;
  listedSuburb: string;
  price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  plotSize: number | null;
  floorSize: number | null;
  propertyType: string | null;
  description: string;
  agentName: string | null;
  agencyName: string | null;
  listingDate: string | null;
  photoUrls: string[];
}

// --- Property Fingerprint ---

export type ExteriorFinish = "face_brick" | "plaster" | "painted" | "mixed" | "unknown";
export type RoofType = "tiles" | "ibr_sheeting" | "thatch" | "concrete" | "unknown";
export type FenceType = "palisade" | "wall" | "precast" | "face_brick" | "none" | "unknown";
export type PoolShape = "kidney" | "rectangle" | "freeform" | "round" | "none" | "unknown";
export type DrivewayType = "circular" | "straight" | "double" | "none" | "unknown";
export type ConfidenceLevel = "high" | "medium" | "low";

export interface PropertyFingerprint {
  houseNumber: string | null;
  streetClue: string | null;
  exteriorFinish: ExteriorFinish;
  exteriorColour: string | null;
  roofType: RoofType;
  roofColour: string | null;
  storeys: number;
  fenceType: FenceType;
  garageCount: number;
  poolShape: PoolShape;
  drivewayType: DrivewayType;
  solarPanels: boolean;
  notableFeatures: string[];
  landmarks: string[];
  neighbourFeatures: string[];
  quickWins: QuickWin[];
  /** What this property looks like from directly above — drives the satellite sweep. */
  aerial: AerialSignature | null;
  /** What this property looks like from the street — drives Street View comparison. */
  facade: FacadeSignature | null;
}

export interface AerialSignature {
  roofShape: string;
  roofColour: string | null;
  poolPresent: boolean;
  poolShape: PoolShape;
  poolPosition: string | null;
  standSizeM2: number | null;
  drivewayDescription: string | null;
  treeCover: string | null;
  outbuildings: string[];
  distinctiveAerial: string[];
  /** One-paragraph description of the stand as seen from a satellite. */
  summary: string;
}

export interface FacadeSignature {
  /** One-paragraph description of the house as seen from the street. */
  summary: string;
  /** 1-indexed listing photo numbers that best show the street facade. */
  bestPhotoIndexes: number[];
}

/** A location flagged by the satellite sweep as possibly matching the listing. */
export interface SweepCandidate {
  lat: number;
  lng: number;
  confidence: ConfidenceLevel;
  matchedFeatures: string[];
  tileKey: string;
}

export interface QuickWin {
  type: "house_number" | "street_sign" | "landmark" | "sold_board" | "neighbour_id";
  value: string;
  confidence: ConfidenceLevel;
}

// --- Candidates ---

export interface FeatureMatch {
  feature: string;
  matched: boolean;
  source: "street_view" | "satellite" | "both";
  notes: string | null;
}

export interface Candidate {
  id: string;
  listingId: string;
  address: string;
  latitude: number;
  longitude: number;
  confidenceScore: number;
  confidenceLevel: ConfidenceLevel;
  satelliteMatchScore: number;
  streetviewMatchScore: number;
  featureMatches: FeatureMatch[];
  aiExplanation: string;
  streetviewImageUrl: string | null;
  satelliteImageUrl: string | null;
  status: "pending" | "confirmed" | "rejected";
  confirmedAt: string | null;
}

// --- Search ---

export type SearchStatus =
  | "extracting_listing"
  | "analysing_photos"
  | "narrowing_suburbs"
  | "scanning_satellite"
  | "verifying_streetview"
  | "ranking_results"
  | "complete"
  | "failed";

export interface SearchProgress {
  status: SearchStatus;
  message: string;
  detail: string | null;
  percentage: number;
}

export interface SearchResult {
  id: string;
  listing: ListingData;
  fingerprint: PropertyFingerprint | null;
  candidates: Candidate[];
  status: SearchStatus;
  errorMessage: string | null;
  createdAt: string;
}

// --- Suburb Data ---

export interface SuburbBounds {
  name: string;
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface SuburbZone {
  suburb: SuburbBounds;
  priority: number;
}

// --- Satellite Tiles ---

export interface TileBounds {
  north: number;
  south: number;
  east: number;
  west: number;
  centerLat: number;
  centerLng: number;
}

export interface SatelliteTileResult {
  tile: TileBounds;
  hasMatch: boolean;
  matchedProperties: TilePropertyMatch[];
}

export interface TilePropertyMatch {
  estimatedLat: number;
  estimatedLng: number;
  matchingFeatures: string[];
  confidence: ConfidenceLevel;
}
