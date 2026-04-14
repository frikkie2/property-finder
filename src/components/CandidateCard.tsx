import type { Candidate } from "@/lib/types";

interface Props {
  candidate: Candidate;
  rank: number;
}

function ConfidenceBadge({ level, score }: { level: Candidate["confidenceLevel"]; score: number }) {
  const colours: Record<string, string> = {
    high: "bg-green-100 text-green-800",
    medium: "bg-yellow-100 text-yellow-800",
    low: "bg-red-100 text-red-800",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${colours[level] ?? colours.low}`}>
      {Math.round(score * 100)}% {level}
    </span>
  );
}

export default function CandidateCard({ candidate, rank }: Props) {
  const svPct = Math.round(candidate.streetviewMatchScore * 100);
  const satPct = Math.round(candidate.satelliteMatchScore * 100);
  const matchedCount = candidate.featureMatches.filter((f) => f.matched).length;
  const totalCount = candidate.featureMatches.length;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="text-xs font-bold text-blue-700 uppercase tracking-wide">
            #{rank}
          </span>
          <h3 className="text-sm font-semibold text-gray-900 mt-0.5">{candidate.address}</h3>
        </div>
        <ConfidenceBadge level={candidate.confidenceLevel} score={candidate.confidenceScore} />
      </div>
      <div className="flex gap-4 text-xs text-gray-600">
        <span>
          Street view: <strong className="text-gray-800">{svPct}%</strong>
        </span>
        <span>
          Satellite: <strong className="text-gray-800">{satPct}%</strong>
        </span>
        <span>
          Features: <strong className="text-gray-800">{matchedCount}/{totalCount}</strong>
        </span>
      </div>
      {candidate.aiExplanation && (
        <p className="text-xs text-gray-600 line-clamp-2">{candidate.aiExplanation}</p>
      )}
    </div>
  );
}
