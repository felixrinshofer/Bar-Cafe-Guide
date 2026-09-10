export function deriveOptions(venues) {
  return {
    categories: [...new Set(venues.map(v => v.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de")),
    vibes: [...new Set(venues.flatMap(v => v.vibes || []))].sort((a, b) => a.localeCompare(b, "de"))
  };
}

export const emptyFilters = {
  types: [],
  categories: [],
  priceRanges: [],
  vibes: [],
  search: "",
  favoritesOnly: false,
  sortBy: "name" // 'name' | 'distance' | 'price' | 'neighborhood' | 'rating'
};

export function applyFilters(venues, filters, distances, favorites, ratingStats) {
  let result = venues.filter(v => {
    if (filters.favoritesOnly && !(favorites && favorites.has(v.id))) return false;
    if (filters.types.length && !filters.types.includes(v.type)) return false;
    if (filters.categories.length && !filters.categories.includes(v.category)) return false;
    if (filters.priceRanges.length && !filters.priceRanges.includes(v.priceRange)) return false;
    if (filters.vibes.length && !filters.vibes.every(vibe => v.vibes.includes(vibe))) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const haystack = `${v.name} ${v.category} ${v.neighborhood}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  if (filters.sortBy === "distance" && distances) {
    result = [...result].sort((a, b) => (distances[a.id] ?? Infinity) - (distances[b.id] ?? Infinity));
  } else if (filters.sortBy === "price") {
    result = [...result].sort((a, b) => a.priceRange - b.priceRange);
  } else if (filters.sortBy === "rating") {
    result = [...result].sort((a, b) => {
      const ra = (ratingStats && ratingStats[a.id]) || null;
      const rb = (ratingStats && ratingStats[b.id]) || null;
      if (!ra && rb) return 1;
      if (ra && !rb) return -1;
      if (!ra && !rb) return a.name.localeCompare(b.name, "de");
      return rb.avg - ra.avg || rb.count - ra.count || a.name.localeCompare(b.name, "de");
    });
  } else if (filters.sortBy === "neighborhood") {
    result = [...result].sort((a, b) => {
      const na = a.neighborhood || "";
      const nb = b.neighborhood || "";
      if (!na && nb) return 1;
      if (na && !nb) return -1;
      return na.localeCompare(nb, "de") || a.name.localeCompare(b.name, "de");
    });
  } else {
    result = [...result].sort((a, b) => a.name.localeCompare(b.name, "de"));
  }

  return result;
}
