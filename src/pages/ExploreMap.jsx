import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";

/**
 * Fix Leaflet marker icons in Vite (common gotcha)
 */
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

function FlyTo({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (!center) return;
    map.flyTo(center, zoom ?? map.getZoom(), { duration: 1.1 });
  }, [center, zoom, map]);
  return null;
}

/**
 * Categories + Overpass tag queries
 * We use Overpass around (lat,lon) to pull POIs.
 */
const CATEGORIES = [
  {
    key: "restaurants",
    label: "Restaurants",
    icon: "🍽️",
    overpass: [
      'node["amenity"="restaurant"]',
      'node["amenity"="cafe"]',
      'node["amenity"="bar"]',
      'node["amenity"="fast_food"]',
    ],
  },
  {
    key: "attractions",
    label: "Attractions",
    icon: "📍",
    overpass: [
      'node["tourism"="attraction"]',
      'node["tourism"="museum"]',
      'node["tourism"="gallery"]',
      'node["tourism"="zoo"]',
      'node["tourism"="theme_park"]',
      'node["tourism"="viewpoint"]',
      'node["historic"]',
      'node["leisure"="park"]',
    ],
  },
  {
    key: "hotels",
    label: "Hotels",
    icon: "🏨",
    overpass: [
      'node["tourism"="hotel"]',
      'node["tourism"="hostel"]',
      'node["tourism"="guest_house"]',
      'node["tourism"="motel"]',
    ],
  },
  {
    key: "safety",
    label: "Safety Info",
    icon: "🛡️",
    overpass: [
      'node["amenity"="police"]',
      'node["amenity"="hospital"]',
      'node["amenity"="clinic"]',
      'node["amenity"="pharmacy"]',
      'node["amenity"="fire_station"]',
    ],
  },
  {
    key: "transport",
    label: "Transport",
    icon: "🚆",
    overpass: [
      'node["railway"="station"]',
      'node["railway"="subway_entrance"]',
      'node["public_transport"="station"]',
      'node["amenity"="bus_station"]',
      'node["aeroway"="aerodrome"]',
    ],
  },
];

/**
 * Hidden gems = niche/less obvious POIs
 */
const HIDDEN_GEMS = {
  key: "gems",
  label: "Hidden Gems",
  icon: "✨",
  overpass: [
    'node["tourism"="artwork"]',
    'node["tourism"="information"]["information"="board"]',
    'node["amenity"="library"]',
    'node["amenity"="community_centre"]',
    'node["leisure"="garden"]',
    'node["leisure"="escape_game"]',
    'node["amenity"="arts_centre"]',
    'node["amenity"="studio"]',
    'node["shop"="antique"]',
    'node["shop"="vintage"]',
    'node["shop"="second_hand"]',
    'node["craft"]',
    'node["amenity"="music_venue"]',
    'node["amenity"="theatre"]',
  ],
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function haversineKm(a, b) {
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function fetchOverpass({ lat, lon, radiusM, selectors }) {
  const around = `(around:${radiusM},${lat},${lon})`;
  const body = `
    [out:json][timeout:25];
    (
      ${selectors.map((s) => `${s}${around};`).join("\n")}
    );
    out body 80;
  `.trim();

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Overpass error: ${res.status} ${txt.slice(0, 180)}`);
  }

  const json = await res.json();
  return json.elements || [];
}

async function geocode(q) {
  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({
      q,
      format: "json",
      addressdetails: "1",
      limit: "1",
    }).toString();

  const res = await fetch(url, {
    headers: {
      "Accept-Language": "en",
    },
  });

  if (!res.ok) throw new Error(`Geocode failed (${res.status})`);
  const data = await res.json();
  return data?.[0] || null;
}

const styles = {
  shell: (dark) => ({
    minHeight: "100vh",
    padding: "24px",
    background: dark
      ? "radial-gradient(1000px 600px at 30% 10%, rgba(140,80,255,0.25), transparent 60%), radial-gradient(900px 500px at 80% 20%, rgba(0,200,255,0.18), transparent 60%), #0b0b12"
      : "radial-gradient(900px 600px at 25% 10%, rgba(140,80,255,0.18), transparent 60%), radial-gradient(900px 500px at 80% 20%, rgba(0,200,255,0.12), transparent 60%), #f7f7ff",
    color: dark ? "#eef" : "#111",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial',
  }),
  card: (dark) => ({
    background: dark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.8)",
    border: dark
      ? "1px solid rgba(255,255,255,0.10)"
      : "1px solid rgba(20,20,40,0.10)",
    boxShadow: dark
      ? "0 20px 80px rgba(0,0,0,0.45), 0 0 0 1px rgba(150,110,255,0.10) inset"
      : "0 20px 80px rgba(25,25,70,0.12), 0 0 0 1px rgba(140,80,255,0.08) inset",
    borderRadius: 18,
    backdropFilter: "blur(12px)",
  }),
  pill: (dark, active) => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "12px 14px",
    borderRadius: 14,
    border: active
      ? "1px solid rgba(140,80,255,0.65)"
      : dark
        ? "1px solid rgba(255,255,255,0.10)"
        : "1px solid rgba(20,20,40,0.10)",
    background: active
      ? dark
        ? "linear-gradient(90deg, rgba(140,80,255,0.28), rgba(0,200,255,0.12))"
        : "linear-gradient(90deg, rgba(140,80,255,0.14), rgba(0,200,255,0.10))"
      : dark
        ? "rgba(255,255,255,0.05)"
        : "rgba(255,255,255,0.75)",
    cursor: "pointer",
    transition: "transform 0.08s ease, border-color 0.2s ease",
    userSelect: "none",
  }),
  input: (dark) => ({
    width: "100%",
    padding: "12px 14px",
    borderRadius: 14,
    border: dark
      ? "1px solid rgba(255,255,255,0.12)"
      : "1px solid rgba(20,20,40,0.12)",
    background: dark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.85)",
    color: dark ? "#eef" : "#111",
    outline: "none",
  }),
  button: (dark) => ({
    padding: "10px 12px",
    borderRadius: 14,
    border: dark
      ? "1px solid rgba(255,255,255,0.12)"
      : "1px solid rgba(20,20,40,0.12)",
    background: dark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.9)",
    color: dark ? "#eef" : "#111",
    cursor: "pointer",
  }),
};

export default function ExploreMap() {
  const [dark, setDark] = useState(() => {
    const v = localStorage.getItem("wm_theme");
    return v ? v === "dark" : true;
  });

  useEffect(() => {
    localStorage.setItem("wm_theme", dark ? "dark" : "light");
  }, [dark]);

  const [query, setQuery] = useState("Paris, France");
  const [center, setCenter] = useState({ lat: 48.8566, lng: 2.3522 });
  const [zoom, setZoom] = useState(12);

  const [activeCat, setActiveCat] = useState("restaurants");
  const [useGems, setUseGems] = useState(true);

  const [radiusKm, setRadiusKm] = useState(6);
  const [places, setPlaces] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const markerRefs = useRef(new Map());

  const category = useMemo(() => {
    const base = CATEGORIES.find((c) => c.key === activeCat) || CATEGORIES[0];
    return base;
  }, [activeCat]);

  const effectiveSelectors = useMemo(() => {
    const selectors = [...category.overpass];
    if (useGems) selectors.push(...HIDDEN_GEMS.overpass);
    return selectors;
  }, [category, useGems]);

  async function runSearch() {
    setLoading(true);
    setStatus("Searching location…");
    setSelectedId(null);
    setPlaces([]);

    try {
      const geo = await geocode(query);
      if (!geo) {
        setStatus("No results. Try: City, State, Country");
        setLoading(false);
        return;
      }

      const lat = parseFloat(geo.lat);
      const lon = parseFloat(geo.lon);
      const nextCenter = { lat, lng: lon };
      setCenter(nextCenter);
      setZoom(12);

      setStatus("Finding places…");
      const elements = await fetchOverpass({
        lat,
        lon,
        radiusM: Math.round(radiusKm * 1000),
        selectors: effectiveSelectors,
      });

      const unique = new Map();
      for (const el of elements) {
        if (!el?.lat || !el?.lon) continue;
        const name =
          el.tags?.name ||
          el.tags?.["name:en"] ||
          el.tags?.brand ||
          el.tags?.amenity ||
          el.tags?.tourism ||
          el.tags?.shop ||
          el.tags?.leisure ||
          "Unknown Place";

        const isSafetyOrTransport =
          el.tags?.amenity === "police" ||
          el.tags?.amenity === "hospital" ||
          el.tags?.amenity === "clinic" ||
          el.tags?.amenity === "pharmacy" ||
          el.tags?.amenity === "fire_station" ||
          el.tags?.railway ||
          el.tags?.public_transport ||
          el.tags?.aeroway;

        if (!el.tags?.name && !isSafetyOrTransport) continue;

        const id = `${el.type}:${el.id}`;
        if (unique.has(id)) continue;

        const kind =
          el.tags?.amenity ||
          el.tags?.tourism ||
          el.tags?.shop ||
          el.tags?.leisure ||
          el.tags?.railway ||
          el.tags?.public_transport ||
          el.tags?.historic ||
          "place";

        const addrParts = [
          el.tags?.["addr:housenumber"],
          el.tags?.["addr:street"],
          el.tags?.["addr:city"],
          el.tags?.["addr:postcode"],
          el.tags?.["addr:country"],
        ].filter(Boolean);

        const address =
          addrParts.join(" ") ||
          el.tags?.["addr:full"] ||
          el.tags?.["contact:street"] ||
          "";

        const dist = haversineKm(nextCenter, { lat: el.lat, lng: el.lon });
        const hasWebsite = !!(el.tags?.website || el.tags?.["contact:website"]);
        const hasPhone = !!(el.tags?.phone || el.tags?.["contact:phone"]);
        const hasOpening = !!el.tags?.opening_hours;
        const rating = clamp(
          3.6 +
            (hasWebsite ? 0.3 : 0) +
            (hasPhone ? 0.15 : 0) +
            (hasOpening ? 0.15 : 0) -
            dist * 0.02,
          3.6,
          4.9
        );

        unique.set(id, {
          id,
          name: String(name),
          kind: String(kind),
          lat: el.lat,
          lon: el.lon,
          address,
          distanceKm: dist,
          rating: Number(rating.toFixed(1)),
          description:
            el.tags?.description ||
            el.tags?.tourism ||
            el.tags?.amenity ||
            el.tags?.shop ||
            el.tags?.leisure ||
            el.tags?.historic ||
            "Point of interest",
          tags: el.tags || {},
        });
      }

      const list = Array.from(unique.values())
        .sort((a, b) => b.rating - a.rating || a.distanceKm - b.distanceKm)
        .slice(0, 30);

      setPlaces(list);
      setStatus(list.length ? `Found ${list.length} places` : "No places found in this radius.");
    } catch (e) {
      setStatus(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function focusPlace(p) {
    setSelectedId(p.id);
    const ref = markerRefs.current.get(p.id);
    if (ref) ref.openPopup();
    setCenter({ lat: p.lat, lng: p.lon });
    setZoom(14);
  }

  return (
    <div style={styles.shell(dark)}>
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "1.55fr 1fr",
          gap: 18,
          alignItems: "start",
        }}
      >
        <div style={{ ...styles.card(dark), padding: 12 }}>
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 10px 12px",
            }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "center", width: "100%" }}>
              <input
                style={styles.input(dark)}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="City, State/Province, Country (e.g., Toronto, ON, Canada)"
                onKeyDown={(e) => {
                  if (e.key === "Enter") runSearch();
                }}
              />
              <button style={styles.button(dark)} onClick={runSearch} disabled={loading}>
                {loading ? "…" : "Search"}
              </button>
            </div>

            <button
              style={{
                ...styles.button(dark),
                marginLeft: 10,
                display: "flex",
                gap: 8,
                alignItems: "center",
              }}
              onClick={() => setDark((v) => !v)}
              title="Toggle theme"
            >
              {dark ? "🌙" : "☀️"} {dark ? "Dark" : "Light"}
            </button>
          </div>

          <div
            style={{
              height: 520,
              borderRadius: 14,
              overflow: "hidden",
              border: dark ? "1px solid rgba(255,255,255,0.10)" : "1px solid rgba(20,20,40,0.10)",
            }}
          >
            <MapContainer center={center} zoom={zoom} style={{ width: "100%", height: "100%" }} scrollWheelZoom>
              <FlyTo center={center} zoom={zoom} />

              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url={
                  dark
                    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                    : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                }
              />

              {places.map((p) => (
                <Marker
                  key={p.id}
                  position={[p.lat, p.lon]}
                  ref={(ref) => {
                    if (ref) markerRefs.current.set(p.id, ref);
                  }}
                  eventHandlers={{
                    click: () => setSelectedId(p.id),
                  }}
                >
                  <Popup>
                    <div style={{ minWidth: 220 }}>
                      <div style={{ fontWeight: 800, marginBottom: 4 }}>{p.name}</div>
                      <div style={{ opacity: 0.8, fontSize: 13, marginBottom: 8 }}>{p.description}</div>
                      <div style={{ fontSize: 13, opacity: 0.9 }}>
                        ⭐ {p.rating} · {p.distanceKm.toFixed(1)} km away
                      </div>
                      {p.address ? (
                        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>{p.address}</div>
                      ) : null}
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ ...styles.card(dark), padding: 14 }}>
            <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 12 }}>Explore Nearby</div>

            <div style={{ display: "grid", gap: 10 }}>
              {CATEGORIES.map((c) => {
                const active = c.key === activeCat;
                return (
                  <div key={c.key} style={styles.pill(dark, active)} onClick={() => setActiveCat(c.key)}>
                    <span style={{ fontSize: 18 }}>{c.icon}</span>
                    <span style={{ fontWeight: 700 }}>{c.label}</span>
                  </div>
                );
              })}
            </div>

            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 14,
                paddingTop: 14,
                borderTop: dark ? "1px solid rgba(255,255,255,0.10)" : "1px solid rgba(20,20,40,0.10)",
              }}
            >
              <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input type="checkbox" checked={useGems} onChange={(e) => setUseGems(e.target.checked)} />
                <span style={{ fontWeight: 700 }}>{HIDDEN_GEMS.icon} Include Hidden Gems</span>
              </label>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ opacity: 0.75, fontSize: 12 }}>Radius</span>
                <input type="range" min={2} max={20} value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} />
                <span style={{ width: 44, textAlign: "right", fontWeight: 700 }}>{radiusKm}km</span>
              </div>
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
              <button style={styles.button(dark)} onClick={runSearch} disabled={loading}>
                Refresh results
              </button>
              <div style={{ opacity: 0.75, alignSelf: "center", fontSize: 13 }}>{status}</div>
            </div>
          </div>

          <div style={{ ...styles.card(dark), padding: 14 }}>
            <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 10 }}>
              {places.length ? `Found ${places.length} places` : "Results"}
            </div>

            <div style={{ maxHeight: 420, overflow: "auto", display: "grid", gap: 10, paddingRight: 6 }}>
              {places.map((p) => {
                const active = p.id === selectedId;
                return (
                  <div
                    key={p.id}
                    onClick={() => focusPlace(p)}
                    style={{
                      padding: 12,
                      borderRadius: 14,
                      cursor: "pointer",
                      border: active
                        ? "1px solid rgba(140,80,255,0.7)"
                        : dark
                          ? "1px solid rgba(255,255,255,0.10)"
                          : "1px solid rgba(20,20,40,0.10)",
                      background: active
                        ? dark
                          ? "linear-gradient(90deg, rgba(140,80,255,0.25), rgba(0,200,255,0.10))"
                          : "linear-gradient(90deg, rgba(140,80,255,0.12), rgba(0,200,255,0.08))"
                        : dark
                          ? "rgba(255,255,255,0.04)"
                          : "rgba(255,255,255,0.85)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ fontWeight: 900 }}>{p.name}</div>
                      <div style={{ fontWeight: 800, opacity: 0.9 }}>⭐ {p.rating}</div>
                    </div>

                    <div style={{ opacity: 0.8, marginTop: 6, fontSize: 13 }}>
                      {prettyType(p.kind)} • {p.distanceKm.toFixed(1)} km away
                    </div>

                    {p.address ? (
                      <div style={{ opacity: 0.7, marginTop: 6, fontSize: 12 }}>{p.address}</div>
                    ) : null}
                  </div>
                );
              })}

              {!places.length && (
                <div style={{ opacity: 0.75, fontSize: 13, padding: 10 }}>
                  Try searching another city (e.g., “Toronto, Ontario, Canada”) and hit Search.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "14px auto 0", opacity: 0.65, fontSize: 12 }}>
        Data: OpenStreetMap via Overpass API • Geocoding: Nominatim • Map: Leaflet
      </div>

      <AutoRefresh deps={[activeCat, useGems, radiusKm]} onRefresh={runSearch} />
    </div>
  );
}

function AutoRefresh({ deps, onRefresh }) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => onRefresh(), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return null;
}

function prettyType(kind) {
  const k = String(kind).replaceAll("_", " ");
  return k.charAt(0).toUpperCase() + k.slice(1);
}
