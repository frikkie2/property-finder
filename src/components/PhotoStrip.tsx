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
      <div className="flex gap-2 overflow-x-auto pb-1">
        {photoUrls.map((url, i) => {
          const proxied = `/api/proxy-image?url=${encodeURIComponent(url)}`;
          return (
            <button
              key={i}
              onClick={() => { setEnlarged(proxied); onSelect?.(url); }}
              className="relative shrink-0 rounded-md overflow-hidden border-2 border-transparent hover:border-blue-400 cursor-zoom-in transition-all"
              style={{ width: 96, height: 72 }}
              aria-label={`Enlarge photo ${i + 1}`}
            >
              <Image
                src={proxied}
                alt={`Listing photo ${i + 1}`}
                fill
                sizes="96px"
                className="object-cover"
                unoptimized
              />
            </button>
          );
        })}
      </div>
      <Lightbox src={enlarged} onClose={() => setEnlarged(null)} />
    </>
  );
}
