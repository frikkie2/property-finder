"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SearchStatus } from "@/lib/types";

interface HistoryItem {
  id: string;
  property24_url: string;
  listed_suburb: string | null;
  status: SearchStatus;
  created_at: string;
  candidate_count?: number;
}

function StatusBadge({ status }: { status: SearchStatus }) {
  if (status === "complete") {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
        Complete
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800">
      In progress
    </span>
  );
}

export default function SearchHistory() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/search")
      .then((r) => r.json())
      .then((data) => {
        setHistory(Array.isArray(data) ? data : []);
      })
      .catch(() => setError("Could not load search history."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-sm text-gray-500">Loading history…</p>;
  }
  if (error) {
    return <p className="text-sm text-red-500">{error}</p>;
  }
  if (history.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No searches yet. Paste a Property24 URL above to get started.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white overflow-hidden">
      {history.map((item) => {
        const date = new Date(item.created_at).toLocaleDateString("en-ZA", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
        const shortUrl = item.property24_url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60);
        return (
          <li key={item.id}>
            <Link
              href={`/search/${item.id}`}
              className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-gray-50 transition-colors"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{shortUrl}</p>
                <p className="text-xs text-gray-500">
                  {item.listed_suburb ? `${item.listed_suburb} · ` : ""}
                  {date}
                </p>
              </div>
              <StatusBadge status={item.status} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
