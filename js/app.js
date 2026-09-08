import { suggestedCategories, suggestedVibes } from "./data.js";
import { haversineDistanceKm, formatDistance, getCurrentPosition } from "./geo.js";
import { loadFilters, saveFilters, loadFavorites, saveFavorites } from "./store.js";
import { emptyFilters, applyFilters, deriveOptions } from "./filters.js";
import { initMap, renderVenueMarkers, setUserLocation, panTo, invalidateMapSize } from "./map.js";
import { getAllVenues, putVenue, deleteVenue, createId } from "./db.js";
import { fileToCompressedBlob } from "./image.js";

const TYPE_LABELS = { bar: "Bar", cafe: "Café", coffee: "Coffee" };
const TYPE_EMOJI = { bar: "🍸", cafe: "☕", coffee: "☕" };
const PRICE_LABELS = { 1: "€", 2: "€€", 3: "€€€" };

const state = {
  venues: [],
  filters: loadFilters() || structuredClone(emptyFilters),
  favorites: loadFavorites(),
  userLocation: null,
  distances: {},
  view: "list"
};

let mapInitialized = false;
let cardObjectUrls = [];
let detailObjectUrls = [];
let formObjectUrls = [];

const formState = {
  editingId: null,
  photos: [],
  vibes: [],
  type: "bar",
  price: 2,
  location: null
};

const el = {
  list: document.getElementById("venue-list"),
  mapContainer: document.getElementById("map"),
  emptyGlobal: document.getElementById("empty-state-global"),
  search: document.getElementById("search-input"),
  typeChips: document.getElementById("type-chips"),
  categoryChips: document.getElementById("category-chips"),
  priceChips: document.getElementById("price-chips"),
  vibeChips: document.getElementById("vibe-chips"),
  sortSelect: document.getElementById("sort-select"),
  locateBtn: document.getElementById("locate-btn"),
  viewToggle: document.getElementById("view-toggle"),
  resultCount: document.getElementById("result-count"),
  resetBtn: document.getElementById("reset-filters"),
  filterToggle: document.getElementById("filter-toggle"),
  filterPanel: document.getElementById("filter-panel"),

  fabAdd: document.getElementById("fab-add"),

  detailSheet: document.getElementById("detail-sheet"),
  detailClose: document.getElementById("detail-close"),
  detailPhotos: document.getElementById("detail-photos"),
  detailName: document.getElementById("detail-name"),
  detailMeta: document.getElementById("detail-meta"),
  detailAddress: document.getElementById("detail-address"),
  detailVibes: document.getElementById("detail-vibes"),
  detailDescription: document.getElementById("detail-description"),
  detailFav: document.getElementById("detail-fav"),
  detailEdit: document.getElementById("detail-edit"),
  detailDelete: document.getElementById("detail-delete"),

  formSheet: document.getElementById("form-sheet"),
  formClose: document.getElementById("form-close"),
  formCancel: document.getElementById("form-cancel"),
  formTitle: document.getElementById("form-title"),
  form: document.getElementById("venue-form"),
  fName: document.getElementById("f-name"),
  fType: document.getElementById("f-type"),
  fCategory: document.getElementById("f-category"),
  categorySuggestions: document.getElementById("category-suggestions"),
  fPrice: document.getElementById("f-price"),
  fVibes: document.getElementById("f-vibes"),
  fVibeInput: document.getElementById("f-vibe-input"),
  fVibeAdd: document.getElementById("f-vibe-add"),
  fNeighborhood: document.getElementById("f-neighborhood"),
  fAddress: document.getElementById("f-address"),
  fLocate: document.getElementById("f-locate"),
  fLocationStatus: document.getElementById("f-location-status"),
  fDescription: document.getElementById("f-description"),
  fPhotos: document.getElementById("f-photos"),
  fPhotoInput: document.getElementById("f-photo-input"),
  fPhotoAdd: document.getElementById("f-photo-add")
};

function toggleInArray(arr, value) {
  const i = arr.indexOf(value);
  if (i === -1) arr.push(value);
  else arr.splice(i, 1);
  return arr;
}

function trackUrl(bucket, url) {
  bucket.push(url);
  return url;
}

function revokeBucket(bucket) {
  bucket.forEach(u => URL.revokeObjectURL(u));
  bucket.length = 0;
}

function renderChips(container, values, selectedArr, labelFn, onChange) {
  container.innerHTML = "";
  values.forEach(value => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip" + (selectedArr.includes(value) ? " chip--active" : "");
    btn.textContent = labelFn ? labelFn(value) : value;
    btn.addEventListener("click", () => {
      toggleInArray(selectedArr, value);
      onChange();
    });
    container.appendChild(btn);
  });
}

function renderSegmented(container, values, selectedValue, labelFn, onSelect) {
  container.innerHTML = "";
  values.forEach(value => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip" + (value === selectedValue ? " chip--active" : "");
    btn.textContent = labelFn ? labelFn(value) : value;
    btn.addEventListener("click", () => onSelect(value));
    container.appendChild(btn);
  });
}

function renderFilterChips() {
  const options = deriveOptions(state.venues);
  renderChips(el.typeChips, ["bar", "cafe", "coffee"], state.filters.types, t => TYPE_LABELS[t], persistAndRender);
  renderChips(el.categoryChips, options.categories, state.filters.categories, null, persistAndRender);
  renderChips(el.priceChips, [1, 2, 3], state.filters.priceRanges, p => PRICE_LABELS[p], persistAndRender);
  renderChips(el.vibeChips, options.vibes, state.filters.vibes, null, persistAndRender);
  el.sortSelect.value = state.filters.sortBy;
  el.search.value = state.filters.search;

  const activeCount =
    state.filters.types.length +
    state.filters.categories.length +
    state.filters.priceRanges.length +
    state.filters.vibes.length;
  el.filterToggle.textContent = activeCount > 0 ? `Filter (${activeCount}) ▾` : "Filter ▾";
}

function computeDistances() {
  if (!state.userLocation) return {};
  const { lat, lng } = state.userLocation;
  const distances = {};
  state.venues.forEach(v => {
    if (typeof v.lat === "number" && typeof v.lng === "number") {
      distances[v.id] = haversineDistanceKm(lat, lng, v.lat, v.lng);
    }
  });
  return distances;
}

function renderVenueCard(v) {
  const card = document.createElement("article");
  card.className = "venue-card";
  card.id = `venue-${v.id}`;

  const isFav = state.favorites.has(v.id);
  const dist = state.distances[v.id];

  let thumbHtml;
  if (v.photos && v.photos.length) {
    const url = trackUrl(cardObjectUrls, URL.createObjectURL(v.photos[0]));
    thumbHtml = `<img class="venue-card__thumb" src="${url}" alt="" />`;
  } else {
    thumbHtml = `<div class="venue-card__thumb venue-card__thumb--placeholder">${TYPE_EMOJI[v.type] || "📍"}</div>`;
  }

  card.innerHTML = `
    ${thumbHtml}
    <div class="venue-card__main">
      <div class="venue-card__top">
        <div>
          <h3 class="venue-card__name">${v.name}</h3>
          <p class="venue-card__meta">${TYPE_LABELS[v.type]} · ${v.category || "—"} · ${PRICE_LABELS[v.priceRange]}</p>
        </div>
        <button class="fav-btn ${isFav ? "fav-btn--active" : ""}" aria-label="Favorit" data-id="${v.id}">★</button>
      </div>
      <p class="venue-card__neighborhood">${v.neighborhood || ""}${dist !== undefined ? ` · ${formatDistance(dist)}` : ""}</p>
      <div class="venue-card__vibes">
        ${(v.vibes || []).map(vb => `<span class="vibe-tag">${vb}</span>`).join("")}
      </div>
    </div>
  `;

  card.querySelector(".fav-btn").addEventListener("click", e => {
    e.stopPropagation();
    if (state.favorites.has(v.id)) state.favorites.delete(v.id);
    else state.favorites.add(v.id);
    saveFavorites(state.favorites);
    render();
  });

  card.addEventListener("click", () => openDetail(v.id));

  return card;
}

function render() {
  const filtered = applyFilters(state.venues, state.filters, state.distances);
  el.resultCount.textContent = state.venues.length ? `${filtered.length} von ${state.venues.length}` : "";
  el.emptyGlobal.hidden = state.venues.length !== 0;

  revokeBucket(cardObjectUrls);
  el.list.innerHTML = "";
  if (state.venues.length > 0) {
    if (filtered.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "Keine Location passt zu diesen Filtern.";
      el.list.appendChild(empty);
    } else {
      filtered.forEach(v => el.list.appendChild(renderVenueCard(v)));
    }
  }

  if (state.view === "map" && mapInitialized) {
    const mapReady = filtered.filter(v => typeof v.lat === "number" && typeof v.lng === "number");
    renderVenueMarkers(mapReady, id => {
      const v = state.venues.find(x => x.id === id);
      if (v) {
        panTo(v.lat, v.lng);
        openDetail(id);
      }
    });
  }
}

function persistAndRender() {
  saveFilters(state.filters);
  renderFilterChips();
  render();
}

async function refreshVenues() {
  state.venues = await getAllVenues();
  state.distances = computeDistances();
}

async function handleLocate() {
  el.locateBtn.disabled = true;
  el.locateBtn.textContent = "Suche…";
  try {
    const pos = await getCurrentPosition();
    state.userLocation = pos;
    state.distances = computeDistances();
    state.filters.sortBy = "distance";
    if (mapInitialized) setUserLocation(pos.lat, pos.lng);
    if (state.view === "map") panTo(pos.lat, pos.lng, 14);
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
    if (!mapInitialized) {
      initMap("map");
      mapInitialized = true;
      if (state.userLocation) setUserLocation(state.userLocation.lat, state.userLocation.lng);
    }
    invalidateMapSize();
  }
  render();
}

// ---- Detail sheet ----

function openDetail(id) {
  const v = state.venues.find(x => x.id === id);
  if (!v) return;

  revokeBucket(detailObjectUrls);
  el.detailPhotos.innerHTML = "";
  (v.photos || []).forEach(blob => {
    const url = trackUrl(detailObjectUrls, URL.createObjectURL(blob));
    const img = document.createElement("img");
    img.src = url;
    img.alt = v.name;
    el.detailPhotos.appendChild(img);
  });

  el.detailName.textContent = v.name;
  el.detailMeta.textContent = `${TYPE_LABELS[v.type]} · ${v.category || "—"} · ${PRICE_LABELS[v.priceRange]}${v.neighborhood ? " · " + v.neighborhood : ""}`;
  el.detailAddress.textContent = v.address || "";
  el.detailAddress.hidden = !v.address;
  el.detailVibes.innerHTML = (v.vibes || []).map(vb => `<span class="vibe-tag">${vb}</span>`).join("");
  el.detailDescription.textContent = v.description || "Noch keine Notizen.";
  el.detailFav.classList.toggle("fav-btn--active", state.favorites.has(v.id));

  el.detailFav.onclick = () => {
    if (state.favorites.has(v.id)) state.favorites.delete(v.id);
    else state.favorites.add(v.id);
    saveFavorites(state.favorites);
    el.detailFav.classList.toggle("fav-btn--active", state.favorites.has(v.id));
    render();
  };
  el.detailEdit.onclick = () => {
    closeDetail();
    openForm(v);
  };
  el.detailDelete.onclick = async () => {
    if (!confirm(`"${v.name}" wirklich löschen?`)) return;
    await deleteVenue(v.id);
    state.favorites.delete(v.id);
    saveFavorites(state.favorites);
    await refreshVenues();
    closeDetail();
    renderFilterChips();
    render();
  };

  el.detailSheet.hidden = false;
}

function closeDetail() {
  el.detailSheet.hidden = true;
  revokeBucket(detailObjectUrls);
  el.detailPhotos.innerHTML = "";
}

// ---- Form sheet (add / edit) ----

function renderFormVibes() {
  const options = deriveOptions(state.venues);
  const values = [...new Set([...suggestedVibes, ...options.vibes, ...formState.vibes])].sort((a, b) => a.localeCompare(b, "de"));
  renderChips(el.fVibes, values, formState.vibes, null, renderFormVibes);
}

function renderFormPhotos() {
  revokeBucket(formObjectUrls);
  el.fPhotos.innerHTML = "";
  formState.photos.forEach((blob, index) => {
    const url = trackUrl(formObjectUrls, URL.createObjectURL(blob));
    const wrap = document.createElement("div");
    wrap.className = "photo-thumb";
    wrap.innerHTML = `<img src="${url}" alt="" /><button type="button" class="photo-thumb__remove" aria-label="Foto entfernen">✕</button>`;
    wrap.querySelector("button").addEventListener("click", () => {
      formState.photos.splice(index, 1);
      renderFormPhotos();
    });
    el.fPhotos.appendChild(wrap);
  });
}

function renderCategorySuggestions() {
  const options = deriveOptions(state.venues);
  const values = [...new Set([...suggestedCategories, ...options.categories])].sort((a, b) => a.localeCompare(b, "de"));
  el.categorySuggestions.innerHTML = values.map(c => `<option value="${c}"></option>`).join("");
}

function openForm(venue) {
  formState.editingId = venue ? venue.id : null;
  formState.photos = venue ? [...(venue.photos || [])] : [];
  formState.vibes = venue ? [...(venue.vibes || [])] : [];
  formState.type = venue ? venue.type : "bar";
  formState.price = venue ? venue.priceRange : 2;
  formState.location = venue && typeof venue.lat === "number" ? { lat: venue.lat, lng: venue.lng } : null;

  el.formTitle.textContent = venue ? "Location bearbeiten" : "Neue Location";
  el.fName.value = venue ? venue.name : "";
  el.fCategory.value = venue ? venue.category || "" : "";
  el.fNeighborhood.value = venue ? venue.neighborhood || "" : "";
  el.fAddress.value = venue ? venue.address || "" : "";
  el.fDescription.value = venue ? venue.description || "" : "";
  el.fLocationStatus.textContent = formState.location
    ? `📍 Standort gesetzt (${formState.location.lat.toFixed(4)}, ${formState.location.lng.toFixed(4)})`
    : "Noch kein Standort gesetzt – Karte/Entfernung funktioniert erst danach.";

  renderTypeSegmented();
  renderPriceSegmented();
  renderCategorySuggestions();
  renderFormVibes();
  renderFormPhotos();

  el.formSheet.hidden = false;
}

function renderTypeSegmented() {
  renderSegmented(el.fType, ["bar", "cafe", "coffee"], formState.type, t => TYPE_LABELS[t], value => {
    formState.type = value;
    renderTypeSegmented();
  });
}

function renderPriceSegmented() {
  renderSegmented(el.fPrice, [1, 2, 3], formState.price, p => PRICE_LABELS[p], value => {
    formState.price = value;
    renderPriceSegmented();
  });
}

function closeForm() {
  el.formSheet.hidden = true;
  revokeBucket(formObjectUrls);
  el.fPhotos.innerHTML = "";
  el.form.reset();
}

async function handleFormLocate() {
  el.fLocate.disabled = true;
  el.fLocate.textContent = "Suche…";
  try {
    const pos = await getCurrentPosition();
    formState.location = pos;
    el.fLocationStatus.textContent = `📍 Standort gesetzt (${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)})`;
  } catch (err) {
    el.fLocationStatus.textContent = "Standort nicht verfügbar.";
    console.warn(err);
  } finally {
    el.fLocate.disabled = false;
    el.fLocate.textContent = "📍 Aktuellen Standort verwenden";
  }
}

async function handlePhotoInputChange(e) {
  const files = [...e.target.files];
  e.target.value = "";
  for (const file of files) {
    try {
      const blob = await fileToCompressedBlob(file);
      formState.photos.push(blob);
    } catch (err) {
      console.warn(err);
    }
  }
  renderFormPhotos();
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const name = el.fName.value.trim();
  if (!name) {
    el.fName.focus();
    return;
  }

  const existing = formState.editingId ? state.venues.find(v => v.id === formState.editingId) : null;

  const venue = {
    id: formState.editingId || createId(),
    name,
    type: formState.type,
    category: el.fCategory.value.trim(),
    priceRange: formState.price,
    vibes: [...formState.vibes],
    neighborhood: el.fNeighborhood.value.trim(),
    address: el.fAddress.value.trim(),
    lat: formState.location ? formState.location.lat : null,
    lng: formState.location ? formState.location.lng : null,
    description: el.fDescription.value.trim(),
    photos: [...formState.photos],
    createdAt: existing ? existing.createdAt : Date.now()
  };

  await putVenue(venue);
  await refreshVenues();
  closeForm();
  renderFilterChips();
  render();
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
    state.filters = structuredClone(emptyFilters);
    persistAndRender();
  });
  el.viewToggle.querySelectorAll("button").forEach(b => {
    b.addEventListener("click", () => setView(b.dataset.view));
  });
  el.filterToggle.addEventListener("click", () => {
    const expanded = el.filterToggle.getAttribute("aria-expanded") === "true";
    el.filterToggle.setAttribute("aria-expanded", String(!expanded));
    el.filterPanel.hidden = expanded;
  });

  el.fabAdd.addEventListener("click", () => openForm(null));
  el.detailClose.addEventListener("click", closeDetail);
  el.detailSheet.addEventListener("click", e => {
    if (e.target === el.detailSheet) closeDetail();
  });

  el.formClose.addEventListener("click", closeForm);
  el.formCancel.addEventListener("click", closeForm);
  el.formSheet.addEventListener("click", e => {
    if (e.target === el.formSheet) closeForm();
  });
  el.form.addEventListener("submit", handleFormSubmit);
  el.fLocate.addEventListener("click", handleFormLocate);
  el.fPhotoAdd.addEventListener("click", () => el.fPhotoInput.click());
  el.fPhotoInput.addEventListener("change", handlePhotoInputChange);
  el.fVibeAdd.addEventListener("click", addCustomVibe);
  el.fVibeInput.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      addCustomVibe();
    }
  });
}

function addCustomVibe() {
  const value = el.fVibeInput.value.trim();
  if (value && !formState.vibes.includes(value)) {
    formState.vibes.push(value);
    el.fVibeInput.value = "";
    renderFormVibes();
  }
}

async function init() {
  initEvents();
  await refreshVenues();
  renderFilterChips();
  render();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(err => console.warn("SW-Registrierung fehlgeschlagen", err));
    });
  }
}

init();
