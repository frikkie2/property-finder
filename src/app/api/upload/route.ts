import { NextRequest, NextResponse } from "next/server";
import { createSearch, updateSearchListingData } from "@/lib/db";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const files = formData.getAll("photos") as File[];
  const suburb = (formData.get("suburb") as string) || "Unknown";

  if (files.length === 0) {
    return NextResponse.json({ error: "No photos uploaded" }, { status: 400 });
  }

  const uploadDir = path.join(process.cwd(), "data", "uploads", uuidv4());
  fs.mkdirSync(uploadDir, { recursive: true });

  const photoUrls: string[] = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = `${uuidv4()}-${file.name}`;
    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, buffer);
    photoUrls.push(`/uploads/${path.basename(uploadDir)}/${filename}`);
  }

  const searchId = createSearch("manual-upload", suburb, {});
  updateSearchListingData(
    searchId,
    JSON.stringify({
      property24Url: "manual-upload",
      listedSuburb: suburb,
      photoUrls,
      price: null,
      bedrooms: null,
      bathrooms: null,
      parking: null,
      plotSize: null,
      floorSize: null,
      propertyType: null,
      description: "",
      agentName: null,
      agencyName: null,
      listingDate: null,
    })
  );

  return NextResponse.json({ searchId, photoCount: files.length });
}
