// Kuratierte Liste. Neue Locations hier einfach anhängen.
// type: 'bar' | 'cafe' | 'coffee'
// priceRange: 1 (€) bis 3 (€€€)
// vibes: freie Tags, tauchen automatisch im Filter auf

export const venues = [
  {
    id: "goldene-bar",
    name: "Goldene Bar",
    type: "bar",
    category: "Cocktailbar",
    priceRange: 2,
    vibes: ["stilvoll", "date-night", "drinnen & draußen"],
    neighborhood: "Lehel",
    address: "Prinzregentenstraße 1, 80538 München",
    lat: 48.1435,
    lng: 11.5865
  },
  {
    id: "zephyr",
    name: "Zephyr Bar",
    type: "bar",
    category: "Cocktailbar",
    priceRange: 3,
    vibes: ["elegant", "ruhig", "date-night"],
    neighborhood: "Maxvorstadt",
    address: "Baaderstraße 68, 80469 München",
    lat: 48.1301,
    lng: 11.5765
  },
  {
    id: "bar-briefing-room",
    name: "Bar Briefing Room",
    type: "bar",
    category: "Speakeasy",
    priceRange: 3,
    vibes: ["versteckt", "elegant", "date-night"],
    neighborhood: "Altstadt",
    address: "Herzog-Wilhelm-Straße 25, 80331 München",
    lat: 48.1367,
    lng: 11.5680
  },
  {
    id: "pusser-s",
    name: "Pusser's Bar",
    type: "bar",
    category: "Cocktailbar",
    priceRange: 2,
    vibes: ["klassisch", "gemütlich"],
    neighborhood: "Altstadt",
    address: "Falkenturmstraße 9, 80331 München",
    lat: 48.1372,
    lng: 11.5789
  },
  {
    id: "trader-vic-s",
    name: "Trader Vic's",
    type: "bar",
    category: "Tiki-Bar",
    priceRange: 3,
    vibes: ["ausgefallen", "laut", "gruppen"],
    neighborhood: "Altstadt",
    address: "Bayerstraße 10, 80335 München",
    lat: 48.1400,
    lng: 11.5650
  },
  {
    id: "holy-home",
    name: "Holy Home",
    type: "bar",
    category: "Rooftop",
    priceRange: 2,
    vibes: ["skyline", "sommer", "gruppen"],
    neighborhood: "Untergiesing",
    address: "Rosenheimer Straße 12, 81667 München",
    lat: 48.1280,
    lng: 11.5920
  },
  {
    id: "false-friends",
    name: "False Friends",
    type: "bar",
    category: "Cocktailbar",
    priceRange: 2,
    vibes: ["lässig", "kreativ"],
    neighborhood: "Glockenbachviertel",
    address: "Rumfordstraße 1, 80469 München",
    lat: 48.1300,
    lng: 11.5760
  },
  {
    id: "bar-centrale",
    name: "Bar Centrale",
    type: "bar",
    category: "Wein & Cocktails",
    priceRange: 2,
    vibes: ["italienisch", "gemütlich", "date-night"],
    neighborhood: "Glockenbachviertel",
    address: "Ledererstraße 23, 80331 München",
    lat: 48.1355,
    lng: 11.5800
  },
  {
    id: "milchbar",
    name: "Milchbar München",
    type: "bar",
    category: "Cocktailbar",
    priceRange: 2,
    vibes: ["lässig", "musik", "spät"],
    neighborhood: "Glockenbachviertel",
    address: "Hans-Sachs-Straße 19, 80469 München",
    lat: 48.1291,
    lng: 11.5722
  },
  {
    id: "the-victorian-house",
    name: "The Victorian House",
    type: "bar",
    category: "Cocktailbar",
    priceRange: 2,
    vibes: ["gemütlich", "musik", "spät"],
    neighborhood: "Glockenbachviertel",
    address: "Ickstattstraße 2a, 80469 München",
    lat: 48.1290,
    lng: 11.5750
  },
  {
    id: "man-static",
    name: "Man Static",
    type: "bar",
    category: "Cocktailbar",
    priceRange: 2,
    vibes: ["experimentell", "ruhig"],
    neighborhood: "Maxvorstadt",
    address: "Barer Straße 65, 80799 München",
    lat: 48.1520,
    lng: 11.5720
  },
  {
    id: "man-versant",
    name: "Man Versant",
    type: "bar",
    category: "Cocktailbar",
    priceRange: 2,
    vibes: ["gemütlich", "ruhig"],
    neighborhood: "Schwabing",
    address: "Occamstraße 8, 80802 München",
    lat: 48.1580,
    lng: 11.5860
  },
  {
    id: "cafe-luitpold",
    name: "Café Luitpold",
    type: "cafe",
    category: "Traditionscafé",
    priceRange: 2,
    vibes: ["elegant", "ruhig", "tagsüber"],
    neighborhood: "Altstadt",
    address: "Brienner Straße 11, 80333 München",
    lat: 48.1424,
    lng: 11.5730
  },
  {
    id: "man-versant-cafe",
    name: "Man versant Café",
    type: "cafe",
    category: "Specialty Coffee",
    priceRange: 2,
    vibes: ["ruhig", "arbeiten", "tagsüber"],
    neighborhood: "Schwabing",
    address: "Occamstraße 8, 80802 München",
    lat: 48.1580,
    lng: 11.5860
  },
  {
    id: "man-static-coffee",
    name: "Man Static Coffee",
    type: "coffee",
    category: "Specialty Coffee",
    priceRange: 1,
    vibes: ["lässig", "arbeiten", "tagsüber"],
    neighborhood: "Maxvorstadt",
    address: "Barer Straße 65, 80799 München",
    lat: 48.1520,
    lng: 11.5720
  },
  {
    id: "hatch",
    name: "The Hatch",
    type: "coffee",
    category: "Specialty Coffee",
    priceRange: 1,
    vibes: ["lässig", "arbeiten", "tagsüber"],
    neighborhood: "Glockenbachviertel",
    address: "Klenzestraße 35, 80469 München",
    lat: 48.1270,
    lng: 11.5760
  },
  {
    id: "kaffeefreunde",
    name: "Kaffeefreunde",
    type: "coffee",
    category: "Specialty Coffee",
    priceRange: 1,
    vibes: ["ruhig", "arbeiten", "tagsüber"],
    neighborhood: "Haidhausen",
    address: "Preysingstraße 1, 81667 München",
    lat: 48.1305,
    lng: 11.5960
  },
  {
    id: "sparkling-bar",
    name: "Sparkling Bar",
    type: "bar",
    category: "Champagnerbar",
    priceRange: 3,
    vibes: ["elegant", "date-night", "sommer"],
    neighborhood: "Altstadt",
    address: "Marienplatz 22, 80331 München",
    lat: 48.1372,
    lng: 11.5760
  }
];

export const allVibes = [...new Set(venues.flatMap(v => v.vibes))].sort();
export const allCategories = [...new Set(venues.map(v => v.category))].sort();
export const allNeighborhoods = [...new Set(venues.map(v => v.neighborhood))].sort();
