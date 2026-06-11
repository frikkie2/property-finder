import * as cheerio from "cheerio";
import type { ListingData } from "./types";
import { fetchPage } from "./net";

/**
 * Property24 serves every listing photo from images.prop24.com/<numericId>/<sizeVariant>.
 * The same photo appears at many sizes (Crop600x400, Ensure1280x720, bare id...).
 * We dedupe by numeric ID and request a consistent high-res variant.
 */
const PHOTO_VARIANT = "Ensure1280x720";

function photoUrlFor(id: string): string {
  return `https://images.prop24.com/${id}/${PHOTO_VARIANT}`;
}

function extractPhotoId(src: string): string | null {
  const match = src.match(/images\.prop24\.com\/(\d{6,})/i);
  return match ? match[1] : null;
}

export function parseListingHtml(html: string, url: string): ListingData {
  const $ = cheerio.load(html);

  // Suburb from title — "4 Bedroom House for sale in Silverton - Pretoria - Property24"
  const title = $(".p24_propertyTitle").text().trim() || $("title").text().trim();
  const suburbMatch = title.match(/(?:for sale|to rent) in (.+?)(?:\s*-|$)/i);
  const listedSuburb = suburbMatch ? suburbMatch[1].trim() : "";

  const priceText = $(".p24_price").first().text().trim();
  const price = parsePrice(priceText);

  const bedrooms = extractFeatureCount($, "Bedrooms");
  const bathrooms = extractFeatureCount($, "Bathrooms");
  const parking = extractFeatureCount($, "Garages") || extractFeatureCount($, "Parking");

  const plotSize = extractSize($, "Erf Size");
  const floorSize = extractSize($, "Floor Size");

  const typeMatch = title.match(/\d+\s+Bedroom\s+(\w+)/i);
  const propertyType = typeMatch ? typeMatch[1].toLowerCase() : null;

  // Full description: Property24 renders it inside .p24_descriptionContainer
  // (with the complete text in .p24_expandedText when long). The meta tag is
  // TRUNCATED — it loses key sentences like "with a swimming pool" — so it's
  // strictly a last resort.
  const description =
    $(".p24_expandedText").text().trim() ||
    $(".p24_descriptionContainer").text().replace(/Read full description|Close full description/g, "").trim() ||
    $(".p24_description").text().trim() ||
    $('meta[name="description"]').attr("content")?.trim() || "";

  const agentName = $(".p24_agentName").first().text().trim() || null;
  const agencyName = $(".p24_agencyName").first().text().trim() || null;

  // --- Photos ---
  const EXCLUDE_SELECTORS = [
    ".p24_agentDetail", ".p24_agentName", ".p24_agencyName", ".p24_agent",
    ".p24_agency", ".agent-card", ".agent-photo", ".agency-logo",
    ".p24_branding", ".p24_footer", ".p24_header", ".p24_menu", ".p24_sidebar",
    ".p24_similarListings", ".p24_results",
  ].join(", ");

  const galleryIds: string[] = [];
  const seen = new Set<string>();

  function addId(src: string | undefined, into: string[]) {
    if (!src) return;
    const id = extractPhotoId(src);
    if (id && !seen.has(id)) {
      seen.add(id);
      into.push(id);
    }
  }

  // Pass 1: gallery / lightbox containers (in DOM order = listing photo order)
  $(".p24_galleryThumbnails img, .p24_mainPhoto img, .p24_photo img, .gallery img, .p24_photoGallery img, [class*='gallery'] img, [class*='lightbox'] img").each((_, el) => {
    const $el = $(el);
    if ($el.closest(EXCLUDE_SELECTORS).length > 0) return;
    for (const attr of ["src", "data-src", "data-lazy-src", "data-original", "data-image-src", "lazy-src"]) {
      addId($el.attr(attr), galleryIds);
    }
  });

  // Pass 2: JSON-LD structured data
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() || "");
      const images = Array.isArray(data.image) ? data.image : data.image ? [data.image] : [];
      for (const img of images) {
        addId(typeof img === "string" ? img : img?.url, galleryIds);
      }
    } catch { /* ignore */ }
  });

  // Pass 3: og:image (always the main listing photo — prepend if new)
  const ogIds: string[] = [];
  addId($('meta[property="og:image"]').attr("content") || undefined, ogIds);

  // Pass 4 (fallback only): regex over raw HTML. This catches lazy-loaded
  // gallery JSON but can also pick up agent headshots, so only use it when
  // the DOM passes found too little.
  const fallbackIds: string[] = [];
  if (galleryIds.length < 3) {
    const matches = html.match(/images\.prop24\.com\/(\d{6,})/gi) || [];
    for (const m of matches) addId(m, fallbackIds);
  }

  const allIds = [...ogIds, ...galleryIds, ...fallbackIds];
  const photoUrls = allIds.map(photoUrlFor);

  console.log(`[EXTRACTOR] ${photoUrls.length} photos (gallery ${galleryIds.length}, og ${ogIds.length}, fallback ${fallbackIds.length}) for ${url}`);

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
  const page = await fetchPage(url);
  const listing = parseListingHtml(page.html, url);

  if (!listing.listedSuburb && !listing.photoUrls.length) {
    throw new Error(
      `Could not parse listing (fetched via ${page.via}, HTTP ${page.status}). ` +
      `Property24 may have changed their page structure.`
    );
  }
  return listing;
}

function parsePrice(text: string): number | null {
  const cleaned = text.replace(/[^0-9]/g, "");
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
}

type CheerioRoot = ReturnType<typeof cheerio.load>;

function extractFeatureCount($: CheerioRoot, title: string): number | null {
  // Current markup: <li class="p24_featureDetails" title="Bedrooms"><img/><span>4</span></li>
  // Older markup:   <span class="p24_featureDetail" title="Bedrooms">4</span>
  const el = $(`.p24_featureDetails[title="${title}"] span`).first().length
    ? $(`.p24_featureDetails[title="${title}"] span`).first()
    : $(`.p24_featureDetail[title="${title}"]`).first();
  if (!el.length) return null;
  const num = parseInt(el.text().trim(), 10);
  return isNaN(num) ? null : num;
}

function extractSize($: CheerioRoot, label: string): number | null {
  let value: string | null = null;

  // Current markup: <button title="Erf Size">...<span>1 500 m²</span></button>
  const btn = $(`button[title="${label}"]`).first();
  if (btn.length) value = btn.find("span").first().text().trim();

  // Older markup: overview key/value table
  if (!value) {
    $(".p24_propertyOverviewKey").each((_, el) => {
      if ($(el).text().trim() === label) {
        value = $(el).next(".p24_propertyOverviewValue").text().trim();
      }
    });
  }

  if (!value) return null;
  const num = parseInt((value as string).replace(/[^0-9]/g, ""), 10);
  return isNaN(num) ? null : num;
}
