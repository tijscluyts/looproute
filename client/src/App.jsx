import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Polyline,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import { waypointIcon } from "./leafletIcons";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:5050")
  .replace(/\/+$/, "");

function geojsonToLatLngs(geojson) {
  const coords = geojson?.features?.[0]?.geometry?.coordinates;
  if (!coords) return [];
  return coords.map(([lng, lat]) => [lat, lng]);
}

const EUROPE_BOUNDS = [
  [34.5, -11.0],
  [71.5, 40.0],
];

function MapController({ pos, polyline }) {
  const map = useMap();

  useEffect(() => {
    if (!pos) return;
    map.flyTo([pos.lat, pos.lng], 15, { animate: true });
  }, [pos, map]);

  useEffect(() => {
    if (!polyline || polyline.length < 2) return;
    map.fitBounds(L.latLngBounds(polyline), { padding: [30, 30] });
  }, [polyline, map]);

  return null;
}

function MapClickHandler({ enabled, onSelect }) {
  const map = useMap();

  useEffect(() => {
    if (!enabled) return;

    function handleClick(e) {
      onSelect({ lat: e.latlng.lat, lng: e.latlng.lng });
    }

    map.on("click", handleClick);
    return () => map.off("click", handleClick);
  }, [enabled, onSelect, map]);

  return null;
}

export default function App() {
  const [pos, setPos] = useState(null);
  const [distanceKm, setDistanceKm] = useState(7);
  const [routeGeo, setRouteGeo] = useState(null);
  const [loading, setLoading] = useState(false);

  const [waypointMode, setWaypointMode] = useState(false);
  const [waypoints, setWaypoints] = useState([]);

  const polyline = useMemo(() => geojsonToLatLngs(routeGeo), [routeGeo]);

  function useMyLocation() {
    navigator.geolocation.getCurrentPosition((p) => {
      setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
    });
  }

  function toggleWaypointMode() {
    setWaypointMode((v) => !v);
  }

  function addWaypoint(p) {
    setWaypoints((prev) => [...prev, p]);
  }

  async function generateLoop() {
    if (!pos || loading) return;

    setLoading(true);
    setRouteGeo(null);

    try {
      const resp = await fetch(`${API_BASE}/api/loop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: pos.lat,
          lng: pos.lng,
          distanceKm,
          waypoints,
        }),
      });

      const data = await resp.json();
      setRouteGeo(data.geojson);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ height: "100vh", display: "grid", gridTemplateRows: "auto 1fr" }}>
      <div style={{ padding: 12, display: "flex", gap: 10 }}>
        <button onClick={useMyLocation}>Use my location</button>
        <button onClick={toggleWaypointMode}>
          Waypoints: {waypointMode ? "ON" : "OFF"}
        </button>
        <button onClick={generateLoop} disabled={loading}>
          Generate loop
        </button>
      </div>

      <MapContainer
        bounds={EUROPE_BOUNDS}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        <MapController pos={pos} polyline={polyline} />

        <MapClickHandler enabled={!waypointMode} onSelect={setPos} />
        <MapClickHandler enabled={waypointMode} onSelect={addWaypoint} />

        {pos && (
          <Marker position={[pos.lat, pos.lng]} icon={waypointIcon}>
            <Popup>Start</Popup>
          </Marker>
        )}

        {waypoints.map((wp, i) => (
          <Marker
            key={i}
            position={[wp.lat, wp.lng]}
            icon={waypointIcon}
          >
            <Popup>Waypoint {i + 1}</Popup>
          </Marker>
        ))}

        {polyline.length > 0 && <Polyline positions={polyline} />}
      </MapContainer>
    </div>
  );
}
