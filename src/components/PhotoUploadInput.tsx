"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SuburbSelect from "./SuburbSelect";

/**
 * Downscale a photo in the browser before upload: long edge <= 1600px, JPEG
 * quality 0.85. Phone photos are 4-8MB; this brings them to a few hundred KB,
 * which keeps the upload under body limits and is the right size for the AI.
 * Falls back to the original file if anything goes wrong.
 */
async function downscale(file: File, maxEdge = 1600, quality = 0.85): Promise<File> {
  try {
    if (!file.type.startsWith("image/")) return file;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) return file; // already small enough
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export default function PhotoUploadInput() {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [suburbs, setSuburbs] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

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
    if (suburbs.length === 0) { setError("Choose at least one suburb."); return; }
    setError(null);
    setLoading(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("photos", await downscale(f));
      suburbs.forEach((s) => fd.append("suburb", s));
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

      <SuburbSelect selected={suburbs} onChange={setSuburbs} />

      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Optional: paste the listing description (helps matching)"
        className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
      />

      <button
        onClick={handleSubmit}
        disabled={loading}
        className="self-start rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
      >
        {loading ? "Uploading…" : "Find this property"}
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
