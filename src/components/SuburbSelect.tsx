"use client";

import { useEffect, useState } from "react";

interface IndexSummary { slug: string; street: string; suburb: string; houseCount: number; }

interface SuburbOption { suburb: string; streets: string[]; houses: number; }

/**
 * Multi-select of the suburbs that have been indexed. Shared by the link and
 * upload search sections. Calls onChange with the list of selected suburbs.
 */
export default function SuburbSelect({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (suburbs: string[]) => void;
}) {
  const [options, setOptions] = useState<SuburbOption[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/index-street")
      .then((r) => r.json())
      .then((d) => {
        const list: IndexSummary[] = d.indexes ?? [];
        const bySuburb = new Map<string, SuburbOption>();
        for (const i of list) {
          const o = bySuburb.get(i.suburb) ?? { suburb: i.suburb, streets: [], houses: 0 };
          o.streets.push(i.street);
          o.houses += i.houseCount;
          bySuburb.set(i.suburb, o);
        }
        const opts = [...bySuburb.values()].sort((a, b) => a.suburb.localeCompare(b.suburb));
        setOptions(opts);
        setLoaded(true);
        // Auto-select if exactly one suburb is indexed.
        if (opts.length === 1 && selected.length === 0) onChange([opts[0].suburb]);
      })
      .catch(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(suburb: string) {
    onChange(selected.includes(suburb) ? selected.filter((s) => s !== suburb) : [...selected, suburb]);
  }

  if (loaded && options.length === 0) {
    return (
      <p className="text-xs text-amber-600">
        No suburbs indexed yet — decode a street first, then it will appear here to search against.
      </p>
    );
  }

  return (
    <div>
      <p className="text-xs font-medium text-gray-600 mb-1">Search in suburb(s):</p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = selected.includes(o.suburb);
          return (
            <button
              key={o.suburb}
              type="button"
              onClick={() => toggle(o.suburb)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                on
                  ? "border-blue-700 bg-blue-700 text-white"
                  : "border-gray-300 bg-white text-gray-700 hover:border-blue-400"
              }`}
              title={`${o.streets.join(", ")} — ${o.houses} houses`}
            >
              {o.suburb} ({o.houses})
            </button>
          );
        })}
      </div>
    </div>
  );
}
