"use client";

interface RoofSegment {
  center: { latitude: number; longitude: number };
  boundingBox: {
    sw: { latitude: number; longitude: number };
    ne: { latitude: number; longitude: number };
  };
  areaMeters2: number;
  pitchDegrees: number;
  azimuthDegrees: number;
}

interface BuildingData {
  name: string;
  center: { latitude: number; longitude: number };
  boundingBox: {
    sw: { latitude: number; longitude: number };
    ne: { latitude: number; longitude: number };
  };
  roofSegments: RoofSegment[];
  totalRoofArea: number;
  hasSolarPanels: boolean;
  score: number;
  confidence: string;
  reasons: string[];
}

export default function RoofSketch({ building, size = 120 }: { building: BuildingData; size?: number }) {
  const bb = building.boundingBox;
  const width = Math.abs(bb.ne.longitude - bb.sw.longitude);
  const height = Math.abs(bb.ne.latitude - bb.sw.latitude);

  // Add some padding
  const pad = 0.1;
  const vbWidth = width * (1 + pad * 2);
  const vbHeight = height * (1 + pad * 2);

  // Convert lat/lng to SVG coords (flip Y since lat increases up but SVG y increases down)
  function toSvg(lat: number, lng: number): [number, number] {
    const x = ((lng - bb.sw.longitude) / width) * size;
    const y = size - ((lat - bb.sw.latitude) / height) * size;
    return [x, y];
  }

  // Colour by azimuth (roof direction)
  function segmentColour(azimuth: number): string {
    // Normalise to 0-360
    const a = ((azimuth % 360) + 360) % 360;
    // Different azimuths get different colours for visual distinction
    if (a < 45 || a >= 315) return "#3b82f6"; // north - blue
    if (a < 135) return "#10b981"; // east - green
    if (a < 225) return "#f59e0b"; // south - amber
    return "#8b5cf6"; // west - purple
  }

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="border border-gray-300 bg-gray-50 rounded">
        {/* Building outline */}
        <rect
          x={0}
          y={0}
          width={size}
          height={size}
          fill="transparent"
          stroke="#9ca3af"
          strokeWidth="0.5"
          strokeDasharray="2,2"
        />

        {/* Roof segments */}
        {building.roofSegments.map((seg, i) => {
          const [x1, y1] = toSvg(seg.boundingBox.sw.latitude, seg.boundingBox.sw.longitude);
          const [x2, y2] = toSvg(seg.boundingBox.ne.latitude, seg.boundingBox.ne.longitude);
          const x = Math.min(x1, x2);
          const y = Math.min(y1, y2);
          const w = Math.abs(x2 - x1);
          const h = Math.abs(y2 - y1);

          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                fill={segmentColour(seg.azimuthDegrees)}
                fillOpacity="0.4"
                stroke={segmentColour(seg.azimuthDegrees)}
                strokeWidth="1"
              />
            </g>
          );
        })}

        {/* Center marker */}
        {(() => {
          const [cx, cy] = toSvg(building.center.latitude, building.center.longitude);
          return <circle cx={cx} cy={cy} r="2" fill="#ef4444" />;
        })()}
      </svg>
      <div className="text-[10px] text-gray-600 mt-1 text-center">
        {building.roofSegments.length} segments · {Math.round(building.totalRoofArea)}m²
      </div>
    </div>
  );
}
