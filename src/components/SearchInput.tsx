"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SuburbSelect from "./SuburbSelect";

export default function SearchInput() {
  const [url, setUrl] = useState("");
  const [suburbs, setSuburbs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSearch() {
    if (!url.trim()) {
      setError("Please enter a Property24 URL.");
      return;
    }
    if (suburbs.length === 0) {
      setError("Pick at least one suburb to search in.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), suburbs }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }
      router.push(`/search/${data.id}`);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleSearch();
  }

  return (
    <div className="w-full">
      <div className="flex gap-2">
        <input
          id="property-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="https://www.property24.com/for-sale/…"
          className="flex-1 rounded-lg border border-line bg-paper/50 px-3.5 py-2 text-sm text-ink placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-clay/40 focus:border-clay disabled:opacity-60"
          disabled={loading}
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="rounded-lg bg-clay px-5 py-2 text-sm font-semibold text-card hover:bg-clay-dark disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </div>
      <div className="mt-3">
        <SuburbSelect selected={suburbs} onChange={setSuburbs} />
      </div>
      {error && <p className="mt-2 text-sm text-clay">{error}</p>}
    </div>
  );
}
