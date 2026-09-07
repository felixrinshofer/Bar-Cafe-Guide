import { venues, allVibes, allCategories } from "./data.js";
import { haversineDistanceKm, formatDistance, getCurrentPosition } from "./geo.js";
import { loadFilters, saveFilters, loadFavorites, saveFavorites } from "./store.js";
import { emptyFilters, applyFilters } from "./filters.js";
import { initMap, renderVenueMarkers, setUserLocation, panTo, invalidateMapSize } from "./map.js";

const state = {
  filters: loadFilters() || { ...emptyFilters },
  favorites: loadFavorites(),
  userLocation: null,
  distances: {},
  view: "list" // 'list' | 'map'
};

const el = {
  list: document.getElementById("venue-list"),
  mapContainer: document.getElementById("map"),
  search: document.getElementById("search-input"),
  typeChips: document.getElementById("type-chips"),
  categoryChips: document.getElementById("category-chips"),
  priceChips: document.getElementById("price-chips"),
  vibeChips: document.getElementById("vibe-chips"),
  sortSelect: document.getElementById("sort-select"),
  locateBtn: document.getElementById("locate-btn"),
  viewToggle: document.getElementById("view-toggle"),
  resultCount: document.getElementById("result-count"),
  resetBtn: document.getElementById("reset-filters")
};

const TYPE_LABELS = { bar: "Bar", cafe: "Café", coffee: "Coffee" };
const PRICE_LABELS = { 1: "€", 2: "€€", 3: "€€€" };

function toggleInArray(arr, value) {
  const i = arr.indexOf(value);
  if (i === -1) arr.push(value);
  else arr.splice(i, 1);
  return arr;
}

function renderChips(container, values, selectedArr, labelFn) {
  container.innerHTML = "";
  values.forEach(value => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip" + (selectedArr.includes(value) ? " chip--active" : "");
    btn.textContent = labelFn ? labelFn(value) : value;
    btn.addEventListener("click", () => {
      toggleInArray(selectedArr, value);
      persistAndRender();
    });
    container.appendChild(btn);
  });
}

function renderFilterChips() {
  renderChips(el.typeChips, ["bar", "cafe", "coffee"], state.filters.types, t => TYPE_LABELS[t]);
  renderChips(el.categoryChips, allCategories, state.filters.categories);
  renderChips(el.priceChips, [1, 2, 3], state.filters.priceRanges, p => PRICE_LABELS[p]);
  renderChips(el.vibeChips, allVibes, state.filters.vibes);
  el.sortSelect.value = state.filters.sortBy;
  el.search.value = state.filters.search;
}

function computeDistances() {
  if (!state.userLocation) return {};
  const { lat, lng } = state.userLocation;
  const distances = {};
  venues.forEach(v => {
    distances[v.id] = haversineDistanceKm(lat, lng, v.lat, v.lng);
  });
  return distances;
}

function renderVenueCard(v) {
  const card = document.createElement("article");
  card.className = "venue-card";
  card.id = `venue-${v.id}`;

  const isFav = state.favorites.has(v.id);
  const dist = state.distances[v.id];

  card.innerHTML = `
    <div class="venue-card__top">
      <div>
        <h3 class="venue-card__name">${v.name}</h3>
        <p class="venue-card__meta">${TYPE_LABELS[v.type]} · ${v.category} · ${PRICE_LABELS[v.priceRange]}</p>
      </div>
      <button class="fav-btn ${isFav ? "fav-btn--active" : ""}" aria-label="Favorit" data-id="${v.id}">★</button>
    </div>
    <p class="venue-card__neighborhood">${v.neighborhood}${dist !== undefined ? ` · ${formatDistance(dist)}` : ""}</p>
    <div class="venue-card__vibes">
      ${v.vibes.map(vb => `<span class="vibe-tag">${vb}</span>`).join("")}
    </div>
  `;

  card.querySelector(".fav-btn").addEventListener("click", e => {
    e.stopPropagation();
    if (state.favorites.has(v.id)) state.favorites.delete(v.id);
    else state.favorites.add(v.id);
    saveFavorites(state.favorites);
    render();
  });

  card.addEventListener("click", () => {
    if (state.view === "map") {
      panTo(v.lat, v.lng);
    }
  });

  return card;
}

function render() {
  const filtered = applyFilters(venues, state.filters, state.distances);
  el.resultCount.textContent = `${filtered.length} von ${venues.length}`;

  el.list.innerHTML = "";
  if (filtered.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Keine Location passt zu diesen Filtern.";
    el.list.appendChild(empty);
  } else {
    filtered.forEach(v => el.list.appendChild(renderVenueCard(v)));
  }

  if (state.view === "map") {
    renderVenueMarkers(filtered, id => {
      const v = venues.find(x => x.id === id);
      if (v) panTo(v.lat, v.lng);
    });
  }
}

function persistAndRender() {
  saveFilters(state.filters);
  renderFilterChips();
  render();
}

async function handleLocate() {
  el.locateBtn.disabled = true;
  el.locateBtn.textContent = "Suche…";
  try {
    const pos = await getCurrentPosition();
    state.userLocation = pos;
    state.distances = computeDistances();
    state.filters.sortBy = "distance";
    setUserLocation(pos.lat, pos.lng);
    panTo(pos.lat, pos.lng, 14);
    persistAndRender();
    el.locateBtn.textContent = "📍 Standort aktualisieren";
  } catch (err) {
    el.locateBtn.textContent = "📍 Standort nicht verfügbar";
    console.warn(err);
  } finally {
    el.locateBtn.disabled = false;
  }
}

function setView(view) {
  state.view = view;
  el.mapContainer.hidden = view !== "map";
  el.list.hidden = view === "map";
  el.viewToggle.querySelectorAll("button").forEach(b => {
    b.classList.toggle("chip--active", b.dataset.view === view);
  });
  if (view === "map") {
    invalidateMapSize();
    render();
  }
}

function initEvents() {
  el.search.addEventListener("input", e => {
    state.filters.search = e.target.value;
    persistAndRender();
  });
  el.sortSelect.addEventListener("change", e => {
    state.filters.sortBy = e.target.value;
    persistAndRender();
  });
  el.locateBtn.addEventListener("click", handleLocate);
  el.resetBtn.addEventListener("click", () => {
    state.filters = { ...emptyFilters };
    persistAndRender();
  });
  el.viewToggle.querySelectorAll("button").forEach(b => {
    b.addEventListener("click", () => setView(b.dataset.view));
  });
}

function init() {
  initMap("map");
  initEvents();
  renderFilterChips();
  render();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(err => console.warn("SW-Registrierung fehlgeschlagen", err));
    });
  }
}

init();
