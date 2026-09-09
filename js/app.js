import { suggestedCategories, suggestedVibes } from "./data.js";
import { haversineDistanceKm, formatDistance, getCurrentPosition } from "./geo.js";
import { loadFilters, saveFilters, loadFavorites, saveFavorites } from "./store.js";
import { emptyFilters, applyFilters, deriveOptions } from "./filters.js";
import { initMap, renderVenueMarkers, setUserLocation, panTo, invalidateMapSize } from "./map.js";
import { subscribeVenues, putVenue, deleteVenue, createId } from "./firebase.js";
import { fileToCompressedBase64 } from "./image.js";
import { parseMapLink, geocodeAddress } from "./geocode.js";

const TYPE_LABELS = { bar: "Bar", cafe: "Café", coffee: "Coffee" };
const TYPE_EMOJI = { bar: "🍸", cafe: "☕", coffee: "☕" };
const PRICE_LABELS = { 1: "€", 2: "€€", 3: "€€€" };
const MAX_DOC_BYTES = 900_000; // Firestore-Limit ist 1 MiB pro Dokument, Puffer für andere Felder lassen

const state = {
  venues: [],
  filters: loadFilters() || structuredClone(emptyFilters),
  favorites: loadFavorites(),
  userLocation: null,
  distances: {},
  view: "list",
  loaded: false
};

let mapInitialized = false;

const formState = {
  editingId: null,
  photos: [],
  vibes: [],
  type: "bar",
  price: 2,
  location: null,
  mapLink: ""
};

const el = {
  list: document.getElementById("venue-list"),
  typeOverview: document.getElementById("type-overview"),
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
  detailSheetInner: document.querySelector("#detail-sheet .sheet"),
  detailClose: document.getElementById("detail-close"),
  detailPhotos: document.getElementById("detail-photos"),
  detailName: document.getElementById("detail-name"),
  detailMeta: document.getElementById("detail-meta"),
  detailAddress: document.getElementById("detail-address"),
  detailMapLink: document.getElementById("detail-maplink"),
  detailVibes: document.getElementById("detail-vibes"),
  detailDescription: document.getElementById("detail-description"),
  detailFav: document.getElementById("detail-fav"),
  detailEdit: document.getElementById("detail-edit"),
  detailDelete: document.getElementById("detail-delete"),

  formSheet: document.getElementById("form-sheet"),
  formSheetInner: document.querySelector("#form-sheet .sheet"),
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
  fMapLink: document.getElementById("f-maplink"),
  fMapLinkStatus: document.getElementById("f-maplink-status"),
  fAddress: document.getElementById("f-address"),
  fLocate: document.getElementById("f-locate"),
  fLocationStatus: document.getElementById("f-location-status"),
  fDescription: document.getElementById("f-description"),
  fPhotos: document.getElementById("f-photos"),
  fPhotoInput: document.getElementById("f-photo-input"),
  fPhotoAdd: document.getElementById("f-photo-add"),
  fSubmit: document.querySelector("#venue-form button[type=submit]"),
  fError: document.getElementById("f-error")
};

function toggleInArray(arr, value) {
  const i = arr.indexOf(value);
  if (i === -1) arr.push(value);
  else arr.splice(i, 1);
  return arr;
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

  const thumbHtml =
    v.photos && v.photos.length
      ? `<img class="venue-card__thumb" src="${v.photos[0]}" alt="" />`
      : `<div class="venue-card__thumb venue-card__thumb--placeholder venue-card__thumb--${v.type}">${TYPE_EMOJI[v.type] || "📍"}</div>`;

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

function renderTypeOverview() {
  el.typeOverview.innerHTML = "";
  if (state.view !== "list" || state.venues.length === 0) return;
  const counts = { bar: 0, cafe: 0, coffee: 0 };
  state.venues.forEach(v => {
    if (counts[v.type] !== undefined) counts[v.type]++;
  });
  ["bar", "cafe", "coffee"].forEach(type => {
    if (!counts[type]) return;
    const active = state.filters.types.includes(type);
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = `type-tile type-tile--${type}${active ? " type-tile--active" : ""}`;
    tile.innerHTML = `
      <span class="type-tile__emoji">${TYPE_EMOJI[type]}</span>
      <span class="type-tile__label">${TYPE_LABELS[type]}</span>
      <span class="type-tile__count">${counts[type]} ${counts[type] === 1 ? "Ort" : "Orte"}</span>
    `;
    tile.addEventListener("click", () => {
      toggleInArray(state.filters.types, type);
      persistAndRender();
    });
    el.typeOverview.appendChild(tile);
  });
}

function render() {
  const filtered = applyFilters(state.venues, state.filters, state.distances);
  el.resultCount.textContent = state.venues.length ? `${filtered.length} von ${state.venues.length}` : "";
  el.emptyGlobal.hidden = !state.loaded || state.venues.length !== 0;
  renderTypeOverview();

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

  el.detailPhotos.innerHTML = "";
  (v.photos || []).forEach(src => {
    const img = document.createElement("img");
    img.src = src;
    img.alt = v.name;
    el.detailPhotos.appendChild(img);
  });

  el.detailName.textContent = v.name;
  el.detailMeta.textContent = `${TYPE_LABELS[v.type]} · ${v.category || "—"} · ${PRICE_LABELS[v.priceRange]}${v.neighborhood ? " · " + v.neighborhood : ""}`;
  el.detailAddress.textContent = v.address || "";
  el.detailAddress.hidden = !v.address;

  const mapHref =
    v.mapLink || (typeof v.lat === "number" ? `https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lng}` : null);
  el.detailMapLink.hidden = !mapHref;
  if (mapHref) el.detailMapLink.href = mapHref;

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
    if (!confirm(`"${v.name}" wirklich für alle löschen?`)) return;
    el.detailDelete.disabled = true;
    try {
      await deleteVenue(v.id);
      state.favorites.delete(v.id);
      saveFavorites(state.favorites);
      closeDetail();
    } catch (err) {
      alert("Löschen fehlgeschlagen: " + err.message);
    } finally {
      el.detailDelete.disabled = false;
    }
  };

  el.detailSheet.hidden = false;
  el.detailSheetInner.scrollTop = 0;
}

function closeDetail() {
  el.detailSheet.hidden = true;
  el.detailPhotos.innerHTML = "";
}

// ---- Form sheet (add / edit) ----

function renderFormVibes() {
  const options = deriveOptions(state.venues);
  const values = [...new Set([...suggestedVibes, ...options.vibes, ...formState.vibes])].sort((a, b) => a.localeCompare(b, "de"));
  renderChips(el.fVibes, values, formState.vibes, null, renderFormVibes);
}

function renderFormPhotos() {
  el.fPhotos.innerHTML = "";
  formState.photos.forEach((src, index) => {
    const wrap = document.createElement("div");
    wrap.className = "photo-thumb";
    wrap.innerHTML = `<img src="${src}" alt="" /><button type="button" class="photo-thumb__remove" aria-label="Foto entfernen">✕</button>`;
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
  formState.mapLink = venue ? venue.mapLink || "" : "";

  el.fError.hidden = true;
  el.fMapLinkStatus.textContent = "";
  el.formTitle.textContent = venue ? "Location bearbeiten" : "Neue Location";
  el.fName.value = venue ? venue.name : "";
  el.fCategory.value = venue ? venue.category || "" : "";
  el.fNeighborhood.value = venue ? venue.neighborhood || "" : "";
  el.fMapLink.value = formState.mapLink;
  el.fAddress.value = venue ? venue.address || "" : "";
  el.fDescription.value = venue ? venue.description || "" : "";
  updateLocationStatus();

  renderTypeSegmented();
  renderPriceSegmented();
  renderCategorySuggestions();
  renderFormVibes();
  renderFormPhotos();

  el.formSheet.hidden = false;
  el.formSheetInner.scrollTop = 0;
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
  el.fPhotos.innerHTML = "";
  el.form.reset();
}

function updateLocationStatus() {
  el.fLocationStatus.textContent = formState.location
    ? `📍 Standort gesetzt (${formState.location.lat.toFixed(4)}, ${formState.location.lng.toFixed(4)})`
    : "Noch kein Standort gesetzt – Karte/Entfernung funktioniert erst danach.";
}

async function handleFormLocate() {
  el.fLocate.disabled = true;
  el.fLocate.textContent = "Suche…";
  try {
    const pos = await getCurrentPosition();
    formState.location = pos;
    updateLocationStatus();
  } catch (err) {
    el.fLocationStatus.textContent = "Standort nicht verfügbar.";
    console.warn(err);
  } finally {
    el.fLocate.disabled = false;
    el.fLocate.textContent = "📍 Aktuellen Standort verwenden";
  }
}

async function handleMapLinkBlur() {
  const value = el.fMapLink.value.trim();
  formState.mapLink = value;
  if (!value) {
    el.fMapLinkStatus.textContent = "";
    return;
  }

  const parsed = parseMapLink(value);
  if (!parsed) {
    el.fMapLinkStatus.textContent = "Konnte aus dem Link nichts auslesen. Adresse unten manuell eintragen.";
    return;
  }
  if (parsed.shortLink) {
    el.fMapLinkStatus.textContent = "Kurzlinks (maps.app.goo.gl) können nicht automatisch gelesen werden – bitte Adresse unten manuell eintragen. Der Link wird trotzdem gespeichert und ist später abrufbar.";
    return;
  }

  if (parsed.address && !el.fAddress.value.trim()) {
    el.fAddress.value = parsed.address;
  }
  if (parsed.name && !el.fName.value.trim()) {
    el.fName.value = parsed.name;
  }

  if (parsed.lat !== null && parsed.lng !== null) {
    formState.location = { lat: parsed.lat, lng: parsed.lng };
    updateLocationStatus();
    el.fMapLinkStatus.textContent = "✓ Standort aus Link übernommen.";
  } else if (el.fAddress.value.trim()) {
    el.fMapLinkStatus.textContent = "Adresse übernommen – suche Standort dafür…";
    await geocodeAddressField();
  } else {
    el.fMapLinkStatus.textContent = "Name/Adresse übernommen, aber kein Standort im Link gefunden.";
  }
}

async function geocodeAddressField() {
  const query = [el.fAddress.value.trim(), el.fNeighborhood.value.trim(), "München"].filter(Boolean).join(", ");
  if (!el.fAddress.value.trim()) return;
  try {
    const result = await geocodeAddress(query);
    if (result) {
      formState.location = { lat: result.lat, lng: result.lng };
      updateLocationStatus();
      el.fMapLinkStatus.textContent = "✓ Standort zur Adresse gefunden.";
    } else {
      el.fMapLinkStatus.textContent = "Adresse nicht gefunden. Standort ggf. per GPS oder Link setzen.";
    }
  } catch (err) {
    console.warn(err);
    el.fMapLinkStatus.textContent = "Geocoding gerade nicht erreichbar.";
  }
}

async function handleAddressBlur() {
  if (!el.fAddress.value.trim()) return;
  el.fMapLinkStatus.textContent = "Suche Standort für die Adresse…";
  await geocodeAddressField();
}

async function handlePhotoInputChange(e) {
  const files = [...e.target.files];
  e.target.value = "";
  for (const file of files) {
    try {
      const base64 = await fileToCompressedBase64(file);
      formState.photos.push(base64);
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
    mapLink: el.fMapLink.value.trim(),
    lat: formState.location ? formState.location.lat : null,
    lng: formState.location ? formState.location.lng : null,
    description: el.fDescription.value.trim(),
    photos: [...formState.photos],
    createdAt: existing ? existing.createdAt : Date.now()
  };

  const estimatedSize = new Blob([JSON.stringify(venue)]).size;
  if (estimatedSize > MAX_DOC_BYTES) {
    el.fError.textContent = "Zu viele/große Fotos für einen Eintrag. Bitte ein Foto entfernen und erneut speichern.";
    el.fError.hidden = false;
    return;
  }

  el.fSubmit.disabled = true;
  el.fSubmit.textContent = "Speichert…";
  try {
    await putVenue(venue);
    closeForm();
  } catch (err) {
    el.fError.textContent = "Speichern fehlgeschlagen: " + err.message;
    el.fError.hidden = false;
  } finally {
    el.fSubmit.disabled = false;
    el.fSubmit.textContent = "Speichern";
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
  el.fMapLink.addEventListener("blur", handleMapLinkBlur);
  el.fAddress.addEventListener("blur", handleAddressBlur);
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

function init() {
  initEvents();

  subscribeVenues(
    venues => {
      state.venues = venues;
      state.loaded = true;
      state.distances = computeDistances();
      renderFilterChips();
      render();
    },
    () => {
      el.resultCount.textContent = "Verbindung zur Datenbank fehlgeschlagen";
    }
  );

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(err => console.warn("SW-Registrierung fehlgeschlagen", err));
    });
  }
}

init();
