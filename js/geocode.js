const SHORT_LINK_HOSTS = ["maps.app.goo.gl", "goo.gl", "g.co"];

function isShortLink(url) {
  try {
    const host = new URL(url).hostname;
    return SHORT_LINK_HOSTS.some(h => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

// Versucht Koordinaten + Name/Adresse direkt aus einer Apple- oder Google-Maps-URL
// zu lesen, ohne einen Netzwerk-Request zu machen (Kurzlinks lassen sich vom Browser
// aus wegen CORS nicht auflösen - dafür bräuchte es einen eigenen Server).
export function parseMapLink(rawUrl) {
  const url = rawUrl.trim();
  if (!url) return null;

  if (isShortLink(url)) {
    return { shortLink: true, lat: null, lng: null, name: null, address: null };
  }

  let lat = null;
  let lng = null;
  let name = null;
  let address = null;

  try {
    const u = new URL(url);
    const params = u.searchParams;

    // Apple Maps: ll=, coordinate=, address=, q=, name=
    const ll = params.get("ll") || params.get("coordinate");
    if (ll && /-?\d+\.\d+,-?\d+\.\d+/.test(ll)) {
      const [a, b] = ll.split(",").map(Number);
      lat = a;
      lng = b;
    }
    if (params.get("address")) address = params.get("address");
    if (params.get("name")) name = params.get("name");

    // Google Maps: /@lat,lng,zoom/ im Pfad
    const atMatch = u.pathname.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (atMatch && lat === null) {
      lat = parseFloat(atMatch[1]);
      lng = parseFloat(atMatch[2]);
    }

    // Google Maps: /maps/place/Name/ im Pfad
    const placeMatch = u.pathname.match(/\/place\/([^/]+)/);
    if (placeMatch && !name) {
      name = decodeURIComponent(placeMatch[1].replace(/\+/g, " "));
    }

    // Google Maps: ?q=lat,lng oder ?q=Adresse
    const q = params.get("q");
    if (q) {
      if (/^-?\d+\.\d+,-?\d+\.\d+$/.test(q)) {
        if (lat === null) {
          const [a, b] = q.split(",").map(Number);
          lat = a;
          lng = b;
        }
      } else if (!address) {
        address = q;
      }
    }
  } catch {
    return null;
  }

  if (lat === null && !name && !address) return null;
  return { shortLink: false, lat, lng, name, address };
}

export async function geocodeAddress(query) {
  if (!query || !query.trim()) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Geocoding-Dienst nicht erreichbar");
  const results = await res.json();
  if (!results.length) return null;
  return {
    lat: parseFloat(results[0].lat),
    lng: parseFloat(results[0].lon),
    displayName: results[0].display_name
  };
}
