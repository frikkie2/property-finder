import { NextRequest, NextResponse } from "next/server";
import { createSearch, updateSearchListingData, getDb } from "@/lib/db";
import { runManualPhotoSearch } from "@/lib/manual-search";
import type { ListingData } from "@/lib/types";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const files = formData.getAll("photos") as File[];
  const suburb = ((formData.get("suburb") as string) || "").trim();
  const description = ((formData.get("description") as string) || "").trim();

  if (!files || files.length === 0) {
    return NextResponse.json({ error: "Please attach at least one photo." }, { status: 400 });
  }
  if (!suburb) {
    return NextResponse.json({ error: "Please choose the suburb." }, { status: 400 });
  }

  const searchId = createSearch("manual-upload", suburb, {});

  // Save photos under .cache/uploads/<searchId>/ — served to the browser and
  // read as base64 for the AI via the listingImage resolver.
  const uploadDir = path.join(process.cwd(), ".cache", "uploads", searchId);
  fs.mkdirSync(uploadDir, { recursive: true });

  const photoUrls: string[] = [];
  for (const file of files) {
    if (!file.type?.startsWith("image/")) continue;
    const buffer = Buffer.from(await file.arrayBuffer());
    const safe = `${String(photoUrls.length + 1).padStart(2, "0")}-${(file.name || "photo").replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    fs.writeFileSync(path.join(uploadDir, safe), buffer);
    photoUrls.push(`/api/uploads/${searchId}/${encodeURIComponent(safe)}`);
  }

  if (photoUrls.length === 0) {
    return NextResponse.json({ error: "No valid image files were attached." }, { status: 400 });
  }

  const listing: ListingData = {
    property24Url: "manual-upload",
    listedSuburb: suburb,
    price: null,
    bedrooms: null,
    bathrooms: null,
    parking: null,
    plotSize: null,
    floorSize: null,
    propertyType: null,
    description,
    agentName: null,
    agencyName: null,
    listingDate: null,
    photoUrls,
  };
  updateSearchListingData(searchId, JSON.stringify(listing));
  getDb().prepare("UPDATE searches SET listed_suburb = ?, status = ? WHERE id = ?").run(suburb, "analysing_photos", searchId);

  // Run in the background; the results page polls.
  runManualPhotoSearch(searchId, listing).catch((err) =>
    console.error("[UPLOAD] pipeline error:", err)
  );

  return NextResponse.json({ id: searchId, status: "analysing_photos", photoCount: photoUrls.length });
}
