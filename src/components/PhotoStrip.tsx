"use client";

import { useState } from "react";
import Image from "next/image";
import Lightbox from "./Lightbox";

interface Props {
  photoUrls: string[];
  onSelect?: (url: string) => void;
}

export default function PhotoStrip({ photoUrls, onSelect }: Props) {
  const [enlarged, setEnlarged] = useState<string | null>(null);

  if (!photoUrls || photoUrls.length === 0) {
    return (
      <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500">
        No listing photos available
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
        {photoUrls.map((url, i) => {
          const proxied = `/api/proxy-image?url=${encodeURIComponent(url)}`;
          return (
            <button
              key={i}
              onClick={() => { setEnlarged(proxied); onSelect?.(url); }}
              className="relative aspect-[4/3] w-full rounded-lg overflow-hidden border border-line hover:border-clay cursor-zoom-in transition-colors group"
              aria-label={`Enlarge photo ${i + 1}`}
            >
              <Image
                src={proxied}
                alt={`Listing photo ${i + 1}`}
                fill
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                className="object-cover group-hover:scale-[1.03] transition-transform"
                unoptimized
              />
              <span className="absolute top-1 left-1 rounded bg-ink/60 px-1.5 py-0.5 text-[10px] font-mono text-card">
                {i + 1}
              </span>
            </button>
          );
        })}
      </div>
      <Lightbox src={enlarged} onClose={() => setEnlarged(null)} />
    </>
  );
}
