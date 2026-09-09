import { MapLibreMap, Marker, NavigationControl } from "../vendor/maplibre/maplibre-gl.mjs";

let map = null;
let markers = [];
let userMarker = null;

const TYPE_COLORS = { bar: "#ff6a3d", cafe: "#6a5acd", coffee: "#2fb866" };
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export function initMap(containerId) {
  map = new MapLibreMap({
    container: containerId,
    style: STYLE_URL,
    center: [11.5756, 48.1372],
    zoom: 13,
    attributionControl: { compact: true }
  });
  map.addControl(new NavigationControl({ showCompass: false }), "top-left");
  return map;
}

function createDotElement(color, size) {
  const el = document.createElement("div");
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.borderRadius = "50%";
  el.style.background = color;
  el.style.border = "2px solid white";
  el.style.boxShadow = "0 1px 5px rgba(0, 0, 0, 0.35)";
  el.style.cursor = "pointer";
  return el;
}

export function renderVenueMarkers(venues, onSelect) {
  if (!map) return;
  markers.forEach(m => m.remove());
  markers = [];
  venues.forEach(v => {
    const el = createDotElement(TYPE_COLORS[v.type] || "#888", 18);
    const marker = new Marker({ element: el }).setLngLat([v.lng, v.lat]).addTo(map);
    el.addEventListener("click", () => onSelect && onSelect(v.id));
    markers.push(marker);
  });
}

export function setUserLocation(lat, lng) {
  if (!map) return;
  if (userMarker) {
    userMarker.setLngLat([lng, lat]);
  } else {
    const el = createDotElement("#0a84ff", 16);
    el.style.border = "3px solid white";
    userMarker = new Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
  }
}

export function panTo(lat, lng, zoom = 15) {
  if (map) map.flyTo({ center: [lng, lat], zoom, speed: 1.2 });
}

export function invalidateMapSize() {
  if (map) setTimeout(() => map.resize(), 50);
}
