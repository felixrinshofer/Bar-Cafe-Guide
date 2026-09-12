import { suggestedCategories, suggestedVibes } from "./data.js";
import { haversineDistanceKm, formatDistance, getCurrentPosition } from "./geo.js";
import { loadFilters, saveFilters, loadFavorites, saveFavorites } from "./store.js";
import { emptyFilters, applyFilters, deriveOptions } from "./filters.js";
import { initMap, renderVenueMarkers, setUserLocation, renderPeopleMarkers, panTo, invalidateMapSize } from "./map.js";
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
  deleteDrink,
  subscribeUserProfiles,
  updateUserProfile,
  subscribeRatings,
  rateVenue
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
  { id: "beer03", label: "Bier 0,3l", emoji: "🍺" },
  { id: "beer", label: "Bier 0,5l", emoji: "🍺" },
  { id: "beerMass", label: "Maß 1l", emoji: "🍻" },
  { id: "wine", label: "Wein", emoji: "🍷" },
  { id: "aperol", label: "Aperol", emoji: "🥂" },
  { id: "cocktail", label: "Cocktail", emoji: "🍸" },
  { id: "shot", label: "Shot", emoji: "🥃" },
  { id: "coffee", label: "Caffè", emoji: "☕" },
  { id: "matcha", label: "Matcha", emoji: "🍵" },
  { id: "water", label: "Wasser", emoji: "💧" }
];
const DRINK_LOOKUP = Object.fromEntries(DRINK_TYPES.map(d => [d.id, d]));
const DRINK_ALCOHOL_GRAMS = {
  beer03: 12, // 0,3l, ~5 Vol.-%
  beer: 20, // 0,5l, ~5 Vol.-%
  beerMass: 40, // 1l Maß, ~5 Vol.-%
  wine: 19, // 0,2l Glas, ~12 Vol.-%
  aperol: 13, // Aperol Spritz, ~200ml, ~8 Vol.-%
  cocktail: 24, // ~200ml, ~15 Vol.-%
  shot: 13, // 4cl, ~40 Vol.-%
  coffee: 0,
  matcha: 0,
  water: 0
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
  filters: { ...structuredClone(emptyFilters), ...(loadFilters() || {}) },
  favorites: loadFavorites(),
  userLocation: null,
  distances: {},
  view: "list",
  loaded: false,
  user: null,
  drinks: [],
  userProfiles: {},
  ratings: [],
  ratingStats: {}
};

let authMode = "login";
let pendingRegisterName = null;
let registerGenderValue = "other";
let editGenderValue = "other";
let rankingTimeframe = "24h";
let profileCalendarOffset = 0;
let profileChartGranularity = "week";
let profileChartOffset = 0;
let currentChartSeries = [];
let currentChartMaxVal = 1;
let currentDetailVenueId = null;
const knownDisplayNames = {};
let selectedDrinkType = null;
let currentPersonDrinksUid = null;
let currentPersonDrinksName = null;

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
  headerPromilleBadge: document.getElementById("header-promille-badge"),
  headerPromilleValue: document.getElementById("header-promille-value"),
  list: document.getElementById("venue-list"),
  typeOverview: document.getElementById("type-overview"),
  mapView: document.getElementById("map-view"),
  mapDragHandle: document.getElementById("map-drag-handle"),
  emptyGlobal: document.getElementById("empty-state-global"),
  emptyGlobalIcon: document.getElementById("empty-state-icon"),
  emptyGlobalTitle: document.getElementById("empty-state-title"),
  emptyGlobalSubtitle: document.getElementById("empty-state-subtitle"),
  search: document.getElementById("search-input"),
  typeChips: document.getElementById("type-chips"),
  categoryChips: document.getElementById("category-chips"),
  priceChips: document.getElementById("price-chips"),
  vibeChips: document.getElementById("vibe-chips"),
  creatorChips: document.getElementById("creator-chips"),
  sortSelect: document.getElementById("sort-select"),
  locateBtn: document.getElementById("locate-btn"),
  mapBtn: document.getElementById("map-btn"),
  resetBtn: document.getElementById("reset-filters"),
  filterToggle: document.getElementById("filter-toggle"),
  filterPanel: document.getElementById("filter-panel"),

  fabAdd: document.getElementById("fab-add"),

  lightbox: document.getElementById("lightbox"),
  lightboxImg: document.getElementById("lightbox-img"),
  lightboxClose: document.getElementById("lightbox-close"),

  detailSheet: document.getElementById("detail-sheet"),
  detailSheetInner: document.querySelector("#detail-sheet .sheet"),
  detailPhotos: document.getElementById("detail-photos"),
  detailName: document.getElementById("detail-name"),
  detailInfoTiles: document.getElementById("detail-info-tiles"),
  detailVibes: document.getElementById("detail-vibes"),
  detailDescription: document.getElementById("detail-description"),
  detailFav: document.getElementById("detail-fav"),
  detailRatingSummary: document.getElementById("detail-rating-summary"),
  detailRatingInput: document.getElementById("detail-rating-input"),
  detailEdit: document.getElementById("detail-edit"),
  detailDelete: document.getElementById("detail-delete"),

  formSheet: document.getElementById("form-sheet"),
  formSheetInner: document.querySelector("#form-sheet .sheet"),
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
  fPhotoUrl: document.getElementById("f-photo-url"),
  fPhotoUrlAdd: document.getElementById("f-photo-url-add"),
  fPhotoUrlStatus: document.getElementById("f-photo-url-status"),
  fSubmit: document.querySelector("#venue-form button[type=submit]"),
  fError: document.getElementById("f-error"),

  accountBtn: document.getElementById("account-btn"),
  accountSheet: document.getElementById("account-sheet"),
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
  accountAvatarBtn: document.getElementById("account-avatar-btn"),
  accountAvatar: document.getElementById("account-avatar"),
  accountPhotoInput: document.getElementById("account-photo-input"),
  accountPhotoStatus: document.getElementById("account-photo-status"),
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
  drinkStepType: document.getElementById("drink-step-type"),
  drinkTypeGrid: document.getElementById("drink-type-grid"),
  drinkStepVenue: document.getElementById("drink-step-venue"),
  drinkBack: document.getElementById("drink-back"),
  drinkVenueSearch: document.getElementById("drink-venue-search"),
  drinkVenueList: document.getElementById("drink-venue-list"),
  drinkStepSuccess: document.getElementById("drink-step-success"),
  drinkSuccessText: document.getElementById("drink-success-text"),
  drinkStatus: document.getElementById("drink-status"),

  rankingSheet: document.getElementById("ranking-sheet"),
  rankingFilter: document.getElementById("ranking-filter"),
  rankingChampions: document.getElementById("ranking-champions"),
  rankingList: document.getElementById("ranking-list"),
  rankingEmpty: document.getElementById("ranking-empty"),
  promilleCard: document.getElementById("promille-card"),
  promilleValue: document.getElementById("promille-value"),

  personDrinksSheet: document.getElementById("person-drinks-sheet"),
  personDrinksName: document.getElementById("person-drinks-name"),
  personDrinksSummary: document.getElementById("person-drinks-summary"),
  personDrinksList: document.getElementById("person-drinks-list"),

  profileSheet: document.getElementById("profile-sheet"),
  profileSettingsBtn: document.getElementById("profile-settings-btn"),
  profileAvatar: document.getElementById("profile-avatar"),
  profileName: document.getElementById("profile-name"),
  profileWeekStats: document.getElementById("profile-week-stats"),
  chartGranularity: document.getElementById("chart-granularity"),
  chartPrev: document.getElementById("chart-prev"),
  chartNext: document.getElementById("chart-next"),
  chartRangeLabel: document.getElementById("chart-range-label"),
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

  const creatorIds = [...new Set(state.venues.map(v => v.createdBy).filter(Boolean))];
  const creatorNames = Object.fromEntries(
    creatorIds.map(uid => [uid, state.userProfiles[uid]?.displayName || knownDisplayNames[uid] || "Unbekannt"])
  );
  creatorIds.sort((a, b) => creatorNames[a].localeCompare(creatorNames[b], "de"));
  renderChips(el.creatorChips, creatorIds, state.filters.createdBy, uid => creatorNames[uid], persistAndRender);

  el.sortSelect.value = state.filters.sortBy;
  el.search.value = state.filters.search;

  const activeCount =
    state.filters.types.length +
    state.filters.categories.length +
    state.filters.priceRanges.length +
    state.filters.vibes.length +
    (state.filters.createdBy || []).length;
  el.filterToggle.textContent = activeCount > 0 ? `Filter (${activeCount}) ▾` : "Filter ▾";
  el.filterToggle.classList.toggle("filter-toggle-pill--active", activeCount > 0);
}

function computeRatingStats(ratings) {
  const byVenue = {};
  ratings.forEach(r => {
    if (!r.venueId || !r.stars) return;
    byVenue[r.venueId] = byVenue[r.venueId] || [];
    byVenue[r.venueId].push(r.stars);
  });
  const stats = {};
  Object.entries(byVenue).forEach(([venueId, starsArr]) => {
    const avg = starsArr.reduce((a, b) => a + b, 0) / starsArr.length;
    stats[venueId] = { avg, count: starsArr.length };
  });
  return stats;
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
  const ratingStats = state.ratingStats[v.id];

  const thumbHtml =
    v.photos && v.photos.length
      ? `<img class="venue-card__thumb" src="${v.photos[0]}" alt="" />`
      : `<div class="venue-card__thumb venue-card__thumb--placeholder venue-card__thumb--${v.type}">${TYPE_EMOJI[v.type] || "📍"}</div>`;

  const metaParts = [TYPE_LABELS[v.type], v.category || "—", PRICE_LABELS[v.priceRange]];
  if (ratingStats) metaParts.push(`⭐ ${ratingStats.avg.toFixed(1).replace(".", ",")} (${ratingStats.count})`);
  if (v.neighborhood) metaParts.push(v.neighborhood);
  if (dist !== undefined) metaParts.push(formatDistance(dist));

  card.innerHTML = `
    ${thumbHtml}
    <div class="venue-card__main">
      <div class="venue-card__top">
        <div class="venue-card__titles">
          <h3 class="venue-card__name">${v.name}</h3>
          <p class="venue-card__meta">${metaParts.join(" · ")}</p>
        </div>
        <button class="fav-btn ${isFav ? "fav-btn--active" : ""}" aria-label="Favorit" data-id="${v.id}">♥</button>
      </div>
      <p class="venue-card__hours">${v.openingHours ? `🕒 ${v.openingHours}` : ""}</p>
      <div class="venue-card__vibes">
        ${(v.vibes || []).slice(0, 3).map(vb => `<span class="vibe-tag">${vb}</span>`).join("")}
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
  if (state.venues.length === 0) return;

  const favActive = state.filters.favoritesOnly;
  const favTile = document.createElement("button");
  favTile.type = "button";
  favTile.className = `type-tile type-tile--favorites${favActive ? " type-tile--active" : ""}`;
  favTile.innerHTML = `
    <span class="type-tile__icon">⭐</span>
    <span class="type-tile__label">Favoriten</span>
  `;
  favTile.addEventListener("click", () => {
    state.filters.favoritesOnly = !state.filters.favoritesOnly;
    persistAndRender();
  });
  el.typeOverview.appendChild(favTile);

  TYPE_ORDER.forEach(type => {
    const active = state.filters.types.includes(type);
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = `type-tile type-tile--${type}${active ? " type-tile--active" : ""}`;
    tile.innerHTML = `
      <span class="type-tile__icon">${TYPE_EMOJI[type]}</span>
      <span class="type-tile__label">${TYPE_LABELS[type]}</span>
    `;
    tile.addEventListener("click", () => {
      toggleInArray(state.filters.types, type);
      persistAndRender();
    });
    el.typeOverview.appendChild(tile);
  });
}

function render() {
  const filtered = applyFilters(state.venues, state.filters, state.distances, state.favorites, state.ratingStats);
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
  el.locateBtn.title = "Suche…";
  try {
    const pos = await getCurrentPosition();
    state.userLocation = pos;
    state.distances = computeDistances();
    state.filters.sortBy = "distance";
    if (mapInitialized) setUserLocation(pos.lat, pos.lng, state.userProfiles[state.user?.uid]?.photoUrl);
    if (state.view === "map") panTo(pos.lat, pos.lng, 14);
    if (state.user) {
      updateUserProfile(state.user.uid, { lat: pos.lat, lng: pos.lng, locationUpdatedAt: Date.now() }).catch(
        err => console.warn("Standort konnte nicht geteilt werden", err)
      );
    }
    persistAndRender();
    el.locateBtn.title = "Standort aktualisieren";
  } catch (err) {
    el.locateBtn.title = "Standort nicht verfügbar";
    console.warn(err);
  } finally {
    el.locateBtn.disabled = false;
  }
}

function renderPeopleOnMap() {
  if (!mapInitialized) return;
  const people = Object.values(state.userProfiles)
    .filter(p => p.uid !== state.user?.uid && typeof p.lat === "number" && typeof p.lng === "number")
    .map(p => ({ lat: p.lat, lng: p.lng, photoUrl: p.photoUrl, name: p.displayName || "?" }));
  renderPeopleMarkers(people);
}

function setView(view, { immediate = false } = {}) {
  state.view = view;
  el.mapBtn.classList.toggle("dock-btn--on", view === "map");

  if (view === "map") {
    el.list.hidden = true;
    el.mapView.hidden = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.mapView.classList.add("map-view--open"));
    });
    if (!mapInitialized) {
      initMap("map");
      mapInitialized = true;
      if (state.userLocation) setUserLocation(state.userLocation.lat, state.userLocation.lng, state.userProfiles[state.user?.uid]?.photoUrl);
      renderPeopleOnMap();
    }
    invalidateMapSize();
  } else {
    el.mapView.classList.remove("map-view--open");
    if (immediate) {
      el.mapView.hidden = true;
      el.list.hidden = false;
    } else {
      setTimeout(() => {
        el.mapView.hidden = true;
        el.list.hidden = false;
      }, 320);
    }
  }
  render();
}

// ---- Detail sheet ----

function renderRatingStars(container, selected, onSelect) {
  container.innerHTML = "";
  for (let i = 1; i <= 5; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `rating-input__star${i <= selected ? " rating-input__star--active" : ""}`;
    btn.textContent = "★";
    btn.setAttribute("aria-label", `${i} Sterne`);
    btn.addEventListener("click", () => onSelect(i));
    container.appendChild(btn);
  }
}

function renderDetailRating(venue) {
  const stats = state.ratingStats[venue.id];
  el.detailRatingSummary.textContent = stats
    ? `⭐ ${stats.avg.toFixed(1).replace(".", ",")} · ${stats.count} ${stats.count === 1 ? "Bewertung" : "Bewertungen"}`
    : "Noch keine Bewertungen";

  const myRating = state.user ? state.ratings.find(r => r.venueId === venue.id && r.uid === state.user.uid) : null;

  renderRatingStars(el.detailRatingInput, myRating ? myRating.stars : 0, async stars => {
    if (!state.user) {
      openAccountSheet();
      return;
    }
    renderRatingStars(el.detailRatingInput, stars, () => {});
    try {
      await rateVenue(state.user.uid, venue.id, stars);
    } catch (err) {
      alert("Bewertung konnte nicht gespeichert werden: " + err.message);
    }
  });
}

function openSheet(backdrop) {
  backdrop.hidden = false;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => backdrop.classList.add("sheet-backdrop--open"));
  });
}

function closeSheet(backdrop, { immediate = false } = {}) {
  backdrop.classList.remove("sheet-backdrop--open");
  if (immediate) {
    backdrop.hidden = true;
    return;
  }
  setTimeout(() => {
    backdrop.hidden = true;
  }, 320);
}

function openDetail(id) {
  const v = state.venues.find(x => x.id === id);
  if (!v) return;

  currentDetailVenueId = id;
  renderDetailRating(v);

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

  if (v.createdBy) {
    const creatorName = state.userProfiles[v.createdBy]?.displayName || v.createdByName || "Unbekannt";
    tiles.push({ label: "Hinzugefügt von", value: creatorName });
  }

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

  openSheet(el.detailSheet);
  el.detailSheetInner.scrollTop = 0;
}

function closeDetail(opts) {
  closeSheet(el.detailSheet, opts);
  el.detailPhotos.innerHTML = "";
  currentDetailVenueId = null;
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

  openSheet(el.formSheet);
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

function closeForm(opts) {
  closeSheet(el.formSheet, opts);
  el.fPhotos.innerHTML = "";
  el.fPhotoUrlStatus.hidden = true;
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

async function handlePhotoUrlAdd() {
  const url = el.fPhotoUrl.value.trim();
  if (!url) return;
  el.fPhotoUrlStatus.hidden = false;
  el.fPhotoUrlStatus.textContent = "Lade Bild…";
  el.fPhotoUrlAdd.disabled = true;
  try {
    const base64 = await urlToCompressedBase64(url);
    formState.photos.push(base64);
    renderFormPhotos();
    el.fPhotoUrl.value = "";
    el.fPhotoUrlStatus.hidden = true;
  } catch (err) {
    el.fPhotoUrlStatus.textContent =
      "Bild konnte nicht geladen werden – manche Websites blockieren das Einbinden. Versuch eine andere Quelle (z.B. Wikipedia) oder lade das Foto herunter und füge es manuell hinzu.";
  } finally {
    el.fPhotoUrlAdd.disabled = false;
  }
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
    createdAt: existing ? existing.createdAt : Date.now(),
    createdBy: existing ? existing.createdBy || null : state.user?.uid || null,
    createdByName: existing ? existing.createdByName || null : state.user?.displayName || state.user?.email || null
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

async function handleAccountPhotoChange(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !state.user) return;
  el.accountPhotoStatus.hidden = false;
  el.accountPhotoStatus.textContent = "Bild wird hochgeladen…";
  try {
    const base64 = await fileToCompressedBase64(file);
    await updateUserProfile(state.user.uid, { photoUrl: base64 });
    el.accountPhotoStatus.textContent = "Profilbild aktualisiert.";
    setTimeout(() => {
      el.accountPhotoStatus.hidden = true;
    }, 1500);
  } catch (err) {
    el.accountPhotoStatus.textContent = "Bild konnte nicht gespeichert werden. Bitte erneut versuchen.";
  }
}

function openAccountSheet() {
  if (state.user) populateProfileEditFields();
  openSheet(el.accountSheet);
}

function closeAccountSheet(opts) {
  closeSheet(el.accountSheet, opts);
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
    const photoUrl = state.userProfiles[user.uid]?.photoUrl;
    const avatarHtml = photoUrl ? `<img class="avatar-img" src="${photoUrl}" alt="" />` : initial;
    el.accountName.textContent = name;
    el.accountEmail.textContent = user.email;
    el.accountAvatar.innerHTML = avatarHtml;
    el.accountBtn.innerHTML = avatarHtml;
    el.accountBtn.classList.add("account-btn--active");
  } else {
    el.accountLoggedOut.hidden = false;
    el.accountLoggedIn.hidden = true;
    el.accountBtn.innerHTML = '<img class="dock-icon" src="./icons/account.svg" alt="" />';
    el.accountBtn.classList.remove("account-btn--active");
  }
  renderHeaderPromilleBadge();
}

function openDrinkSheet() {
  if (!state.user) {
    openAccountSheet();
    return;
  }
  selectedDrinkType = null;
  el.drinkStepType.hidden = false;
  el.drinkStepVenue.hidden = true;
  el.drinkStepSuccess.hidden = true;
  el.drinkStatus.hidden = true;
  el.drinkVenueSearch.value = "";
  renderDrinkTypeGrid();
  openSheet(el.drinkSheet);
}

function closeDrinkSheet(opts) {
  closeSheet(el.drinkSheet, opts);
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
      if (venue) handleSaveDrink(venue, btn);
    });
  });
}

async function handleSaveDrink(venue, btnEl) {
  if (!state.user || !selectedDrinkType) return;
  el.drinkStatus.hidden = true;
  const buttons = el.drinkVenueList.querySelectorAll("button");
  buttons.forEach(b => (b.disabled = true));
  if (btnEl) btnEl.classList.add("drink-venue-item--loading");
  try {
    await addDrink({
      uid: state.user.uid,
      displayName: state.user.displayName || state.user.email,
      venueId: venue.id,
      venueName: venue.name,
      drinkType: selectedDrinkType
    });
    showDrinkSuccess(venue);
  } catch (err) {
    buttons.forEach(b => (b.disabled = false));
    if (btnEl) btnEl.classList.remove("drink-venue-item--loading");
    el.drinkStatus.hidden = false;
    el.drinkStatus.textContent = "Fehler beim Speichern. Bitte erneut versuchen.";
  }
}

function showDrinkSuccess(venue) {
  const type = DRINK_LOOKUP[selectedDrinkType];
  el.drinkStepVenue.hidden = true;
  el.drinkSuccessText.textContent = `${type.emoji} ${type.label} bei ${venue.name} eingetragen`;
  el.drinkStepSuccess.hidden = false;
  if (navigator.vibrate) navigator.vibrate(15);
  setTimeout(closeDrinkSheet, 1100);
}

const RANKING_EMPTY_MESSAGES = {
  "24h": "Noch keine Getränke in den letzten 24h eingetragen.",
  month: "Noch keine Getränke diesen Monat eingetragen.",
  all: "Noch keine Getränke eingetragen."
};

function isInTimeframe(createdAt, timeframe) {
  if (timeframe === "all") return true;
  if (timeframe === "24h") {
    return Date.now() - createdAt <= 24 * 60 * 60 * 1000;
  }
  const now = new Date();
  const d = new Date(createdAt);
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
  openSheet(el.rankingSheet);
}

function closeRankingSheet(opts) {
  closeSheet(el.rankingSheet, opts);
}

function calculateBac(drinks, profile, asOf = Date.now()) {
  const totalGrams = drinks.reduce((sum, d) => sum + (DRINK_ALCOHOL_GRAMS[d.drinkType] || 0), 0);
  if (totalGrams <= 0) return 0;
  const peakBac = totalGrams / (getUserWeight(profile) * getUserR(profile));
  const earliest = Math.min(...drinks.map(d => d.createdAt));
  const hoursElapsed = Math.max(0, (asOf - earliest) / 3600000);
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

const CHART_GRANULARITY_CONFIG = {
  month: { unit: "month", count: 12 },
  year: { unit: "year", count: 6 }
};
const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function addUnits(date, unit, n) {
  const d = new Date(date);
  if (unit === "day") d.setDate(d.getDate() + n);
  else if (unit === "week") d.setDate(d.getDate() + n * 7);
  else if (unit === "month") d.setMonth(d.getMonth() + n);
  else if (unit === "year") d.setFullYear(d.getFullYear() + n);
  return d;
}

function unitStart(date, unit) {
  if (unit === "day") return startOfDay(date);
  if (unit === "week") return mondayOfWeek(date);
  if (unit === "month") return new Date(date.getFullYear(), date.getMonth(), 1);
  return new Date(date.getFullYear(), 0, 1);
}

function getIntradaySeries(drinks, offset, profile) {
  // Zeigt den tatsächlichen Promilleverlauf (Anstieg + Abbau) über ein einzelnes rollierendes 24h-Fenster,
  // stündlich abgetastet, statt eines Trends über mehrere Tage.
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;
  const SAMPLES = 24;
  const windowEnd = Date.now() + offset * DAY_MS;
  const windowStart = windowEnd - DAY_MS;

  const series = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = windowStart + i * (DAY_MS / SAMPLES);
    const relevantDrinks = drinks.filter(d => d.createdAt <= t && d.createdAt >= t - DAY_MS);
    const bac = calculateBac(relevantDrinks, profile, t);
    series.push({ start: new Date(t), end: new Date(t), peak: bac });
  }
  return series;
}

function getWeekDaySeries(drinks, offset, profile) {
  // Immer genau 7 Punkte, einer pro Tag der (verschobenen) Woche, Montag bis Sonntag.
  const weekStart = addUnits(mondayOfWeek(Date.now()), "day", offset * 7);
  const series = [];
  for (let i = 0; i < 7; i++) {
    const dayStart = addUnits(weekStart, "day", i);
    const dayEnd = addUnits(dayStart, "day", 1);
    const dayDrinks = drinks.filter(d => d.createdAt >= dayStart.getTime() && d.createdAt < dayEnd.getTime());
    const peak = calculatePeakBacForDay(dayDrinks, profile);
    series.push({ start: dayStart, end: dayEnd, peak });
  }
  return series;
}

function getBacSeries(drinks, granularity, offset, profile) {
  if (granularity === "day") {
    return getIntradaySeries(drinks, offset, profile);
  }
  if (granularity === "week") {
    return getWeekDaySeries(drinks, offset, profile);
  }

  const { unit, count } = CHART_GRANULARITY_CONFIG[granularity];
  const currentBucketStart = unitStart(new Date(), unit);
  const latestBucketStart = addUnits(currentBucketStart, unit, offset * count);

  const series = [];
  for (let i = count - 1; i >= 0; i--) {
    const bucketStart = addUnits(latestBucketStart, unit, -i);
    const bucketEnd = addUnits(bucketStart, unit, 1);
    const bucketDrinks = drinks.filter(d => d.createdAt >= bucketStart.getTime() && d.createdAt < bucketEnd.getTime());
    const byDay = groupByDay(bucketDrinks);
    let peak = 0;
    Object.values(byDay).forEach(dayDrinks => {
      const p = calculatePeakBacForDay(dayDrinks, profile);
      if (p > peak) peak = p;
    });
    series.push({ start: bucketStart, end: bucketEnd, peak });
  }
  return series;
}

function buildChartLabels(series, granularity) {
  if (granularity === "week") {
    return series.map((s, i) => ({ index: i, label: WEEKDAY_LABELS[i] }));
  }
  const n = series.length;
  const maxLabels = 6;
  const step = Math.max(1, Math.ceil(n / maxLabels));
  const labels = [];
  series.forEach((s, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    let text;
    if (granularity === "day") {
      text = s.start.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    } else if (granularity === "month") {
      text = s.start.toLocaleDateString("de-DE", { month: "short" }).replace(".", "");
    } else if (granularity === "year") {
      text = String(s.start.getFullYear());
    } else {
      text = s.start.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
    }
    labels.push({ index: i, label: text });
  });
  return labels;
}

function formatTooltipLabel(point, index, granularity) {
  if (granularity === "week") {
    return `${WEEKDAY_LABELS[index]}, ${point.start.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}`;
  }
  if (granularity === "day") {
    return point.start.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  }
  if (granularity === "month") {
    return point.start.toLocaleDateString("de-DE", { month: "short", year: "numeric" }).replace(".", "");
  }
  if (granularity === "year") {
    return String(point.start.getFullYear());
  }
  return point.start.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatChartRangeLabel(series, granularity, offset) {
  if (granularity === "day") {
    if (offset === 0) return "Letzte 24h";
    const fmt = d => `${d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
    return `${fmt(series[0].start)} – ${fmt(series[series.length - 1].start)}`;
  }

  const first = series[0].start;
  const last = new Date(series[series.length - 1].end.getTime() - 1);
  const sameYear = first.getFullYear() === last.getFullYear();

  if (granularity === "year") {
    return sameYear ? String(first.getFullYear()) : `${first.getFullYear()} – ${last.getFullYear()}`;
  }
  if (granularity === "month") {
    const fmt = d => d.toLocaleDateString("de-DE", { month: "short" }).replace(".", "");
    return sameYear ? `${fmt(first)} – ${fmt(last)} ${last.getFullYear()}` : `${fmt(first)} ${first.getFullYear()} – ${fmt(last)} ${last.getFullYear()}`;
  }
  const fmt = d => d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  return sameYear ? `${fmt(first)} – ${fmt(last)} ${last.getFullYear()}` : `${fmt(first)} ${first.getFullYear()} – ${fmt(last)} ${last.getFullYear()}`;
}

function bacLevel(bac) {
  if (bac > 2.0) return "red";
  if (bac >= 1.0) return "yellow";
  return "green";
}

function bacColorClass(bac) {
  return `ranking-row--${bacLevel(bac)}`;
}

function computeMyLiveBac() {
  if (!state.user) return null;
  const myDrinksToday = state.drinks.filter(d => d.uid === state.user.uid && isInTimeframe(d.createdAt, "24h"));
  if (!myDrinksToday.length) return null;
  return calculateBac(myDrinksToday, state.userProfiles[state.user.uid]);
}

function renderHeaderPromilleBadge() {
  if (!state.user) {
    el.headerPromilleBadge.hidden = true;
    return;
  }
  const bac = computeMyLiveBac() ?? 0;
  el.headerPromilleValue.textContent = bac.toFixed(1).replace(".", ",");
  el.headerPromilleBadge.className = `promille-badge promille-badge--${bacLevel(bac)}`;
  el.headerPromilleBadge.hidden = false;
}

function updatePromilleCard() {
  if (rankingTimeframe !== "24h" || !state.user) {
    el.promilleCard.hidden = true;
    return;
  }
  const myDrinksToday = state.drinks.filter(d => d.uid === state.user.uid && isInTimeframe(d.createdAt, "24h"));
  if (!myDrinksToday.length) {
    el.promilleCard.hidden = true;
    return;
  }
  const bac = calculateBac(myDrinksToday, state.userProfiles[state.user.uid]);
  el.promilleValue.textContent = bac.toFixed(2).replace(".", ",") + "‰";
  el.promilleCard.hidden = false;
}

function buildPromilleChartHtml(series, granularity) {
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

  const showAllPoints = points.length <= 15;
  const circles = points
    .map((p, i) => {
      const isLast = i === points.length - 1;
      if (!isLast && !showAllPoints) return "";
      return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${isLast ? 5 : 3.5}" fill="${
        isLast ? "#0056b3" : "white"
      }" stroke="#0056b3" stroke-width="2" />`;
    })
    .join("");

  const svg = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="promille-chart__svg">
      <polygon points="${areaPoints}" fill="rgba(0,86,179,0.12)" />
      <polyline points="${linePoints}" fill="none" stroke="#0056b3" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      ${circles}
      <line class="promille-chart__cursor-line" x1="0" y1="0" x2="0" y2="${height}" />
      <circle class="promille-chart__cursor-dot" cx="0" cy="0" r="5" />
    </svg>`;

  const fmt = v => v.toFixed(1).replace(".", ",") + "‰";

  const labels = buildChartLabels(series, granularity);
  const monthsHtml = labels
    .map(l => `<span class="promille-chart__month" style="left:${n > 1 ? (l.index / (n - 1)) * 100 : 0}%">${l.label}</span>`)
    .join("");

  const html = `<div class="promille-chart">
    <div class="promille-chart__body">
      <div class="promille-chart__main">
        ${svg}
        <div class="promille-chart__tooltip" hidden></div>
      </div>
      <div class="promille-chart__months">${monthsHtml}</div>
    </div>
    <div class="promille-chart__axis">
      <span>${fmt(maxVal)}</span>
      <span>${fmt(maxVal / 2)}</span>
      <span>0‰</span>
    </div>
  </div>`;

  return { html, maxVal };
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

function renderProfileChart() {
  if (!state.user) return;
  const myDrinks = state.drinks.filter(d => d.uid === state.user.uid);
  const profile = state.userProfiles[state.user.uid];
  const series = getBacSeries(myDrinks, profileChartGranularity, profileChartOffset, profile);
  el.chartRangeLabel.textContent = formatChartRangeLabel(series, profileChartGranularity, profileChartOffset);
  const { html, maxVal } = buildPromilleChartHtml(series, profileChartGranularity);
  el.profileChart.innerHTML = html;
  currentChartSeries = series;
  currentChartMaxVal = maxVal;
  initChartInteraction();
}

function initChartInteraction() {
  const svg = el.profileChart.querySelector(".promille-chart__svg");
  const tooltip = el.profileChart.querySelector(".promille-chart__tooltip");
  const cursorLine = el.profileChart.querySelector(".promille-chart__cursor-line");
  const cursorDot = el.profileChart.querySelector(".promille-chart__cursor-dot");
  if (!svg || !currentChartSeries.length) return;

  const width = 300;
  const height = 120;
  const n = currentChartSeries.length;
  const stepX = n > 1 ? width / (n - 1) : width;

  function showAtClientX(clientX) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    let index = Math.round((ratio * width) / stepX);
    index = Math.min(n - 1, Math.max(0, index));
    const point = currentChartSeries[index];
    const x = index * stepX;
    const y = height - (point.peak / currentChartMaxVal) * (height - 10);

    cursorLine.setAttribute("x1", x);
    cursorLine.setAttribute("x2", x);
    cursorDot.setAttribute("cx", x);
    cursorDot.setAttribute("cy", y);
    cursorLine.classList.add("promille-chart__cursor-line--active");
    cursorDot.classList.add("promille-chart__cursor-dot--active");

    tooltip.hidden = false;
    tooltip.textContent = `${point.peak.toFixed(2).replace(".", ",")}‰ · ${formatTooltipLabel(point, index, profileChartGranularity)}`;
    const leftPct = n > 1 ? (index / (n - 1)) * 100 : 50;
    tooltip.style.left = `${leftPct}%`;
    tooltip.classList.toggle("promille-chart__tooltip--start", leftPct < 15);
    tooltip.classList.toggle("promille-chart__tooltip--end", leftPct > 85);
  }

  svg.addEventListener("pointerdown", e => {
    showAtClientX(e.clientX);
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener("pointermove", e => {
    if (e.buttons) showAtClientX(e.clientX);
  });
}

function renderProfileSheet() {
  if (!state.user) return;
  const name = state.user.displayName || state.user.email;
  const photoUrl = state.userProfiles[state.user.uid]?.photoUrl;
  el.profileName.textContent = name;
  el.profileAvatar.innerHTML = photoUrl ? `<img class="avatar-img" src="${photoUrl}" alt="" />` : name.charAt(0).toUpperCase();

  const myDrinks = state.drinks.filter(d => d.uid === state.user.uid);
  const profile = state.userProfiles[state.user.uid];

  renderProfileWeekStats(myDrinks, profile);
  renderProfileChart();
  renderProfileStreaks(myDrinks);
  renderProfileCalendar(myDrinks);
}

function openProfileSheet() {
  profileCalendarOffset = 0;
  profileChartOffset = 0;
  renderProfileSheet();
  openSheet(el.profileSheet);
}

function closeProfileSheet(opts) {
  closeSheet(el.profileSheet, opts);
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

  if (rankingTimeframe === "24h") {
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
  if (rankingTimeframe === "24h") return time;
  const date = d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  return `${date} · ${time}`;
}

function openPersonDrinksSheet(uid, name) {
  currentPersonDrinksUid = uid;
  currentPersonDrinksName = name;
  renderPersonDrinksSheet();
  openSheet(el.personDrinksSheet);
}

function renderPersonDrinksSheet() {
  if (!currentPersonDrinksUid) return;
  const personDrinks = state.drinks
    .filter(d => d.uid === currentPersonDrinksUid && isInTimeframe(d.createdAt, rankingTimeframe))
    .sort((a, b) => b.createdAt - a.createdAt);

  el.personDrinksName.textContent = currentPersonDrinksName;

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
      const canDelete = state.user && d.uid === state.user.uid;
      return `<div class="person-drinks-row">
        <span class="person-drinks-row__emoji">${type ? type.emoji : "🥤"}</span>
        <div class="person-drinks-row__text">
          <p class="person-drinks-row__type">${type ? type.label : d.drinkType}</p>
          <p class="person-drinks-row__venue">${d.venueName || ""}</p>
        </div>
        <span class="person-drinks-row__time">${formatDrinkTimestamp(d.createdAt)}</span>
        ${canDelete ? `<button type="button" class="person-drinks-row__delete" data-id="${d.id}" aria-label="Getränk entfernen">✕</button>` : ""}
      </div>`;
    })
    .join("");

  el.personDrinksList.querySelectorAll(".person-drinks-row__delete").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Getränk wirklich entfernen?")) return;
      btn.disabled = true;
      try {
        await deleteDrink(btn.dataset.id);
      } catch (err) {
        alert("Fehler beim Entfernen. Bitte erneut versuchen.");
        btn.disabled = false;
      }
    });
  });
}

function closePersonDrinksSheet(opts) {
  closeSheet(el.personDrinksSheet, opts);
  currentPersonDrinksUid = null;
  currentPersonDrinksName = null;
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
  el.fPhotoUrlAdd.addEventListener("click", handlePhotoUrlAdd);
  el.fPhotoUrl.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      handlePhotoUrlAdd();
    }
  });
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
  el.profileSheet.addEventListener("click", e => {
    if (e.target === el.profileSheet) closeProfileSheet();
  });
  el.chartGranularity.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      profileChartGranularity = btn.dataset.granularity;
      profileChartOffset = 0;
      el.chartGranularity.querySelectorAll("button").forEach(b => b.classList.toggle("chip--active", b === btn));
      renderProfileChart();
    });
  });
  el.chartPrev.addEventListener("click", () => {
    profileChartOffset -= 1;
    renderProfileChart();
  });
  el.chartNext.addEventListener("click", () => {
    profileChartOffset += 1;
    renderProfileChart();
  });
  el.profileSettingsBtn.addEventListener("click", () => {
    closeProfileSheet();
    openAccountSheet();
  });
  el.accountSheet.addEventListener("click", e => {
    if (e.target === el.accountSheet) closeAccountSheet();
  });
  el.authTabs.querySelectorAll("button").forEach(b => {
    b.addEventListener("click", () => setAuthMode(b.dataset.mode));
  });
  el.authForm.addEventListener("submit", handleAuthSubmit);
  el.accountLogout.addEventListener("click", () => logoutUser());
  el.profileSaveBtn.addEventListener("click", handleProfileSave);
  el.accountAvatarBtn.addEventListener("click", () => el.accountPhotoInput.click());
  el.accountPhotoInput.addEventListener("change", handleAccountPhotoChange);

  el.addDrinkBtn.addEventListener("click", openDrinkSheet);
  el.drinkSheet.addEventListener("click", e => {
    if (e.target === el.drinkSheet) closeDrinkSheet();
  });
  el.drinkBack.addEventListener("click", () => {
    el.drinkStepVenue.hidden = true;
    el.drinkStepType.hidden = false;
  });
  el.drinkVenueSearch.addEventListener("input", e => renderDrinkVenueList(e.target.value));

  el.socialBtn.addEventListener("click", openRankingSheet);
  el.rankingSheet.addEventListener("click", e => {
    if (e.target === el.rankingSheet) closeRankingSheet();
  });
  el.rankingFilter.querySelectorAll("button").forEach(b => {
    b.addEventListener("click", () => setRankingTimeframe(b.dataset.filter));
  });

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

const HEADER_SHRINK_RANGE = 130;
const HEADER_SHRINK_SMOOTHING = 0.16;
let headerShrinkCurrent = 0;

function headerShrinkTick() {
  const target = state.view === "map" ? 1 : Math.min(1, Math.max(0, window.scrollY / HEADER_SHRINK_RANGE));
  const diff = target - headerShrinkCurrent;
  headerShrinkCurrent = Math.abs(diff) < 0.0008 ? target : headerShrinkCurrent + diff * HEADER_SHRINK_SMOOTHING;
  el.appHeader.style.setProperty("--shrink", headerShrinkCurrent);
  requestAnimationFrame(headerShrinkTick);
}

function initHeaderShrink() {
  requestAnimationFrame(headerShrinkTick);
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

function attachDragToDismiss(handle, target, onDismiss, thresholdRatio = 0.22) {
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
    target.style.transition = "none";
  }

  function onMove(e) {
    if (!dragging) return;
    const delta = Math.max(0, pointY(e) - startY);
    dragY = delta;
    target.style.transform = `translateY(${delta}px)`;
    if (e.cancelable) e.preventDefault();
  }

  function onEnd() {
    if (!dragging) return;
    dragging = false;
    target.style.transition = "transform 0.35s var(--ease-liquid)";
    const threshold = target.offsetHeight * thresholdRatio;
    if (dragY > threshold) {
      target.style.transform = "translateY(100%)";
      setTimeout(() => {
        onDismiss();
        target.style.transition = "";
        target.style.transform = "";
      }, 320);
    } else {
      target.style.transform = "translateY(0)";
      setTimeout(() => {
        target.style.transition = "";
        target.style.transform = "";
      }, 350);
    }
    dragY = 0;
  }

  handle.addEventListener("touchstart", onStart, { passive: true });
  handle.addEventListener("touchmove", onMove, { passive: false });
  handle.addEventListener("touchend", onEnd);
  handle.addEventListener("mousedown", onStart);
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onEnd);
}

function initSheetDragToDismiss() {
  const closeFunctions = {
    "detail-sheet": closeDetail,
    "form-sheet": closeForm,
    "account-sheet": closeAccountSheet,
    "drink-sheet": closeDrinkSheet,
    "ranking-sheet": closeRankingSheet,
    "person-drinks-sheet": closePersonDrinksSheet,
    "profile-sheet": closeProfileSheet
  };

  document.querySelectorAll(".sheet-backdrop").forEach(backdrop => {
    const sheet = backdrop.querySelector(".sheet");
    const handle = backdrop.querySelector(".sheet__handle");
    const closeFn = closeFunctions[backdrop.id] || (() => (backdrop.hidden = true));
    if (!sheet || !handle) return;
    attachDragToDismiss(handle, sheet, () => closeFn({ immediate: true }));
  });
}

function initMapDragToDismiss() {
  if (!el.mapDragHandle || !el.mapView) return;
  attachDragToDismiss(el.mapDragHandle, el.mapView, () => setView("list", { immediate: true }), 0.18);
}

function findScrollParent(el) {
  while (el && el !== document.body) {
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) return el;
    el = el.parentElement;
  }
  return null;
}

function initPullToRefreshBlock() {
  // overscroll-behavior allein reicht auf manchen iOS-Versionen/Standalone-PWAs nicht aus,
  // um das native Pull-to-refresh zu unterdrücken - deshalb zusätzlich hart per Touch-Handler blocken.
  let startY = 0;
  let blockNext = false;

  document.addEventListener(
    "touchstart",
    e => {
      if (e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      const scrollParent = findScrollParent(e.target);
      const scrollTop = scrollParent ? scrollParent.scrollTop : window.scrollY;
      blockNext = scrollTop <= 0;
    },
    { passive: true }
  );

  document.addEventListener(
    "touchmove",
    e => {
      if (!blockNext) return;
      blockNext = false;
      if (e.touches[0].clientY - startY > 0 && e.cancelable) e.preventDefault();
    },
    { passive: false }
  );
}

function init() {
  initEvents();
  initHeaderShrink();
  initTypeOverviewSnap();
  initScrollLock();
  initSheetDragToDismiss();
  initMapDragToDismiss();
  initPullToRefreshBlock();
  onAuthChange(renderAccountUI);

  subscribeDrinks(drinks => {
    state.drinks = drinks;
    if (!el.rankingSheet.hidden) renderRanking();
    if (!el.profileSheet.hidden) renderProfileSheet();
    if (!el.personDrinksSheet.hidden) renderPersonDrinksSheet();
    renderHeaderPromilleBadge();
  });

  subscribeUserProfiles(profiles => {
    state.userProfiles = Object.fromEntries(profiles.map(p => [p.uid, p]));
    if (state.user) renderAccountUI(state.user);
    if (!el.rankingSheet.hidden) renderRanking();
    if (!el.profileSheet.hidden) renderProfileSheet();
    if (!el.accountSheet.hidden && state.user) populateProfileEditFields();
    renderHeaderPromilleBadge();
    renderPeopleOnMap();
  });

  setInterval(renderHeaderPromilleBadge, 60000);

  subscribeRatings(ratings => {
    state.ratings = ratings;
    state.ratingStats = computeRatingStats(ratings);
    render();
    if (!el.detailSheet.hidden && currentDetailVenueId) {
      const v = state.venues.find(x => x.id === currentDetailVenueId);
      if (v) renderDetailRating(v);
    }
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
      el.emptyGlobalIcon.textContent = "⚠️";
      el.emptyGlobalTitle.textContent = "Verbindung fehlgeschlagen";
      el.emptyGlobalSubtitle.textContent = "Verbindung zur Datenbank fehlgeschlagen. Bitte überprüfe deine Internetverbindung.";
      el.emptyGlobal.hidden = false;
    }
  );

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js", { updateViaCache: "none" })
        .catch(err => console.warn("SW-Registrierung fehlgeschlagen", err));
    });
  }
}

init();
