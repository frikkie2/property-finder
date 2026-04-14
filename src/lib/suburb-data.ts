import type { SuburbBounds } from "./types";

// Approximate bounding boxes for Pretoria East suburbs
export const SUBURBS: SuburbBounds[] = [
  { name: "Moot", north: -25.720, south: -25.740, east: 28.205, west: 28.185 },
  { name: "Queenswood", north: -25.725, south: -25.745, east: 28.230, west: 28.205 },
  { name: "Kilner Park", north: -25.710, south: -25.725, east: 28.230, west: 28.210 },
  { name: "Weavind Park", north: -25.700, south: -25.715, east: 28.225, west: 28.205 },
  { name: "Capital Park", north: -25.720, south: -25.735, east: 28.210, west: 28.190 },
  { name: "Colbyn", north: -25.740, south: -25.755, east: 28.225, west: 28.205 },
  { name: "Moregloed", north: -25.710, south: -25.725, east: 28.250, west: 28.230 },
  { name: "Waverley", north: -25.735, south: -25.755, east: 28.250, west: 28.225 },
  { name: "Villieria", north: -25.715, south: -25.735, east: 28.215, west: 28.195 },
  { name: "Rietondale", north: -25.740, south: -25.755, east: 28.210, west: 28.190 },
  { name: "Meyerspark", north: -25.725, south: -25.745, east: 28.260, west: 28.235 },
  { name: "Silverton", north: -25.720, south: -25.745, east: 28.280, west: 28.255 },
];

export const ADJACENCY: Record<string, string[]> = {
  "Moot": ["Queenswood", "Capital Park", "Villieria"],
  "Queenswood": ["Moot", "Kilner Park", "Colbyn", "Rietondale", "Villieria", "Moregloed"],
  "Kilner Park": ["Queenswood", "Weavind Park", "Moregloed"],
  "Weavind Park": ["Kilner Park", "Capital Park"],
  "Capital Park": ["Moot", "Weavind Park", "Villieria", "Rietondale"],
  "Colbyn": ["Queenswood", "Waverley", "Rietondale"],
  "Moregloed": ["Queenswood", "Kilner Park", "Meyerspark"],
  "Waverley": ["Colbyn", "Meyerspark", "Queenswood"],
  "Villieria": ["Moot", "Queenswood", "Capital Park"],
  "Rietondale": ["Queenswood", "Colbyn", "Capital Park"],
  "Meyerspark": ["Moregloed", "Waverley", "Silverton"],
  "Silverton": ["Meyerspark"],
};
