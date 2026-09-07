const FILTER_KEY = "muc-bars:filters";
const FAVORITES_KEY = "muc-bars:favorites";

export function loadFilters() {
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveFilters(filters) {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
  } catch {
    /* Speicher voll oder blockiert - Filter werden nur für diese Sitzung gehalten */
  }
}

export function loadFavorites() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

export function saveFavorites(favoriteSet) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favoriteSet]));
  } catch {
    /* ignorieren */
  }
}
