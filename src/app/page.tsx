import SearchInput from "@/components/SearchInput";
import PhotoUploadInput from "@/components/PhotoUploadInput";
import SearchHistory from "@/components/SearchHistory";

export default function HomePage() {
  return (
    <div className="flex flex-col gap-10">
      {/* Hero */}
      <section className="pt-2">
        <p className="data-label mb-3">Reverse address identification</p>
        <h1 className="font-display text-4xl sm:text-5xl leading-[1.05] text-ink max-w-2xl">
          Find the <span className="text-clay">real address</span> behind a property listing.
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-muted max-w-xl">
          Give us a listing link or just the photos. We read the exterior — facade, walls, gate,
          pool, trees, the view to the street — and match it house-by-house against decoded
          Street&nbsp;View and satellite imagery to rank the most likely addresses.
        </p>
      </section>

      {/* Two entry modes */}
      <section className="grid gap-5 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-card p-6 shadow-[0_1px_0_rgba(0,0,0,0.03),0_8px_24px_-16px_rgba(0,0,0,0.25)]">
          <div className="flex items-center gap-2 mb-1">
            <span className="data-label">01 — by link</span>
          </div>
          <h2 className="font-display text-xl text-ink mb-1.5">Paste a Property24 URL</h2>
          <p className="text-sm text-muted mb-5">
            We scrape the listing&apos;s photos and match them against your indexed suburbs.
          </p>
          <SearchInput />
        </div>

        <div className="rounded-xl border border-line bg-card p-6 shadow-[0_1px_0_rgba(0,0,0,0.03),0_8px_24px_-16px_rgba(0,0,0,0.25)]">
          <div className="flex items-center gap-2 mb-1">
            <span className="data-label">02 — by photos</span>
          </div>
          <h2 className="font-display text-xl text-ink mb-1.5">Upload photos directly</h2>
          <p className="text-sm text-muted mb-5">
            No link needed — even mostly-interior shots work; we mine every exterior fragment.
          </p>
          <PhotoUploadInput />
        </div>
      </section>

      {/* Search history */}
      <section>
        <h2 className="data-label mb-3">Recent identifications</h2>
        <SearchHistory />
      </section>
    </div>
  );
}
