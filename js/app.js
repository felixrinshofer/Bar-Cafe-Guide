import { suggestedCategories, suggestedVibes } from "./data.js";
import { haversineDistanceKm, formatDistance, getCurrentPosition } from "./geo.js";
import { loadFilters, saveFilters, loadFavorites, saveFavorites } from "./store.js";
import { emptyFilters, applyFilters, deriveOptions } from "./filters.js";
import { initMap, renderVenueMarkers, setUserLocation, panTo, invalidateMapSize } from "./map.js";
import {
  subscribeVenues,
  putVenue,
  deleteVenue,
  createId,
  onAuthChange,
  registerUser,
  loginUser,
  logoutUser,
  subscribeDrinks,
  addDrink,
  subscribeUserProfiles,
  updateUserProfile
} from "./firebase.js";
import { fileToCompressedBase64, urlToCompressedBase64 } from "./image.js";
import { parseMapLink, geocodeAddress } from "./geocode.js";
import { searchPlaces, fetchCommonsImageUrl } from "./placesearch.js";

const TYPE_ORDER = ["bar", "cafe", "dancebar", "club", "restaurant", "spot", "biergarten", "festzelt"];
const TYPE_LABELS = {
  bar: "Bar",
  cafe: "Café",
  dancebar: "Tanzbar",
  club: "Club",
  restaurant: "Restaurant",
  spot: "Spot",
  biergarten: "Biergarten",
  festzelt: "Festzelt"
};
const TYPE_EMOJI = {
  bar: "🍸",
  cafe: "☕",
  dancebar: "💃",
  club: "🪩",
  restaurant: "🍽️",
  spot: "📍",
  biergarten: "🍺",
  festzelt: "🎪"
};
const PRICE_LABELS = { 1: "€", 2: "€€", 3: "€€€" };
const DRINK_TYPES = [
  { id: "beer", label: "Bier", emoji: "🍺" },
  { id: "wine", label: "Wein", emoji: "🍷" },
  { id: "aperol", label: "Aperol", emoji: "🥂" },
  { id: "cocktail", label: "Cocktail", emoji: "🍸" },
  { id: "coffee", label: "Caffè", emoji: "☕" }
];
const DRINK_LOOKUP = Object.fromEntries(DRINK_TYPES.map(d => [d.id, d]));
const DRINK_ALCOHOL_GRAMS = {
  beer: 20, // 0,5l, ~5 Vol.-%
  wine: 19, // 0,2l Glas, ~12 Vol.-%
  aperol: 13, // Aperol Spritz, ~200ml, ~8 Vol.-%
  cocktail: 24, // ~200ml, ~15 Vol.-%
  coffee: 0
};
const AVG_BODY_WEIGHT_KG = 75;
const ELIMINATION_PER_HOUR = 0.15;
const GENDER_OPTIONS = [
  { id: "male", label: "Männlich", r: 0.7 },
  { id: "female", label: "Weiblich", r: 0.6 },
  { id: "other", label: "Divers", r: 0.65 }
];
const GENDER_LOOKUP = Object.fromEntries(GENDER_OPTIONS.map(g => [g.id, g]));
const DEFAULT_GENDER = "other";

function getUserR(profile) {
  return GENDER_LOOKUP[profile?.gender]?.r ?? GENDER_LOOKUP[DEFAULT_GENDER].r;
}

function getUserWeight(profile) {
  return profile?.weightKg && profile.weightKg > 0 ? profile.weightKg : AVG_BODY_WEIGHT_KG;
}
const MAX_DOC_BYTES = 900_000; // Firestore-Limit ist 1 MiB pro Dokument, Puffer für andere Felder lassen

const state = {
  venues: [],
  filters: loadFilters() || structuredClone(emptyFilters),
  favorites: loadFavorites(),
  userLocation: null,
  distances: {},
  view: "list",
  loaded: false,
  user: null,
  drinks: [],
  userProfiles: {}
};

let authMode = "login";
let pendingRegisterName = null;
let registerGenderValue = "other";
let editGenderValue = "other";
let rankingTimeframe = "today";
let profileCalendarOffset = 0;
const knownDisplayNames = {};
let selectedDrinkType = null;

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
  appHeader: document.getElementById("app-header"),
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
  mapBtn: document.getElementById("map-btn"),
  resultCount: document.getElementById("result-count"),
  resetBtn: document.getElementById("reset-filters"),
  filterToggle: document.getElementById("filter-toggle"),
  filterPanel: document.getElementById("filter-panel"),

  fabAdd: document.getElementById("fab-add"),

  lightbox: document.getElementById("lightbox"),
  lightboxImg: document.getElementById("lightbox-img"),
  lightboxClose: document.getElementById("lightbox-close"),

  detailSheet: document.getElementById("detail-sheet"),
  detailSheetInner: document.querySelector("#detail-sheet .sheet"),
  detailClose: document.getElementById("detail-close"),
  detailPhotos: document.getElementById("detail-photos"),
  detailName: document.getElementById("detail-name"),
  detailInfoTiles: document.getElementById("detail-info-tiles"),
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

  placeSearchSection: document.getElementById("place-search-section"),
  placeSearchInput: document.getElementById("place-search-input"),
  placeSearchBtn: document.getElementById("place-search-btn"),
  placeSearchStatus: document.getElementById("place-search-status"),
  placeSearchResults: document.getElementById("place-search-results"),

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
  fOpeningHours: document.getElementById("f-opening-hours"),
  fLocate: document.getElementById("f-locate"),
  fLocationStatus: document.getElementById("f-location-status"),
  fDescription: document.getElementById("f-description"),
  fPhotos: document.getElementById("f-photos"),
  fPhotoInput: document.getElementById("f-photo-input"),
  fPhotoAdd: document.getElementById("f-photo-add"),
  fSubmit: document.querySelector("#venue-form button[type=submit]"),
  fError: document.getElementById("f-error"),

  accountBtn: document.getElementById("account-btn"),
  accountSheet: document.getElementById("account-sheet"),
  accountClose: document.getElementById("account-close"),
  accountLoggedOut: document.getElementById("account-logged-out"),
  accountLoggedIn: document.getElementById("account-logged-in"),
  authTabs: document.getElementById("auth-tabs"),
  authForm: document.getElementById("auth-form"),
  authNameLabel: document.getElementById("auth-name-label"),
  authName: document.getElementById("auth-name"),
  authEmail: document.getElementById("auth-email"),
  authPassword: document.getElementById("auth-password"),
  authWeightLabel: document.getElementById("auth-weight-label"),
  authWeight: document.getElementById("auth-weight"),
  authGenderLabel: document.getElementById("auth-gender-label"),
  authGender: document.getElementById("auth-gender"),
  authError: document.getElementById("auth-error"),
  authSubmit: document.getElementById("auth-submit"),
  accountAvatar: document.getElementById("account-avatar"),
  accountName: document.getElementById("account-name"),
  accountEmail: document.getElementById("account-email"),
  profileWeight: document.getElementById("profile-weight"),
  profileGender: document.getElementById("profile-gender"),
  profileEditStatus: document.getElementById("profile-edit-status"),
  profileSaveBtn: document.getElementById("profile-save-btn"),
  accountLogout: document.getElementById("account-logout"),

  socialBtn: document.getElementById("social-btn"),
  addDrinkBtn: document.getElementById("add-drink-btn"),

  drinkSheet: document.getElementById("drink-sheet"),
  drinkClose: document.getElementById("drink-close"),
  drinkStepType: document.getElementById("drink-step-type"),
  drinkTypeGrid: document.getElementById("drink-type-grid"),
  drinkStepVenue: document.getElementById("drink-step-venue"),
  drinkBack: document.getElementById("drink-back"),
  drinkVenueSearch: document.getElementById("drink-venue-search"),
  drinkVenueList: document.getElementById("drink-venue-list"),
  drinkStatus: document.getElementById("drink-status"),

  rankingSheet: document.getElementById("ranking-sheet"),
  rankingClose: document.getElementById("ranking-close"),
  rankingFilter: document.getElementById("ranking-filter"),
  rankingChampions: document.getElementById("ranking-champions"),
  rankingList: document.getElementById("ranking-list"),
  rankingEmpty: document.getElementById("ranking-empty"),
  promilleCard: document.getElementById("promille-card"),
  promilleValue: document.getElementById("promille-value"),

  personDrinksSheet: document.getElementById("person-drinks-sheet"),
  personDrinksClose: document.getElementById("person-drinks-close"),
  personDrinksName: document.getElementById("person-drinks-name"),
  personDrinksSummary: document.getElementById("person-drinks-summary"),
  personDrinksList: document.getElementById("person-drinks-list"),

  profileSheet: document.getElementById("profile-sheet"),
  profileClose: document.getElementById("profile-close"),
  profileSettingsBtn: document.getElementById("profile-settings-btn"),
  profileAvatar: document.getElementById("profile-avatar"),
  profileName: document.getElementById("profile-name"),
  profileWeekStats: document.getElementById("profile-week-stats"),
  profileChart: document.getElementById("profile-chart"),
  profileStreaks: document.getElementById("profile-streaks"),
  profileCalendar: document.getElementById("profile-calendar")
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
  renderChips(el.typeChips, TYPE_ORDER, state.filters.types, t => TYPE_LABELS[t], persistAndRender);
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
      ${v.openingHours ? `<p class="venue-card__hours">🕒 ${v.openingHours}</p>` : ""}
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

  const favCount = state.venues.filter(v => state.favorites.has(v.id)).length;
  const favActive = state.filters.favoritesOnly;
  const favTile = document.createElement("button");
  favTile.type = "button";
  favTile.className = `type-tile type-tile--favorites${favActive ? " type-tile--active" : ""}`;
  favTile.innerHTML = `
    <span class="type-tile__emoji">⭐</span>
    <span class="type-tile__label">Favoriten</span>
    <span class="type-tile__count">${favCount} ${favCount === 1 ? "Ort" : "Orte"}</span>
  `;
  favTile.addEventListener("click", () => {
    state.filters.favoritesOnly = !state.filters.favoritesOnly;
    persistAndRender();
  });
  el.typeOverview.appendChild(favTile);

  const counts = Object.fromEntries(TYPE_ORDER.map(t => [t, 0]));
  state.venues.forEach(v => {
    if (counts[v.type] !== undefined) counts[v.type]++;
  });
  TYPE_ORDER.forEach(type => {
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
  const filtered = applyFilters(state.venues, state.filters, state.distances, state.favorites);
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
  el.mapBtn.classList.toggle("dock-btn--on", view === "map");
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
    img.addEventListener("click", () => openLightbox(src));
    el.detailPhotos.appendChild(img);
  });

  el.detailName.textContent = v.name;

  const mapHref =
    v.mapLink || (typeof v.lat === "number" ? `https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lng}` : null);

  const tiles = [
    { label: "Typ", value: `${TYPE_EMOJI[v.type] || "📍"} ${TYPE_LABELS[v.type]}` },
    { label: "Preis", value: PRICE_LABELS[v.priceRange] },
    { label: "Kategorie", value: v.category || "—", muted: !v.category },
    { label: "Stadtteil", value: v.neighborhood || "—", muted: !v.neighborhood }
  ];

  let tilesHtml = tiles
    .map(
      t => `
    <div class="info-tile">
      <span class="info-tile__label">${t.label}</span>
      <span class="info-tile__value${t.muted ? " info-tile__value--muted" : ""}">${t.value}</span>
    </div>`
    )
    .join("");

  if (v.address || mapHref) {
    tilesHtml += `
    <div class="info-tile info-tile--wide">
      <span class="info-tile__label">Adresse</span>
      <span class="info-tile__value${v.address ? "" : " info-tile__value--muted"}">${v.address || "Keine Adresse hinterlegt"}</span>
      ${mapHref ? `<a class="detail-maplink" href="${mapHref}" target="_blank" rel="noopener">📍 In Maps öffnen</a>` : ""}
    </div>`;
  }

  if (v.openingHours) {
    tilesHtml += `
    <div class="info-tile info-tile--wide">
      <span class="info-tile__label">Öffnungszeiten</span>
      <span class="info-tile__value">${v.openingHours}</span>
    </div>`;
  }

  el.detailInfoTiles.innerHTML = tilesHtml;
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

// ---- Lightbox ----

function openLightbox(src) {
  el.lightboxImg.src = src;
  el.lightbox.hidden = false;
}

function closeLightbox() {
  el.lightbox.hidden = true;
  el.lightboxImg.src = "";
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

// ---- Ortssuche (OpenStreetMap) ----

function renderPlaceResults(results) {
  el.placeSearchResults.innerHTML = "";
  results.forEach(r => {
    const row = document.createElement("div");
    row.className = "place-result";
    row.innerHTML = `
      <div class="place-result__info">
        <div class="place-result__name">${r.name}</div>
        <div class="place-result__address">${r.address || "Adresse unbekannt"}</div>
      </div>
      <button type="button" class="place-result__add">Hinzufügen</button>
    `;
    row.querySelector(".place-result__add").addEventListener("click", () => selectPlaceResult(r));
    el.placeSearchResults.appendChild(row);
  });
}

async function handlePlaceSearch() {
  const query = el.placeSearchInput.value.trim();
  if (!query) return;
  el.placeSearchBtn.disabled = true;
  el.placeSearchStatus.textContent = "Suche…";
  el.placeSearchResults.innerHTML = "";
  try {
    const results = await searchPlaces(query);
    if (results.length === 0) {
      el.placeSearchStatus.textContent = "Nichts gefunden. Du kannst die Felder unten auch manuell ausfüllen.";
    } else {
      el.placeSearchStatus.textContent = "";
      renderPlaceResults(results);
    }
  } catch (err) {
    console.warn(err);
    el.placeSearchStatus.textContent = "Suche gerade nicht erreichbar.";
  } finally {
    el.placeSearchBtn.disabled = false;
  }
}

async function selectPlaceResult(r) {
  el.fName.value = r.name;
  el.fAddress.value = r.address;
  el.fOpeningHours.value = r.openingHours || "";
  el.fNeighborhood.value = r.neighborhood;
  if (r.category) el.fCategory.value = r.category;
  formState.type = r.type;
  formState.location = { lat: r.lat, lng: r.lng };
  formState.mapLink = r.website || "";
  el.fMapLink.value = formState.mapLink;
  renderTypeSegmented();
  updateLocationStatus();

  el.placeSearchStatus.textContent = "✓ Übernommen - Preis/Vibes/Notizen unten ergänzen und speichern.";
  el.placeSearchResults.innerHTML = "";

  if (r.commonsFile) {
    el.placeSearchStatus.textContent = "✓ Übernommen - lade Vorschaubild…";
    try {
      const imgUrl = await fetchCommonsImageUrl(r.commonsFile);
      if (imgUrl) {
        const base64 = await urlToCompressedBase64(imgUrl);
        formState.photos.push(base64);
        renderFormPhotos();
      }
    } catch (err) {
      console.warn(err);
    } finally {
      el.placeSearchStatus.textContent = "✓ Übernommen - Preis/Vibes/Notizen unten ergänzen und speichern.";
    }
  }

  el.fName.focus();
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
  el.fOpeningHours.value = venue ? venue.openingHours || "" : "";
  el.fDescription.value = venue ? venue.description || "" : "";
  updateLocationStatus();

  renderTypeSegmented();
  renderPriceSegmented();
  renderCategorySuggestions();
  renderFormVibes();
  renderFormPhotos();

  el.placeSearchSection.hidden = !!venue;
  el.placeSearchInput.value = "";
  el.placeSearchStatus.textContent = "";
  el.placeSearchResults.innerHTML = "";

  el.formSheet.hidden = false;
  el.formSheetInner.scrollTop = 0;
}

function renderTypeSegmented() {
  renderSegmented(el.fType, TYPE_ORDER, formState.type, t => TYPE_LABELS[t], value => {
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

let pendingGeocode = null;

function geocodeAddressField() {
  if (!el.fAddress.value.trim()) return Promise.resolve();
  const query = [el.fAddress.value.trim(), el.fNeighborhood.value.trim(), "München"].filter(Boolean).join(", ");
  pendingGeocode = (async () => {
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
    } finally {
      pendingGeocode = null;
    }
  })();
  return pendingGeocode;
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

  el.fSubmit.disabled = true;
  el.fSubmit.textContent = "Speichert…";

  // Adress-Geocoding läuft asynchron im Hintergrund (ausgelöst beim Verlassen des
  // Felds) - falls das noch nicht fertig ist oder nie ausgelöst wurde (z.B. Adresse
  // eingegeben und direkt gespeichert, ohne das Feld zu verlassen), hier abwarten/
  // nachholen, damit der Standort nicht fehlt.
  if (pendingGeocode) {
    await pendingGeocode;
  } else if (el.fAddress.value.trim() && !formState.location) {
    await geocodeAddressField();
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
    openingHours: el.fOpeningHours.value.trim(),
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
    el.fSubmit.disabled = false;
    el.fSubmit.textContent = "Speichern";
    return;
  }

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

const AUTH_ERROR_MESSAGES = {
  "auth/email-already-in-use": "Diese E-Mail ist bereits registriert.",
  "auth/invalid-email": "Ungültige E-Mail-Adresse.",
  "auth/weak-password": "Passwort muss mind. 6 Zeichen haben.",
  "auth/invalid-credential": "E-Mail oder Passwort falsch.",
  "auth/wrong-password": "E-Mail oder Passwort falsch.",
  "auth/user-not-found": "E-Mail oder Passwort falsch.",
  "auth/too-many-requests": "Zu viele Versuche. Bitte später erneut versuchen.",
  "auth/configuration-not-found": "Accounts sind in der Firebase-Konsole noch nicht aktiviert (Authentication → Sign-in method → E-Mail/Passwort)."
};

function setAuthMode(mode) {
  authMode = mode;
  el.authTabs.querySelectorAll("button").forEach(b => {
    b.classList.toggle("chip--active", b.dataset.mode === mode);
  });
  const isRegister = mode === "register";
  el.authNameLabel.hidden = !isRegister;
  el.authName.hidden = !isRegister;
  el.authName.required = isRegister;
  el.authWeightLabel.hidden = !isRegister;
  el.authWeight.hidden = !isRegister;
  el.authWeight.required = isRegister;
  el.authGenderLabel.hidden = !isRegister;
  el.authGender.hidden = !isRegister;
  if (isRegister) {
    registerGenderValue = DEFAULT_GENDER;
    renderRegisterGenderSegmented();
  }
  el.authPassword.autocomplete = isRegister ? "new-password" : "current-password";
  el.authSubmit.textContent = isRegister ? "Registrieren" : "Anmelden";
  el.authError.hidden = true;
}

function renderRegisterGenderSegmented() {
  renderSegmented(
    el.authGender,
    GENDER_OPTIONS.map(g => g.id),
    registerGenderValue,
    id => GENDER_LOOKUP[id].label,
    value => {
      registerGenderValue = value;
      renderRegisterGenderSegmented();
    }
  );
}

function populateProfileEditFields() {
  const profile = state.userProfiles[state.user.uid];
  el.profileWeight.value = profile?.weightKg || "";
  editGenderValue = profile?.gender || DEFAULT_GENDER;
  renderEditGenderSegmented();
}

function renderEditGenderSegmented() {
  renderSegmented(
    el.profileGender,
    GENDER_OPTIONS.map(g => g.id),
    editGenderValue,
    id => GENDER_LOOKUP[id].label,
    value => {
      editGenderValue = value;
      renderEditGenderSegmented();
    }
  );
}

async function handleProfileSave() {
  const weightKg = parseInt(el.profileWeight.value, 10);
  el.profileEditStatus.hidden = false;
  if (!weightKg || weightKg < 30 || weightKg > 250) {
    el.profileEditStatus.textContent = "Bitte ein gültiges Gewicht angeben (30–250 kg).";
    return;
  }
  el.profileSaveBtn.disabled = true;
  try {
    await updateUserProfile(state.user.uid, { gender: editGenderValue, weightKg });
    el.profileEditStatus.textContent = "Gespeichert.";
  } catch (err) {
    el.profileEditStatus.textContent = "Fehler beim Speichern. Bitte erneut versuchen.";
  } finally {
    el.profileSaveBtn.disabled = false;
  }
}

function openAccountSheet() {
  if (state.user) populateProfileEditFields();
  el.accountSheet.hidden = false;
}

function closeAccountSheet() {
  el.accountSheet.hidden = true;
  el.authError.hidden = true;
  el.profileEditStatus.hidden = true;
  el.authForm.reset();
  setAuthMode("login");
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  el.authError.hidden = true;
  el.authSubmit.disabled = true;
  try {
    let user;
    if (authMode === "register") {
      pendingRegisterName = el.authName.value.trim();
      const weightKg = parseInt(el.authWeight.value, 10);
      user = await registerUser(
        el.authEmail.value.trim(),
        el.authPassword.value,
        pendingRegisterName,
        registerGenderValue,
        weightKg
      );
    } else {
      user = await loginUser(el.authEmail.value.trim(), el.authPassword.value);
    }
    renderAccountUI(user);
    pendingRegisterName = null;
    closeAccountSheet();
  } catch (err) {
    pendingRegisterName = null;
    el.authError.textContent = AUTH_ERROR_MESSAGES[err.code] || "Etwas ist schiefgelaufen. Bitte erneut versuchen.";
    el.authError.hidden = false;
  } finally {
    el.authSubmit.disabled = false;
  }
}

function renderAccountUI(user) {
  state.user = user;
  if (user) {
    el.accountLoggedOut.hidden = true;
    el.accountLoggedIn.hidden = false;
    if (user.displayName) knownDisplayNames[user.uid] = user.displayName;
    const name = user.displayName || knownDisplayNames[user.uid] || pendingRegisterName || user.email;
    const initial = name.charAt(0).toUpperCase();
    el.accountName.textContent = name;
    el.accountEmail.textContent = user.email;
    el.accountAvatar.textContent = initial;
    el.accountBtn.textContent = initial;
    el.accountBtn.classList.add("account-btn--active");
  } else {
    el.accountLoggedOut.hidden = false;
    el.accountLoggedIn.hidden = true;
    el.accountBtn.innerHTML = '<img class="dock-icon" src="./icons/account.svg" alt="" />';
    el.accountBtn.classList.remove("account-btn--active");
  }
}

function openDrinkSheet() {
  if (!state.user) {
    openAccountSheet();
    return;
  }
  selectedDrinkType = null;
  el.drinkStepType.hidden = false;
  el.drinkStepVenue.hidden = true;
  el.drinkStatus.hidden = true;
  el.drinkVenueSearch.value = "";
  renderDrinkTypeGrid();
  el.drinkSheet.hidden = false;
}

function closeDrinkSheet() {
  el.drinkSheet.hidden = true;
}

function renderDrinkTypeGrid() {
  el.drinkTypeGrid.innerHTML = DRINK_TYPES.map(
    d => `<button type="button" class="drink-type-btn" data-drink="${d.id}">
      <span class="drink-type-btn__emoji">${d.emoji}</span>
      <span>${d.label}</span>
    </button>`
  ).join("");
  el.drinkTypeGrid.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedDrinkType = btn.dataset.drink;
      el.drinkStepType.hidden = true;
      el.drinkStepVenue.hidden = false;
      renderDrinkVenueList("");
    });
  });
}

function renderDrinkVenueList(filter) {
  const q = filter.trim().toLowerCase();
  const venues = state.venues
    .filter(v => !q || v.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!venues.length) {
    el.drinkVenueList.innerHTML = `<p class="field-hint">Keine Location gefunden.</p>`;
    return;
  }

  el.drinkVenueList.innerHTML = venues
    .map(
      v => `<button type="button" class="drink-venue-item" data-id="${v.id}">
        <span class="drink-venue-item__name">${v.name}</span>
        <span class="drink-venue-item__meta">${TYPE_LABELS[v.type]}${v.neighborhood ? " · " + v.neighborhood : ""}</span>
      </button>`
    )
    .join("");

  el.drinkVenueList.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      const venue = state.venues.find(v => v.id === btn.dataset.id);
      if (venue) handleSaveDrink(venue);
    });
  });
}

async function handleSaveDrink(venue) {
  if (!state.user || !selectedDrinkType) return;
  el.drinkStatus.hidden = false;
  el.drinkStatus.textContent = "Speichern…";
  try {
    await addDrink({
      uid: state.user.uid,
      displayName: state.user.displayName || state.user.email,
      venueId: venue.id,
      venueName: venue.name,
      drinkType: selectedDrinkType
    });
    el.drinkStatus.textContent = `${DRINK_LOOKUP[selectedDrinkType].emoji} Gespeichert!`;
    setTimeout(closeDrinkSheet, 800);
  } catch (err) {
    el.drinkStatus.textContent = "Fehler beim Speichern. Bitte erneut versuchen.";
  }
}

const RANKING_EMPTY_MESSAGES = {
  today: "Noch keine Getränke heute eingetragen.",
  month: "Noch keine Getränke diesen Monat eingetragen.",
  all: "Noch keine Getränke eingetragen."
};

function isInTimeframe(createdAt, timeframe) {
  if (timeframe === "all") return true;
  const now = new Date();
  const d = new Date(createdAt);
  if (timeframe === "today") {
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  }
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function setRankingTimeframe(timeframe) {
  rankingTimeframe = timeframe;
  el.rankingFilter.querySelectorAll("button").forEach(b => {
    b.classList.toggle("chip--active", b.dataset.filter === timeframe);
  });
  renderRanking();
}

function openRankingSheet() {
  renderRanking();
  el.rankingSheet.hidden = false;
}

function closeRankingSheet() {
  el.rankingSheet.hidden = true;
}

function calculateBac(drinks, profile) {
  const totalGrams = drinks.reduce((sum, d) => sum + (DRINK_ALCOHOL_GRAMS[d.drinkType] || 0), 0);
  if (totalGrams <= 0) return 0;
  const peakBac = totalGrams / (getUserWeight(profile) * getUserR(profile));
  const earliest = Math.min(...drinks.map(d => d.createdAt));
  const hoursElapsed = Math.max(0, (Date.now() - earliest) / 3600000);
  return Math.max(0, peakBac - hoursElapsed * ELIMINATION_PER_HOUR);
}

function calculatePeakBacForDay(dayDrinks, profile) {
  const totalGrams = dayDrinks.reduce((sum, d) => sum + (DRINK_ALCOHOL_GRAMS[d.drinkType] || 0), 0);
  if (totalGrams <= 0) return 0;
  return totalGrams / (getUserWeight(profile) * getUserR(profile));
}

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d;
}

function mondayOfWeek(ts) {
  const d = startOfDay(ts);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function dateKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function calculateDailyStreak(drinks) {
  const days = new Set(drinks.map(d => dateKey(startOfDay(d.createdAt))));
  let cursor = startOfDay(Date.now());
  if (!days.has(dateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  while (days.has(dateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function calculateWeeklyStreak(drinks) {
  const weeks = new Set(drinks.map(d => dateKey(mondayOfWeek(d.createdAt))));
  let cursor = mondayOfWeek(Date.now());
  if (!weeks.has(dateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 7);
  }
  let streak = 0;
  while (weeks.has(dateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 7);
  }
  return streak;
}

function groupByDay(drinks) {
  const byDay = {};
  drinks.forEach(d => {
    const key = dateKey(startOfDay(d.createdAt));
    byDay[key] = byDay[key] || [];
    byDay[key].push(d);
  });
  return byDay;
}

function getWeeklyPeakSeries(drinks, weeksCount, profile) {
  const currentMonday = mondayOfWeek(Date.now());
  const series = [];
  for (let i = weeksCount - 1; i >= 0; i--) {
    const weekStart = new Date(currentMonday);
    weekStart.setDate(weekStart.getDate() - i * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const weekDrinks = drinks.filter(d => d.createdAt >= weekStart.getTime() && d.createdAt < weekEnd.getTime());
    const byDay = groupByDay(weekDrinks);
    let weekPeak = 0;
    Object.values(byDay).forEach(dayDrinks => {
      const peak = calculatePeakBacForDay(dayDrinks, profile);
      if (peak > weekPeak) weekPeak = peak;
    });
    series.push({ weekStart, peak: weekPeak });
  }
  return series;
}

function bacColorClass(bac) {
  if (bac > 2.0) return "ranking-row--red";
  if (bac >= 1.0) return "ranking-row--yellow";
  return "ranking-row--green";
}

function updatePromilleCard() {
  if (rankingTimeframe !== "today" || !state.user) {
    el.promilleCard.hidden = true;
    return;
  }
  const myDrinksToday = state.drinks.filter(d => d.uid === state.user.uid && isInTimeframe(d.createdAt, "today"));
  if (!myDrinksToday.length) {
    el.promilleCard.hidden = true;
    return;
  }
  const bac = calculateBac(myDrinksToday, state.userProfiles[state.user.uid]);
  el.promilleValue.textContent = bac.toFixed(2).replace(".", ",") + "‰";
  el.promilleCard.hidden = false;
}

function buildPromilleChartHtml(series) {
  const width = 300;
  const height = 120;
  const peaks = series.map(s => s.peak);
  const rawMax = Math.max(...peaks, 0);
  const maxVal = Math.max(1, Math.ceil(rawMax * 2) / 2);
  const n = series.length;
  const stepX = n > 1 ? width / (n - 1) : width;

  const points = series.map((s, i) => ({
    x: i * stepX,
    y: height - (s.peak / maxVal) * (height - 10),
    ...s
  }));

  const linePoints = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPoints = `0,${height} ${linePoints} ${width},${height}`;

  const circles = points
    .map((p, i) => {
      const isLast = i === points.length - 1;
      return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${isLast ? 5 : 3.5}" fill="${
        isLast ? "#0056b3" : "white"
      }" stroke="#0056b3" stroke-width="2" />`;
    })
    .join("");

  const svg = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="promille-chart__svg">
      <polygon points="${areaPoints}" fill="rgba(0,86,179,0.12)" />
      <polyline points="${linePoints}" fill="none" stroke="#0056b3" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      ${circles}
    </svg>`;

  const fmt = v => v.toFixed(1).replace(".", ",") + "‰";

  const monthLabels = [];
  let lastMonth = null;
  series.forEach((s, i) => {
    const m = s.weekStart.getMonth();
    if (m !== lastMonth) {
      monthLabels.push({
        index: i,
        label: s.weekStart.toLocaleDateString("de-DE", { month: "short" }).replace(".", "").toUpperCase()
      });
      lastMonth = m;
    }
  });
  const monthsHtml = monthLabels
    .map(m => `<span class="promille-chart__month" style="left:${n > 1 ? (m.index / (n - 1)) * 100 : 0}%">${m.label}</span>`)
    .join("");

  return `<div class="promille-chart">
    <div class="promille-chart__body">
      <div class="promille-chart__main">${svg}</div>
      <div class="promille-chart__months">${monthsHtml}</div>
    </div>
    <div class="promille-chart__axis">
      <span>${fmt(maxVal)}</span>
      <span>${fmt(maxVal / 2)}</span>
      <span>0‰</span>
    </div>
  </div>`;
}

function renderProfileWeekStats(myDrinks, profile) {
  const monday = mondayOfWeek(Date.now());
  const weekDrinks = myDrinks.filter(d => d.createdAt >= monday.getTime());
  const days = new Set(weekDrinks.map(d => dateKey(startOfDay(d.createdAt))));
  const byDay = groupByDay(weekDrinks);
  let peak = 0;
  Object.values(byDay).forEach(dayDrinks => {
    const p = calculatePeakBacForDay(dayDrinks, profile);
    if (p > peak) peak = p;
  });

  el.profileWeekStats.innerHTML = `
    <div class="profile-stat">
      <span class="profile-stat__label">Getränke</span>
      <span class="profile-stat__value">${weekDrinks.length}</span>
    </div>
    <div class="profile-stat">
      <span class="profile-stat__label">Trinktage</span>
      <span class="profile-stat__value">${days.size}</span>
    </div>
    <div class="profile-stat">
      <span class="profile-stat__label">Spitzenwert</span>
      <span class="profile-stat__value">${peak.toFixed(2).replace(".", ",")}‰</span>
    </div>
  `;
}

function renderProfileStreaks(myDrinks) {
  const weeklyStreak = calculateWeeklyStreak(myDrinks);
  const dailyStreak = calculateDailyStreak(myDrinks);
  el.profileStreaks.innerHTML = `
    <div class="streak-card">
      <span class="streak-card__icon">🔥</span>
      <span class="streak-card__value">${weeklyStreak}</span>
      <span class="streak-card__label">Wochen in Folge</span>
    </div>
    <div class="streak-card">
      <span class="streak-card__icon">🔥</span>
      <span class="streak-card__value">${dailyStreak}</span>
      <span class="streak-card__label">Tage in Folge</span>
    </div>
  `;
}

function renderProfileCalendar(myDrinks) {
  const now = new Date();
  const viewDate = new Date(now.getFullYear(), now.getMonth() + profileCalendarOffset, 1);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const daysWithDrinks = new Set(myDrinks.map(d => dateKey(startOfDay(d.createdAt))));

  const firstOfMonth = new Date(year, month, 1);
  const startDay = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = dateKey(startOfDay(Date.now()));

  const cells = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const monthLabel = viewDate.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  const dayLabels = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

  const cellsHtml = cells
    .map(d => {
      if (d === null) return `<span class="profile-calendar__cell profile-calendar__cell--empty"></span>`;
      const key = dateKey(new Date(year, month, d));
      const classes = ["profile-calendar__cell"];
      if (daysWithDrinks.has(key)) classes.push("profile-calendar__cell--active");
      if (key === todayKey) classes.push("profile-calendar__cell--today");
      return `<span class="${classes.join(" ")}">${d}</span>`;
    })
    .join("");

  el.profileCalendar.innerHTML = `
    <div class="profile-calendar">
      <div class="profile-calendar__header">
        <button type="button" class="profile-calendar__nav" id="calendar-prev">‹</button>
        <span class="profile-calendar__title">${monthLabel}</span>
        <button type="button" class="profile-calendar__nav" id="calendar-next">›</button>
      </div>
      <div class="profile-calendar__weekdays">${dayLabels.map(l => `<span>${l}</span>`).join("")}</div>
      <div class="profile-calendar__grid">${cellsHtml}</div>
    </div>
  `;

  document.getElementById("calendar-prev").addEventListener("click", () => {
    profileCalendarOffset -= 1;
    renderProfileCalendar(myDrinks);
  });
  document.getElementById("calendar-next").addEventListener("click", () => {
    profileCalendarOffset += 1;
    renderProfileCalendar(myDrinks);
  });
}

function renderProfileSheet() {
  if (!state.user) return;
  const name = state.user.displayName || state.user.email;
  el.profileName.textContent = name;
  el.profileAvatar.textContent = name.charAt(0).toUpperCase();

  const myDrinks = state.drinks.filter(d => d.uid === state.user.uid);
  const profile = state.userProfiles[state.user.uid];

  renderProfileWeekStats(myDrinks, profile);
  el.profileChart.innerHTML = buildPromilleChartHtml(getWeeklyPeakSeries(myDrinks, 12, profile));
  renderProfileStreaks(myDrinks);
  renderProfileCalendar(myDrinks);
}

function openProfileSheet() {
  profileCalendarOffset = 0;
  renderProfileSheet();
  el.profileSheet.hidden = false;
}

function closeProfileSheet() {
  el.profileSheet.hidden = true;
}

function renderRanking() {
  updatePromilleCard();

  const drinks = state.drinks.filter(d => isInTimeframe(d.createdAt, rankingTimeframe));

  if (!drinks.length) {
    el.rankingChampions.innerHTML = "";
    el.rankingList.innerHTML = "";
    el.rankingEmpty.textContent = RANKING_EMPTY_MESSAGES[rankingTimeframe];
    el.rankingEmpty.hidden = false;
    return;
  }
  el.rankingEmpty.hidden = true;

  const totals = {};
  const byType = {};
  drinks.forEach(d => {
    if (!d.uid) return;
    const name = d.displayName || "Unbekannt";
    totals[d.uid] = totals[d.uid] || { name, count: 0 };
    totals[d.uid].count += 1;

    byType[d.drinkType] = byType[d.drinkType] || {};
    byType[d.drinkType][d.uid] = byType[d.drinkType][d.uid] || { name, count: 0 };
    byType[d.drinkType][d.uid].count += 1;
  });

  el.rankingChampions.innerHTML = DRINK_TYPES.map(type => {
    const entries = Object.values(byType[type.id] || {});
    if (!entries.length) return "";
    const top = entries.sort((a, b) => b.count - a.count)[0];
    return `<div class="ranking-champion">
      <span class="ranking-champion__emoji">${type.emoji}</span>
      <div class="ranking-champion__text">
        <p class="ranking-champion__title">${type.label}-Champion</p>
        <p class="ranking-champion__name">${top.name} · ${top.count}</p>
      </div>
    </div>`;
  }).join("");

  if (rankingTimeframe === "today") {
    const drinksByUid = {};
    drinks.forEach(d => {
      if (!d.uid) return;
      drinksByUid[d.uid] = drinksByUid[d.uid] || [];
      drinksByUid[d.uid].push(d);
    });

    const rankedByBac = Object.entries(totals)
      .map(([uid, t]) => ({ uid, name: t.name, bac: calculateBac(drinksByUid[uid] || [], state.userProfiles[uid]) }))
      .sort((a, b) => b.bac - a.bac);

    el.rankingList.innerHTML = rankedByBac
      .map(
        (r, i) => `<div class="ranking-row ranking-row--tile ranking-row--clickable ${bacColorClass(r.bac)}" data-uid="${r.uid}" data-name="${r.name}">
          <span class="ranking-row__rank">${i + 1}</span>
          <span class="ranking-row__name">${r.name}</span>
          <span class="ranking-row__count">${r.bac.toFixed(2).replace(".", ",")}‰</span>
        </div>`
      )
      .join("");
  } else {
    const ranked = Object.entries(totals)
      .map(([uid, t]) => ({ uid, name: t.name, count: t.count }))
      .sort((a, b) => b.count - a.count);
    el.rankingList.innerHTML = ranked
      .map(
        (r, i) => `<div class="ranking-row ranking-row--clickable" data-uid="${r.uid}" data-name="${r.name}">
          <span class="ranking-row__rank">${i + 1}</span>
          <span class="ranking-row__name">${r.name}</span>
          <span class="ranking-row__count">${r.count}</span>
        </div>`
      )
      .join("");
  }

  el.rankingList.querySelectorAll(".ranking-row").forEach(row => {
    row.addEventListener("click", () => openPersonDrinksSheet(row.dataset.uid, row.dataset.name));
  });
}

function formatDrinkTimestamp(ts) {
  const d = new Date(ts);
  const time = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (rankingTimeframe === "today") return time;
  const date = d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  return `${date} · ${time}`;
}

function openPersonDrinksSheet(uid, name) {
  const personDrinks = state.drinks
    .filter(d => d.uid === uid && isInTimeframe(d.createdAt, rankingTimeframe))
    .sort((a, b) => b.createdAt - a.createdAt);

  el.personDrinksName.textContent = name;

  const counts = {};
  personDrinks.forEach(d => {
    counts[d.drinkType] = (counts[d.drinkType] || 0) + 1;
  });
  el.personDrinksSummary.innerHTML = DRINK_TYPES.filter(t => counts[t.id])
    .map(t => `<span class="person-drinks-chip">${t.emoji} ${counts[t.id]}×</span>`)
    .join("");

  el.personDrinksList.innerHTML = personDrinks
    .map(d => {
      const type = DRINK_LOOKUP[d.drinkType];
      return `<div class="person-drinks-row">
        <span class="person-drinks-row__emoji">${type ? type.emoji : "🥤"}</span>
        <div class="person-drinks-row__text">
          <p class="person-drinks-row__type">${type ? type.label : d.drinkType}</p>
          <p class="person-drinks-row__venue">${d.venueName || ""}</p>
        </div>
        <span class="person-drinks-row__time">${formatDrinkTimestamp(d.createdAt)}</span>
      </div>`;
    })
    .join("");

  el.personDrinksSheet.hidden = false;
}

function closePersonDrinksSheet() {
  el.personDrinksSheet.hidden = true;
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
  el.mapBtn.addEventListener("click", () => setView(state.view === "map" ? "list" : "map"));
  el.filterToggle.addEventListener("click", () => {
    const expanded = el.filterToggle.getAttribute("aria-expanded") === "true";
    el.filterToggle.setAttribute("aria-expanded", String(!expanded));
    el.filterPanel.hidden = expanded;
  });

  el.fabAdd.addEventListener("click", () => {
    if (!state.user) {
      openAccountSheet();
      return;
    }
    openForm(null);
  });
  el.detailClose.addEventListener("click", closeDetail);
  el.detailSheet.addEventListener("click", e => {
    if (e.target === el.detailSheet) closeDetail();
  });

  el.lightboxClose.addEventListener("click", closeLightbox);
  el.lightbox.addEventListener("click", e => {
    if (e.target === el.lightbox) closeLightbox();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !el.lightbox.hidden) closeLightbox();
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
  el.placeSearchBtn.addEventListener("click", handlePlaceSearch);
  el.placeSearchInput.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      handlePlaceSearch();
    }
  });
  el.fPhotoAdd.addEventListener("click", () => el.fPhotoInput.click());
  el.fPhotoInput.addEventListener("change", handlePhotoInputChange);
  el.fVibeAdd.addEventListener("click", addCustomVibe);
  el.fVibeInput.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      addCustomVibe();
    }
  });

  el.accountBtn.addEventListener("click", () => {
    if (state.user) {
      openProfileSheet();
    } else {
      openAccountSheet();
    }
  });
  el.profileClose.addEventListener("click", closeProfileSheet);
  el.profileSheet.addEventListener("click", e => {
    if (e.target === el.profileSheet) closeProfileSheet();
  });
  el.profileSettingsBtn.addEventListener("click", () => {
    closeProfileSheet();
    openAccountSheet();
  });
  el.accountClose.addEventListener("click", closeAccountSheet);
  el.accountSheet.addEventListener("click", e => {
    if (e.target === el.accountSheet) closeAccountSheet();
  });
  el.authTabs.querySelectorAll("button").forEach(b => {
    b.addEventListener("click", () => setAuthMode(b.dataset.mode));
  });
  el.authForm.addEventListener("submit", handleAuthSubmit);
  el.accountLogout.addEventListener("click", () => logoutUser());
  el.profileSaveBtn.addEventListener("click", handleProfileSave);

  el.addDrinkBtn.addEventListener("click", openDrinkSheet);
  el.drinkClose.addEventListener("click", closeDrinkSheet);
  el.drinkSheet.addEventListener("click", e => {
    if (e.target === el.drinkSheet) closeDrinkSheet();
  });
  el.drinkBack.addEventListener("click", () => {
    el.drinkStepVenue.hidden = true;
    el.drinkStepType.hidden = false;
  });
  el.drinkVenueSearch.addEventListener("input", e => renderDrinkVenueList(e.target.value));

  el.socialBtn.addEventListener("click", openRankingSheet);
  el.rankingClose.addEventListener("click", closeRankingSheet);
  el.rankingSheet.addEventListener("click", e => {
    if (e.target === el.rankingSheet) closeRankingSheet();
  });
  el.rankingFilter.querySelectorAll("button").forEach(b => {
    b.addEventListener("click", () => setRankingTimeframe(b.dataset.filter));
  });

  el.personDrinksClose.addEventListener("click", closePersonDrinksSheet);
  el.personDrinksSheet.addEventListener("click", e => {
    if (e.target === el.personDrinksSheet) closePersonDrinksSheet();
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

const SCROLL_SHRINK_THRESHOLD = 16;
let scrollTicking = false;

function initHeaderShrink() {
  window.addEventListener(
    "scroll",
    () => {
      if (scrollTicking) return;
      scrollTicking = true;
      requestAnimationFrame(() => {
        el.appHeader.classList.toggle("header--scrolled", window.scrollY > SCROLL_SHRINK_THRESHOLD);
        scrollTicking = false;
      });
    },
    { passive: true }
  );
}

function easeOutBack(t) {
  const c1 = 0.85;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

let typeOverviewAnimating = false;

function animateScrollWithBounce(container, target) {
  const start = container.scrollLeft;
  const distance = target - start;
  if (Math.abs(distance) < 1) {
    container.scrollLeft = target;
    return;
  }
  typeOverviewAnimating = true;
  const duration = 400;
  const startTime = performance.now();

  function step(now) {
    const t = Math.min(1, (now - startTime) / duration);
    container.scrollLeft = start + distance * easeOutBack(t);
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      setTimeout(() => {
        typeOverviewAnimating = false;
      }, 50);
    }
  }
  requestAnimationFrame(step);
}

function snapTypeOverviewToNearestTile() {
  const container = el.typeOverview;
  const tiles = [...container.children];
  if (!tiles.length) return;
  const containerRect = container.getBoundingClientRect();
  const containerCenter = containerRect.left + containerRect.width / 2;

  let closest = tiles[0];
  let closestDist = Infinity;
  tiles.forEach(tile => {
    const rect = tile.getBoundingClientRect();
    const tileCenter = rect.left + rect.width / 2;
    const dist = Math.abs(tileCenter - containerCenter);
    if (dist < closestDist) {
      closestDist = dist;
      closest = tile;
    }
  });

  const closestRect = closest.getBoundingClientRect();
  const closestCenter = closestRect.left + closestRect.width / 2;
  const target = container.scrollLeft + (closestCenter - containerCenter);
  animateScrollWithBounce(container, Math.max(0, target));
}

function initTypeOverviewSnap() {
  let scrollTimeout = null;
  el.typeOverview.addEventListener(
    "scroll",
    () => {
      if (typeOverviewAnimating) return;
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => snapTypeOverviewToNearestTile(), 100);
    },
    { passive: true }
  );
}

function initScrollLock() {
  const overlays = [...document.querySelectorAll(".sheet-backdrop"), el.lightbox].filter(Boolean);
  let savedScrollY = 0;

  function anyOpen() {
    return overlays.some(o => !o.hidden);
  }

  function applyLock() {
    const shouldLock = anyOpen();
    const isLocked = document.body.style.position === "fixed";
    if (shouldLock && !isLocked) {
      savedScrollY = window.scrollY;
      document.body.style.position = "fixed";
      document.body.style.top = `-${savedScrollY}px`;
      document.body.style.left = "0";
      document.body.style.right = "0";
      document.body.style.width = "100%";
    } else if (!shouldLock && isLocked) {
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.width = "";
      window.scrollTo(0, savedScrollY);
    }
  }

  const observer = new MutationObserver(applyLock);
  overlays.forEach(o => observer.observe(o, { attributes: true, attributeFilter: ["hidden"] }));
}

function initSheetDragToDismiss() {
  document.querySelectorAll(".sheet-backdrop").forEach(backdrop => {
    const sheet = backdrop.querySelector(".sheet");
    const handle = backdrop.querySelector(".sheet__handle");
    const closeBtn = backdrop.querySelector(".sheet__close");
    if (!sheet || !handle || !closeBtn) return;

    let startY = 0;
    let dragY = 0;
    let dragging = false;

    function pointY(e) {
      return e.touches ? e.touches[0].clientY : e.clientY;
    }

    function onStart(e) {
      dragging = true;
      startY = pointY(e);
      dragY = 0;
      sheet.style.transition = "none";
    }

    function onMove(e) {
      if (!dragging) return;
      const delta = Math.max(0, pointY(e) - startY);
      dragY = delta;
      sheet.style.transform = `translateY(${delta}px)`;
      if (e.cancelable) e.preventDefault();
    }

    function onEnd() {
      if (!dragging) return;
      dragging = false;
      sheet.style.transition = "transform 0.35s var(--ease-liquid)";
      const threshold = sheet.offsetHeight * 0.22;
      if (dragY > threshold) {
        sheet.style.transform = "translateY(100%)";
        setTimeout(() => {
          closeBtn.click();
          sheet.style.transition = "";
          sheet.style.transform = "";
        }, 320);
      } else {
        sheet.style.transform = "translateY(0)";
      }
      dragY = 0;
    }

    handle.addEventListener("touchstart", onStart, { passive: true });
    handle.addEventListener("touchmove", onMove, { passive: false });
    handle.addEventListener("touchend", onEnd);
    handle.addEventListener("mousedown", onStart);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onEnd);
  });
}

function init() {
  initEvents();
  initHeaderShrink();
  initTypeOverviewSnap();
  initScrollLock();
  initSheetDragToDismiss();
  onAuthChange(renderAccountUI);

  subscribeDrinks(drinks => {
    state.drinks = drinks;
    if (!el.rankingSheet.hidden) renderRanking();
    if (!el.profileSheet.hidden) renderProfileSheet();
  });

  subscribeUserProfiles(profiles => {
    state.userProfiles = Object.fromEntries(profiles.map(p => [p.uid, p]));
    if (!el.rankingSheet.hidden) renderRanking();
    if (!el.profileSheet.hidden) renderProfileSheet();
    if (!el.accountSheet.hidden && state.user) populateProfileEditFields();
  });

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
