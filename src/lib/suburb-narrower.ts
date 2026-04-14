import type { SuburbBounds, SuburbZone, ListingData, PropertyFingerprint } from "./types";
import { SUBURBS, ADJACENCY } from "./suburb-data";

export function getSuburbByName(name: string): SuburbBounds | null {
  return SUBURBS.find((s) => s.name.toLowerCase() === name.toLowerCase()) || null;
}

export function getAdjacentSuburbs(suburbName: string): SuburbBounds[] {
  const adjacentNames = ADJACENCY[suburbName] || [];
  return adjacentNames
    .map((name) => getSuburbByName(name))
    .filter((s): s is SuburbBounds => s !== null);
}

export function narrowSuburbs(
  listing: ListingData,
  fingerprint: PropertyFingerprint
): SuburbZone[] {
  const zones: SuburbZone[] = [];

  const primary = getSuburbByName(listing.listedSuburb);
  if (primary) {
    zones.push({ suburb: primary, priority: 1 });
  }

  const adjacent = getAdjacentSuburbs(listing.listedSuburb);
  for (const suburb of adjacent) {
    zones.push({ suburb, priority: 2 });
  }

  if (!primary) {
    for (const suburb of SUBURBS) {
      if (!zones.find((z) => z.suburb.name === suburb.name)) {
        zones.push({ suburb, priority: 3 });
      }
    }
  }

  return zones;
}
