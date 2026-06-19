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
      <label htmlFor="property-url" className="block text-sm font-medium text-gray-700 mb-1">
        Property24 listing URL
      </label>
      <div className="flex gap-2">
        <input
          id="property-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="https://www.property24.com/for-sale/..."
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-blue-700 disabled:bg-gray-100"
          disabled={loading}
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </div>
      <div className="mt-3">
        <SuburbSelect selected={suburbs} onChange={setSuburbs} />
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      )}
    </div>
  );
}
