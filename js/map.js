import { MapLibreMap, Marker, NavigationControl, GeolocateControl, Popup } from "../vendor/maplibre/maplibre-gl.mjs";

let map = null;
let markers = [];
let userMarker = null;
let peopleMarkers = [];

const TYPE_COLORS = {
  bar: "#dc2626",
  cafe: "#0056b3",
  dancebar: "#16a34a",
  club: "#f76707",
  restaurant: "#7c3aed",
  spot: "#db2777",
  biergarten: "#d4a017",
  festzelt: "#0d9488"
};
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
  map.addControl(
    new GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showUserHeading: true
    }),
    "top-left"
  );
  map.on("load", () => addOverlays(map));
  return map;
}

async function addOverlays(map) {
  try {
    const [viertelRes, ubahnRes] = await Promise.all([fetch("./data/viertel.geojson"), fetch("./data/ubahn.geojson")]);
    const [viertel, ubahn] = await Promise.all([viertelRes.json(), ubahnRes.json()]);

    map.addSource("viertel", { type: "geojson", data: viertel });
    map.addLayer({
      id: "viertel-fill",
      type: "fill",
      source: "viertel",
      paint: { "fill-color": "#0056b3", "fill-opacity": 0.06 }
    });
    map.addLayer({
      id: "viertel-outline-casing",
      type: "line",
      source: "viertel",
      layout: { "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-width": 4.5, "line-opacity": 0.8 }
    });
    map.addLayer({
      id: "viertel-outline",
      type: "line",
      source: "viertel",
      layout: { "line-join": "round" },
      paint: { "line-color": "#0056b3", "line-width": 2.4, "line-opacity": 0.85, "line-dasharray": [3, 1.5] }
    });
    map.addLayer({
      id: "viertel-label",
      type: "symbol",
      source: "viertel",
      layout: {
        "text-field": ["get", "name"],
        "text-size": 13,
        "text-font": ["Noto Sans Bold"]
      },
      paint: {
        "text-color": "#003d82",
        "text-halo-color": "#ffffff",
        "text-halo-width": 2
      }
    });

    map.addSource("ubahn", { type: "geojson", data: ubahn });
    map.addLayer({
      id: "ubahn-casing",
      type: "line",
      source: "ubahn",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#ffffff", "line-width": 5, "line-opacity": 0.55 }
    });
    map.addLayer({
      id: "ubahn-line",
      type: "line",
      source: "ubahn",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "colour"], "line-width": 3, "line-opacity": 0.65 }
    });
  } catch (err) {
    console.warn("Overlays (Viertel/U-Bahn) konnten nicht geladen werden", err);
  }
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

function createAvatarElement(photoUrl, size, borderColor, borderWidth) {
  const el = document.createElement("div");
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.borderRadius = "50%";
  el.style.border = `${borderWidth}px solid ${borderColor}`;
  el.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.35)";
  el.style.backgroundImage = `url(${photoUrl})`;
  el.style.backgroundSize = "cover";
  el.style.backgroundPosition = "center";
  el.style.cursor = "pointer";
  return el;
}

function createInitialElement(name, size, borderColor, borderWidth) {
  const el = document.createElement("div");
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.borderRadius = "50%";
  el.style.border = `${borderWidth}px solid ${borderColor}`;
  el.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.35)";
  el.style.background = "linear-gradient(155deg, #1a6fd6, #0056b3)";
  el.style.color = "white";
  el.style.display = "flex";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";
  el.style.fontWeight = "700";
  el.style.fontSize = `${Math.round(size * 0.42)}px`;
  el.style.cursor = "pointer";
  el.textContent = (name || "?").charAt(0).toUpperCase();
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

export function setUserLocation(lat, lng, photoUrl) {
  if (!map) return;
  if (userMarker) userMarker.remove();
  const el = photoUrl ? createAvatarElement(photoUrl, 38, "#0056b3", 3) : createDotElement("#0056b3", 16);
  if (!photoUrl) el.style.border = "3px solid white";
  userMarker = new Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
}

export function clearUserLocation() {
  if (userMarker) {
    userMarker.remove();
    userMarker = null;
  }
}

export function renderPeopleMarkers(people) {
  if (!map) return;
  peopleMarkers.forEach(m => m.remove());
  peopleMarkers = [];
  people.forEach(p => {
    const el = p.photoUrl
      ? createAvatarElement(p.photoUrl, 34, "#ffffff", 3)
      : createInitialElement(p.name, 34, "#ffffff", 3);
    const marker = new Marker({ element: el })
      .setLngLat([p.lng, p.lat])
      .setPopup(new Popup({ offset: 20, closeButton: false }).setText(p.name))
      .addTo(map);
    peopleMarkers.push(marker);
  });
}

export function panTo(lat, lng, zoom = 15) {
  if (map) map.flyTo({ center: [lng, lat], zoom, speed: 1.2 });
}

export function invalidateMapSize() {
  if (map) setTimeout(() => map.resize(), 50);
}
