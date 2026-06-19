import type { Candidate } from "@/lib/types";

interface Props {
  candidate: Candidate;
  rank: number;
  selected?: boolean;
}

export default function CandidateCard({ candidate, rank, selected }: Props) {
  const svPct = Math.round(candidate.streetviewMatchScore);
  const satPct = Math.round(candidate.satelliteMatchScore);
  const confirmed = candidate.status === "confirmed";
  const dot =
    candidate.confidenceLevel === "high" ? "#2f6b4f"
    : candidate.confidenceLevel === "medium" ? "#b8791f"
    : "#a8442a";

  return (
    <div
      className={`rounded-lg border bg-card p-3.5 flex flex-col gap-2 transition ${
        selected ? "border-clay ring-1 ring-clay/30" : "border-line hover:border-clay/40"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="font-mono text-[11px] text-muted">#{rank}{confirmed ? " · ✓ confirmed" : ""}</span>
          <h3 className="font-mono text-[13px] text-ink mt-0.5 leading-snug break-words">{candidate.address}</h3>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="h-2 w-2 rounded-full" style={{ background: dot }} />
          <span className="font-display text-lg text-ink leading-none">{candidate.confidenceScore}%</span>
        </div>
      </div>
      <div className="flex gap-3 data-label">
        <span>street <strong className="text-ink font-mono">{svPct}</strong></span>
        <span>aerial <strong className="text-ink font-mono">{satPct}</strong></span>
      </div>
    </div>
  );
}
