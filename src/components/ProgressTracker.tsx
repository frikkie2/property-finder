import type { SearchStatus } from "@/lib/types";

const STEPS: { key: SearchStatus; label: string }[] = [
  { key: "extracting_listing", label: "Extracting listing" },
  { key: "analysing_photos", label: "Analysing photos" },
  { key: "narrowing_suburbs", label: "Narrowing suburbs" },
  { key: "scanning_satellite", label: "Scanning satellite" },
  { key: "verifying_streetview", label: "Verifying street view" },
  { key: "ranking_results", label: "Ranking results" },
  { key: "complete", label: "Complete" },
];

const STEP_ORDER = STEPS.map((s) => s.key);

type StepState = "done" | "active" | "pending" | "failed";

function stepState(stepKey: SearchStatus, currentStatus: SearchStatus): StepState {
  if (currentStatus === "failed") {
    const currentIdx = STEP_ORDER.indexOf(currentStatus);
    const stepIdx = STEP_ORDER.indexOf(stepKey);
    if (stepIdx < currentIdx) return "done";
    if (stepIdx === currentIdx) return "failed";
    return "pending";
  }
  const currentIdx = STEP_ORDER.indexOf(currentStatus);
  const stepIdx = STEP_ORDER.indexOf(stepKey);
  if (stepIdx < currentIdx) return "done";
  if (stepIdx === currentIdx) return "active";
  return "pending";
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-green-600 text-white text-xs font-bold">
        ✓
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-700 ring-4 ring-blue-200">
        <span className="h-2.5 w-2.5 rounded-full bg-white animate-pulse" />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-600 text-white text-xs font-bold">
        ✗
      </span>
    );
  }
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-gray-300 bg-white" />
  );
}

interface Props {
  status: SearchStatus;
  message?: string;
}

export default function ProgressTracker({ status, message }: Props) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="text-base font-semibold text-gray-900 mb-5">Search progress</h2>
      {message && (
        <p className="mb-4 text-sm text-gray-600">{message}</p>
      )}
      <ol className="space-y-3">
        {STEPS.map((step, i) => {
          const state = stepState(step.key, status);
          return (
            <li key={step.key} className="flex items-center gap-3">
              <StepIcon state={state} />
              <span
                className={`text-sm ${
                  state === "active"
                    ? "font-semibold text-blue-700"
                    : state === "done"
                    ? "text-gray-700"
                    : state === "failed"
                    ? "font-semibold text-red-600"
                    : "text-gray-400"
                }`}
              >
                {step.label}
              </span>
              {i < STEPS.length - 1 && (
                <div
                  className={`ml-3 h-0.5 flex-1 rounded ${
                    state === "done" ? "bg-green-400" : "bg-gray-200"
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
