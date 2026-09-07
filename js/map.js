let map = null;
let markersLayer = null;
let userMarker = null;

const TYPE_COLORS = { bar: "#d97757", cafe: "#7a9e7e", coffee: "#c9a24b" };

export function initMap(containerId) {
  map = L.map(containerId, { zoomControl: true }).setView([48.1372, 11.5756], 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);
  return map;
}

export function renderVenueMarkers(venues, onSelect) {
  if (!markersLayer) return;
  markersLayer.clearLayers();
  venues.forEach(v => {
    const marker = L.circleMarker([v.lat, v.lng], {
      radius: 8,
      color: TYPE_COLORS[v.type] || "#888",
      fillColor: TYPE_COLORS[v.type] || "#888",
      fillOpacity: 0.85,
      weight: 2
    });
    marker.bindPopup(`<strong>${v.name}</strong><br>${v.category} · ${"€".repeat(v.priceRange)}`);
    marker.on("click", () => onSelect && onSelect(v.id));
    marker.addTo(markersLayer);
  });
}

export function setUserLocation(lat, lng) {
  if (!map) return;
  if (userMarker) {
    userMarker.setLatLng([lat, lng]);
  } else {
    userMarker = L.circleMarker([lat, lng], {
      radius: 7,
      color: "#4a90d9",
      fillColor: "#4a90d9",
      fillOpacity: 1,
      weight: 3
    }).addTo(map);
  }
}

export function panTo(lat, lng, zoom = 15) {
  if (map) map.setView([lat, lng], zoom);
}

export function invalidateMapSize() {
  if (map) setTimeout(() => map.invalidateSize(), 50);
}
