// Münchner Grobraum als weicher Bias für die Suche (bounded=0 => nur Präferenz, kein Ausschluss)
const MUC_VIEWBOX = "11.35,48.25,11.75,48.02";

const OSM_TYPE_MAP = {
  bar: "bar",
  pub: "bar",
  biergarten: "bar",
  cafe: "cafe",
  nightclub: "club",
  restaurant: "restaurant",
  fast_food: "restaurant"
};

function guessType(item) {
  return OSM_TYPE_MAP[item.type] || "bar";
}

function buildAddress(addr) {
  if (!addr) return "";
  const street = [addr.road, addr.house_number].filter(Boolean).join(" ");
  const city = [addr.postcode, addr.city || addr.town || addr.village].filter(Boolean).join(" ");
  return [street, city].filter(Boolean).join(", ");
}

export async function searchPlaces(query) {
  if (!query || !query.trim()) return [];
  const url =
    `https://nominatim.openstreetmap.org/search?format=json&limit=6&addressdetails=1&extratags=1` +
    `&viewbox=${MUC_VIEWBOX}&bounded=0&q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Suche gerade nicht erreichbar");
  const results = await res.json();

  return results.map(item => ({
    name: item.address?.amenity || item.name || item.display_name.split(",")[0],
    address: buildAddress(item.address),
    neighborhood: item.address?.suburb || item.address?.city_district || "",
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
    type: guessType(item),
    category: item.type ? item.type.replace(/_/g, " ") : "",
    website: item.extratags?.website || null,
    openingHours: item.extratags?.opening_hours || null,
    commonsFile: item.extratags?.wikimedia_commons || null
  }));
}

export async function fetchCommonsImageUrl(fileTitle) {
  try {
    const apiUrl =
      `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(fileTitle)}` +
      `&prop=imageinfo&iiprop=url&iiurlwidth=1000&format=json&origin=*`;
    const res = await fetch(apiUrl);
    if (!res.ok) return null;
    const data = await res.json();
    const page = Object.values(data.query.pages)[0];
    return page?.imageinfo?.[0]?.thumburl || null;
  } catch {
    return null;
  }
}
