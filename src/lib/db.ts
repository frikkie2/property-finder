import Database from "better-sqlite3";
import path from "path";
import { v4 as uuidv4 } from "uuid";

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath =
    process.env.DATABASE_PATH ||
    path.join(process.cwd(), "data", "property-finder.db");
  const dir = path.dirname(dbPath);

  // Ensure directory exists
  const fs = require("fs");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  migrate(_db);
  return _db;
}

/**
 * Close the current database connection and reset the cached reference.
 * Primarily used in tests so that each test run opens a fresh connection
 * against the new DATABASE_PATH set in beforeEach.
 */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === column);
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS searches (
      id TEXT PRIMARY KEY,
      property24_url TEXT NOT NULL,
      listed_suburb TEXT NOT NULL,
      listing_data TEXT DEFAULT '{}',
      fingerprint TEXT DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'extracting_listing',
      progress_detail TEXT DEFAULT NULL,
      error_message TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      search_id TEXT NOT NULL REFERENCES searches(id),
      address TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      confidence_score INTEGER NOT NULL DEFAULT 0,
      confidence_level TEXT NOT NULL DEFAULT 'low',
      satellite_match_score INTEGER NOT NULL DEFAULT 0,
      streetview_match_score INTEGER NOT NULL DEFAULT 0,
      feature_matches TEXT NOT NULL DEFAULT '[]',
      ai_explanation TEXT NOT NULL DEFAULT '',
      streetview_image_url TEXT DEFAULT NULL,
      satellite_image_url TEXT DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      confirmed_at TEXT DEFAULT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_candidates_search_id ON candidates(search_id);
    CREATE INDEX IF NOT EXISTS idx_searches_created_at ON searches(created_at);
  `);

  // Auto-migrate: add columns that may not exist in older databases
  if (!columnExists(db, "searches", "progress_detail")) {
    db.exec(`ALTER TABLE searches ADD COLUMN progress_detail TEXT DEFAULT NULL`);
  }
}

export function createSearch(
  property24Url: string,
  listedSuburb: string,
  listingData: Record<string, unknown>
): string {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO searches (id, property24_url, listed_suburb, listing_data) VALUES (?, ?, ?, ?)`
  ).run(id, property24Url, listedSuburb, JSON.stringify(listingData));
  return id;
}

export function getSearch(id: string) {
  const db = getDb();
  const search = db.prepare(`SELECT * FROM searches WHERE id = ?`).get(id) as any;
  if (!search) return null;

  const candidates = db
    .prepare(
      `SELECT * FROM candidates WHERE search_id = ? ORDER BY confidence_score DESC`
    )
    .all(id);

  return { ...search, candidates };
}

export function updateSearchProgressDetail(id: string, detail: string) {
  const db = getDb();
  db.prepare(`UPDATE searches SET progress_detail = ? WHERE id = ?`).run(detail, id);
}

export function updateSearchStatus(
  id: string,
  status: string,
  errorMessage: string | null
) {
  const db = getDb();
  db.prepare(
    `UPDATE searches SET status = ?, error_message = ? WHERE id = ?`
  ).run(status, errorMessage, id);
}

export function updateSearchFingerprint(id: string, fingerprint: string) {
  const db = getDb();
  db.prepare(`UPDATE searches SET fingerprint = ? WHERE id = ?`).run(
    fingerprint,
    id
  );
}

export function updateSearchListingData(id: string, listingData: string) {
  const db = getDb();
  db.prepare(`UPDATE searches SET listing_data = ? WHERE id = ?`).run(
    listingData,
    id
  );
}

export function upsertCandidate(data: {
  searchId: string;
  address: string;
  latitude: number;
  longitude: number;
  confidenceScore: number;
  confidenceLevel: string;
  satelliteMatchScore: number;
  streetviewMatchScore: number;
  featureMatches: string;
  aiExplanation: string;
  streetviewImageUrl: string | null;
  satelliteImageUrl: string | null;
}): string {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO candidates (
       id, search_id, address, latitude, longitude, confidence_score,
       confidence_level, satellite_match_score, streetview_match_score,
       feature_matches, ai_explanation, streetview_image_url, satellite_image_url
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.searchId,
    data.address,
    data.latitude,
    data.longitude,
    data.confidenceScore,
    data.confidenceLevel,
    data.satelliteMatchScore,
    data.streetviewMatchScore,
    data.featureMatches,
    data.aiExplanation,
    data.streetviewImageUrl,
    data.satelliteImageUrl
  );
  return id;
}

export function updateCandidateStatus(
  id: string,
  status: "confirmed" | "rejected"
) {
  const db = getDb();
  const confirmedAt = status === "confirmed" ? new Date().toISOString() : null;
  db.prepare(
    `UPDATE candidates SET status = ?, confirmed_at = ? WHERE id = ?`
  ).run(status, confirmedAt, id);
}

export function getSearchHistory(limit: number = 20) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM searches ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as any[];
}
