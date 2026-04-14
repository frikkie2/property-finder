import type { FeatureMatch } from "@/lib/types";

interface Props {
  featureMatches: FeatureMatch[];
}

function SourceBadge({ source }: { source: FeatureMatch["source"] }) {
  const label = source === "both" ? "Both" : source === "street_view" ? "Street view" : "Satellite";
  return (
    <span className="rounded px-1.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-600">
      {label}
    </span>
  );
}

export default function FeatureMatchGrid({ featureMatches }: Props) {
  if (!featureMatches || featureMatches.length === 0) {
    return <p className="text-sm text-gray-500">No feature matches available.</p>;
  }

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-left">
            <th className="px-4 py-2 font-semibold text-gray-700 w-6" />
            <th className="px-4 py-2 font-semibold text-gray-700">Feature</th>
            <th className="px-4 py-2 font-semibold text-gray-700">Source</th>
            <th className="px-4 py-2 font-semibold text-gray-700">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {featureMatches.map((m, i) => (
            <tr
              key={i}
              className={m.matched ? "bg-green-50" : "bg-white"}
            >
              <td className="px-4 py-2 text-center">
                {m.matched ? (
                  <span className="text-green-600 font-bold text-base">&#10003;</span>
                ) : (
                  <span className="text-red-500 font-bold text-base">&#10007;</span>
                )}
              </td>
              <td className="px-4 py-2 text-gray-800 font-medium">{m.feature}</td>
              <td className="px-4 py-2">
                <SourceBadge source={m.source} />
              </td>
              <td className="px-4 py-2 text-gray-500 text-xs">{m.notes || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
