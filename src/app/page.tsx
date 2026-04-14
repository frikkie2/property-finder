import SearchInput from "@/components/SearchInput";
import SearchHistory from "@/components/SearchHistory";

export default function HomePage() {
  return (
    <div className="flex flex-col gap-8">
      {/* Hero / search section */}
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Find a property address</h2>
        <p className="text-sm text-gray-500 mb-5">
          Paste a Property24 listing URL and we will pinpoint the real street address using satellite
          and street-view imagery.
        </p>
        <SearchInput />
      </section>

      {/* Search history */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">
          Recent searches
        </h2>
        <SearchHistory />
      </section>
    </div>
  );
}
