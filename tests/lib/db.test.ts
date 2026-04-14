import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, createSearch, getSearch, getSearchHistory, updateSearchStatus, upsertCandidate, updateCandidateStatus, closeDb } from "@/lib/db";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.join(__dirname, "../../data/test.db");

describe("database", () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    process.env.DATABASE_PATH = TEST_DB_PATH;
  });

  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  it("creates tables on first getDb call", () => {
    const db = getDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("searches");
    expect(names).toContain("candidates");
  });

  it("creates and retrieves a search", () => {
    const id = createSearch("https://property24.com/123", "Queenswood", {
      price: 2500000,
      bedrooms: 3,
    });
    expect(id).toBeTruthy();

    const search = getSearch(id);
    expect(search).toBeTruthy();
    expect(search!.property24_url).toBe("https://property24.com/123");
    expect(search!.listed_suburb).toBe("Queenswood");
    expect(search!.status).toBe("extracting_listing");
  });

  it("updates search status", () => {
    const id = createSearch("https://property24.com/456", "Colbyn", {});
    updateSearchStatus(id, "analysing_photos", null);

    const search = getSearch(id);
    expect(search!.status).toBe("analysing_photos");
  });

  it("creates and retrieves candidates", () => {
    const searchId = createSearch("https://property24.com/789", "Moot", {});
    const candidateId = upsertCandidate({
      searchId,
      address: "12 Main Street, Moot",
      latitude: -25.73,
      longitude: 28.19,
      confidenceScore: 85,
      confidenceLevel: "high",
      satelliteMatchScore: 80,
      streetviewMatchScore: 90,
      featureMatches: JSON.stringify([{ feature: "pool", matched: true, source: "satellite" }]),
      aiExplanation: "Strong match based on pool and roof.",
      streetviewImageUrl: "/images/sv1.jpg",
      satelliteImageUrl: "/images/sat1.jpg",
    });

    expect(candidateId).toBeTruthy();

    const search = getSearch(searchId);
    expect(search!.candidates).toHaveLength(1);
    expect(search!.candidates[0].address).toBe("12 Main Street, Moot");
    expect(search!.candidates[0].confidence_score).toBe(85);
  });

  it("confirms and rejects candidates", () => {
    const searchId = createSearch("https://property24.com/999", "Waverley", {});
    const candId = upsertCandidate({
      searchId,
      address: "5 Test St",
      latitude: -25.74,
      longitude: 28.20,
      confidenceScore: 70,
      confidenceLevel: "medium",
      satelliteMatchScore: 65,
      streetviewMatchScore: 75,
      featureMatches: "[]",
      aiExplanation: "Decent match.",
      streetviewImageUrl: null,
      satelliteImageUrl: null,
    });

    updateCandidateStatus(candId, "confirmed");
    const search = getSearch(searchId);
    expect(search!.candidates[0].status).toBe("confirmed");
    expect(search!.candidates[0].confirmed_at).toBeTruthy();
  });

  it("returns search history ordered by most recent", () => {
    createSearch("https://property24.com/1", "Moot", {});
    createSearch("https://property24.com/2", "Colbyn", {});
    createSearch("https://property24.com/3", "Waverley", {});

    const history = getSearchHistory(10);
    expect(history).toHaveLength(3);
    expect(history[0].property24_url).toBe("https://property24.com/3");
  });
});
