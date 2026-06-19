"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface IndexSummary { slug: string; street: string; suburb: string; houseCount: number; }

export default function PhotoUploadInput() {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [suburb, setSuburb] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [indexes, setIndexes] = useState<IndexSummary[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/index-street")
      .then((r) => r.json())
      .then((d) => {
        const list: IndexSummary[] = d.indexes ?? [];
        setIndexes(list);
        if (list.length === 1) setSuburb(list[0].suburb);
      })
      .catch(() => {});
  }, []);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list).filter((f) => f.type.startsWith("image/"));
    const next = [...files, ...incoming].slice(0, 30);
    setFiles(next);
    setPreviews(next.map((f) => URL.createObjectURL(f)));
  }

  function removeAt(i: number) {
    const next = files.filter((_, idx) => idx !== i);
    setFiles(next);
    setPreviews(next.map((f) => URL.createObjectURL(f)));
  }

  async function handleSubmit() {
    if (files.length === 0) { setError("Add at least one photo."); return; }
    if (!suburb) { setError("Choose the suburb."); return; }
    setError(null);
    setLoading(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("photos", f));
      fd.append("suburb", suburb);
      fd.append("description", description);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Upload failed."); return; }
      router.push(`/search/${data.id}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full flex flex-col gap-3">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
        className="cursor-pointer rounded-lg border-2 border-dashed border-gray-300 hover:border-blue-500 bg-gray-50 px-4 py-6 text-center text-sm text-gray-600"
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
        <p className="font-medium text-gray-700">Drop property photos here, or click to choose</p>
        <p className="text-xs text-gray-400 mt-1">Exterior / facade / street shots work best. Up to 30 images.</p>
      </div>

      {previews.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {previews.map((src, i) => (
            <div key={i} className="relative shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`upload ${i + 1}`} className="h-16 w-20 object-cover rounded border border-gray-200" />
              <button
                onClick={() => removeAt(i)}
                className="absolute -top-1.5 -right-1.5 bg-red-600 text-white rounded-full w-4 h-4 text-[10px] leading-none"
                aria-label="Remove"
              >×</button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <select
          value={suburb}
          onChange={(e) => setSuburb(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
        >
          <option value="">Select indexed area…</option>
          {Array.from(new Set(indexes.map((i) => i.suburb))).map((sub) => {
            const streets = indexes.filter((i) => i.suburb === sub);
            const houses = streets.reduce((n, i) => n + i.houseCount, 0);
            return (
              <option key={sub} value={sub}>
                {sub} — {streets.map((s) => s.street).join(", ")} ({houses} houses)
              </option>
            );
          })}
        </select>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional: paste the listing description (helps matching)"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
        />
      </div>

      <button
        onClick={handleSubmit}
        disabled={loading}
        className="self-start rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
      >
        {loading ? "Uploading…" : "Find this property"}
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {indexes.length === 0 && (
        <p className="text-xs text-amber-600">
          No streets are indexed yet — a street has to be decoded before photos can be matched against it.
        </p>
      )}
    </div>
  );
}
