"use client";

import { useState } from "react";
import Image from "next/image";

interface Props {
  photoUrls: string[];
  onSelect?: (url: string) => void;
}

export default function PhotoStrip({ photoUrls, onSelect }: Props) {
  const [selected, setSelected] = useState(0);

  if (!photoUrls || photoUrls.length === 0) {
    return (
      <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500">
        No listing photos available
      </div>
    );
  }

  function handleClick(idx: number, url: string) {
    setSelected(idx);
    onSelect?.(url);
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {photoUrls.map((url, i) => (
        <button
          key={i}
          onClick={() => handleClick(i, url)}
          className={`relative shrink-0 rounded-md overflow-hidden border-2 transition-all ${
            i === selected ? "border-blue-700 ring-2 ring-blue-300" : "border-transparent hover:border-blue-300"
          }`}
          style={{ width: 96, height: 72 }}
          aria-label={`Photo ${i + 1}`}
        >
          <Image
            src={`/api/proxy-image?url=${encodeURIComponent(url)}`}
            alt={`Listing photo ${i + 1}`}
            fill
            sizes="96px"
            className="object-cover"
            unoptimized
          />
        </button>
      ))}
    </div>
  );
}
