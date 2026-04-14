import * as cheerio from "cheerio";
import type { ListingData } from "./types";

export function parseListingHtml(html: string, url: string): ListingData {
  const $ = cheerio.load(html);

  // Extract suburb from title — pattern: "X Bedroom House for sale in SUBURB"
  const title = $(".p24_propertyTitle").text().trim() || $("title").text().trim();
  const suburbMatch = title.match(/(?:for sale|to rent) in (.+?)(?:\s*-|$)/i);
  const listedSuburb = suburbMatch ? suburbMatch[1].trim() : "";

  // Price — "R 2 450 000" → 2450000
  const priceText = $(".p24_price").first().text().trim();
  const price = parsePrice(priceText);

  // Features — bedrooms, bathrooms, garages
  const bedrooms = extractFeatureCount($, "Bedrooms");
  const bathrooms = extractFeatureCount($, "Bathrooms");
  const parking = extractFeatureCount($, "Garages") || extractFeatureCount($, "Parking");

  // Sizes
  const plotSize = extractSize($, "Erf Size");
  const floorSize = extractSize($, "Floor Size");

  // Property type from title
  const typeMatch = title.match(/\d+\s+Bedroom\s+(\w+)/i);
  const propertyType = typeMatch ? typeMatch[1].toLowerCase() : null;

  // Description
  const description = $(".p24_description").text().trim();

  // Agent
  const agentName = $(".p24_agentName").first().text().trim() || null;
  const agencyName = $(".p24_agencyName").first().text().trim() || null;

  // Photos — collect all unique image URLs (must be absolute HTTP URLs of actual photos)
  const photoUrls: string[] = [];
  const seen = new Set<string>();

  $("img").each((_, el) => {
    let src = $(el).attr("src") || $(el).attr("data-src") || "";

    // Skip empty, relative URLs, SVGs, logos, icons
    if (!src) return;
    if (!src.startsWith("http")) return;
    if (src.endsWith(".svg")) return;
    if (src.includes("/Logos/")) return;
    if (src.includes("/icons/")) return;

    // Only keep actual property listing images
    if ((src.includes("prop24") || src.includes("property24") || src.includes("images")) && !seen.has(src)) {
      seen.add(src);
      photoUrls.push(src);
    }
  });

  return {
    property24Url: url,
    listedSuburb,
    price,
    bedrooms,
    bathrooms,
    parking,
    plotSize,
    floorSize,
    propertyType,
    description,
    agentName,
    agencyName,
    listingDate: null,
    photoUrls,
  };
}

export async function extractListingFromUrl(url: string): Promise<ListingData> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch listing: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  return parseListingHtml(html, url);
}

function parsePrice(text: string): number | null {
  const cleaned = text.replace(/[^0-9]/g, "");
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
}

type CheerioRoot = ReturnType<typeof cheerio.load>;

function extractFeatureCount($: CheerioRoot, title: string): number | null {
  const el = $(`.p24_featureDetail[title="${title}"]`).first();
  if (!el.length) return null;
  const num = parseInt(el.text().trim(), 10);
  return isNaN(num) ? null : num;
}

function extractSize($: CheerioRoot, label: string): number | null {
  let value: string | null = null;

  $(".p24_propertyOverviewKey").each((_, el) => {
    if ($(el).text().trim() === label) {
      value = $(el).next(".p24_propertyOverviewValue").text().trim();
    }
  });

  if (!value) return null;
  const num = parseInt((value as string).replace(/[^0-9]/g, ""), 10);
  return isNaN(num) ? null : num;
}
