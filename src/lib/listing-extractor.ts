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

  // Photos — collect only listing gallery photos, skip agent/agency photos
  const photoUrls: string[] = [];
  const seen = new Set<string>();

  // Selectors for agent/branding areas — EXCLUDE images inside these
  const EXCLUDE_SELECTORS = [
    ".p24_agentDetail",
    ".p24_agentName",
    ".p24_agencyName",
    ".p24_agent",
    ".p24_agency",
    ".agent-card",
    ".agent-photo",
    ".agency-logo",
    ".p24_branding",
    ".p24_footer",
    ".p24_header",
    ".p24_menu",
    ".p24_sidebar",
  ].join(", ");

  // URL patterns that indicate non-property images
  function isLikelyPropertyPhoto(src: string): boolean {
    if (!src || !src.startsWith("http")) return false;
    if (src.endsWith(".svg")) return false;

    // Property24 listing photos go through images.prop24.com or similar
    // with numeric paths like /375825252/... — agents/logos have different patterns
    const lower = src.toLowerCase();
    if (lower.includes("/logos/")) return false;
    if (lower.includes("/icons/")) return false;
    if (lower.includes("/agent")) return false;
    if (lower.includes("/agency")) return false;
    if (lower.includes("/agencies/")) return false;
    if (lower.includes("/branding/")) return false;
    if (lower.includes("/avatar")) return false;
    if (lower.includes("/profile")) return false;
    if (lower.includes("logo.")) return false;
    if (lower.includes("banner")) return false;
    if (lower.includes("headshot")) return false;
    // Small thumbnails likely icons (Property24 uses /Ensure40x40 etc for icons)
    if (/\/ensure\d{1,3}x\d{1,3}\b/i.test(src)) return false;

    // Must be from property24 image CDN
    if (!src.includes("prop24.com") && !src.includes("property24.com") && !src.includes("p24")) {
      return false;
    }

    return true;
  }

  // Pass 1: try the listing gallery specifically
  $(".p24_galleryThumbnails img, .p24_mainPhoto img, .p24_photo img, .gallery img, .p24_photoGallery img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || "";
    if (isLikelyPropertyPhoto(src) && !seen.has(src)) {
      seen.add(src);
      photoUrls.push(src);
    }
  });

  // Pass 2: check all images (even in galleries might be lazy-loaded)
  // Try every src-like attribute
  $("img").each((_, el) => {
    const $el = $(el);
    // Skip if inside an excluded container (agent/agency/branding)
    if ($el.closest(EXCLUDE_SELECTORS).length > 0) return;

    const candidateAttrs = [
      "src",
      "data-src",
      "data-lazy-src",
      "data-original",
      "data-hi-res-src",
      "data-full",
      "data-image",
    ];

    for (const attr of candidateAttrs) {
      const src = $el.attr(attr) || "";
      if (isLikelyPropertyPhoto(src) && !seen.has(src)) {
        seen.add(src);
        photoUrls.push(src);
      }
    }
  });

  // Pass 3: scrape image URLs from JSON embedded in the page (common for SPAs)
  const rawHtml = html;
  const urlRegex = /https?:\/\/[^"'\s)]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s)]*)?/gi;
  const jsonMatches = rawHtml.match(urlRegex) || [];
  for (const url of jsonMatches) {
    // Remove any trailing punctuation
    const cleaned = url.replace(/[,;)}]+$/, "");
    if (isLikelyPropertyPhoto(cleaned) && !seen.has(cleaned)) {
      seen.add(cleaned);
      photoUrls.push(cleaned);
    }
  }

  // Pass 4: JSON-LD structured data (many sites include all images there)
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).html() || "";
      const data = JSON.parse(raw);
      const images = Array.isArray(data.image) ? data.image : data.image ? [data.image] : [];
      for (const img of images) {
        const url = typeof img === "string" ? img : img.url;
        if (isLikelyPropertyPhoto(url) && !seen.has(url)) {
          seen.add(url);
          photoUrls.push(url);
        }
      }
    } catch {
      // ignore parse errors
    }
  });

  // Pass 5: Open Graph meta tags (usually has main photo)
  $('meta[property="og:image"], meta[name="twitter:image"]').each((_, el) => {
    const content = $(el).attr("content") || "";
    if (isLikelyPropertyPhoto(content) && !seen.has(content)) {
      seen.add(content);
      photoUrls.push(content);
    }
  });

  console.log(`[EXTRACTOR] Found ${photoUrls.length} photos for ${url}`);

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
