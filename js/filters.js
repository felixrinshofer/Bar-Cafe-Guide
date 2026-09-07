export const emptyFilters = {
  types: [],
  categories: [],
  priceRanges: [],
  vibes: [],
  search: "",
  sortBy: "name" // 'name' | 'distance' | 'price'
};

export function applyFilters(venues, filters, distances) {
  let result = venues.filter(v => {
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
  } else {
    result = [...result].sort((a, b) => a.name.localeCompare(b.name, "de"));
  }

  return result;
}
