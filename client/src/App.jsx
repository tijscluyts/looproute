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
import "leaflet/dist/leaflet.css";
import L from "leaflet";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

// Fix default Leaflet marker icons for Vite / Vercel builds
delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});


const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:5050";

function geojsonToLatLngs(geojson) {
  const coords = geojson?.features?.[0]?.geometry?.coordinates;
  if (!coords) return [];
  return coords.map(([lng, lat]) => [lat, lng]);
}

// 1) Europe bounds
const EUROPE_BOUNDS = [
  [34.5, -11.0],
  [71.5, 40.0],
];

// Map camera controller
function MapController({ pos, polyline }) {
  const map = useMap();

  useEffect(() => {
    if (!pos) return;
    const target = [pos.lat, pos.lng];
    const zoom = 15;
    map.flyTo(target, zoom, { animate: true, duration: 1.2 });
  }, [pos, map]);

  useEffect(() => {
    if (!polyline || polyline.length < 2) return;
    const bounds = L.latLngBounds(polyline);
    map.fitBounds(bounds, { padding: [30, 30] });
  }, [polyline, map]);

  return null;
}

/**
 * Generic map click handler
 * - only active if enabled = true
 */
function MapClickHandler({ enabled, onSelect }) {
  const map = useMap();

  useEffect(() => {
    if (!enabled) return;

    function handleClick(e) {
      const { lat, lng } = e.latlng;
      onSelect({ lat, lng });
    }

    map.on("click", handleClick);
    return () => map.off("click", handleClick);
  }, [map, enabled, onSelect]);

  return null;
}

// -------------------- Avoid-road helpers --------------------

function dist2(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function pointToSegmentDist2(P, A, B) {
  const ABx = B[0] - A[0];
  const ABy = B[1] - A[1];
  const APx = P[0] - A[0];
  const APy = P[1] - A[1];

  const ab2 = ABx * ABx + ABy * ABy;
  if (ab2 === 0) return dist2(P, A);

  let t = (APx * ABx + APy * ABy) / ab2;
  t = Math.max(0, Math.min(1, t));

  const C = [A[0] + t * ABx, A[1] + t * ABy];
  return dist2(P, C);
}

/**
 * Render route as clickable segment polylines (blue or red).
 * Clicking toggles blocked segment index.
 */
function RouteSegments({
  polyline,
  avoidMode,
  blockedSegments,
  setBlockedSegments,
}) {
  const map = useMap();

  if (!polyline || polyline.length < 2) return null;

  function handleClickOnRoute(e) {
    if (!avoidMode) return;

    const P_ll = e.latlng;
    const P = map.latLngToLayerPoint(P_ll);

    let bestIdx = -1;
    let bestD2 = Infinity;

    for (let i = 0; i < polyline.length - 1; i++) {
      const A_ll = L.latLng(polyline[i][0], polyline[i][1]);
      const B_ll = L.latLng(polyline[i + 1][0], polyline[i + 1][1]);

      const A = map.latLngToLayerPoint(A_ll);
      const B = map.latLngToLayerPoint(B_ll);

      const d2 = pointToSegmentDist2([P.x, P.y], [A.x, A.y], [B.x, B.y]);
      if (d2 < bestD2) {
        bestD2 = d2;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      setBlockedSegments((prev) => {
        const next = new Set(prev);
        if (next.has(bestIdx)) next.delete(bestIdx);
        else next.add(bestIdx);
        return next;
      });
    }
  }

  const lines = [];
  for (let i = 0; i < polyline.length - 1; i++) {
    const seg = [polyline[i], polyline[i + 1]];
    const isBlocked = blockedSegments.has(i);

    lines.push(
      <Polyline
        key={`seg-${i}`}
        positions={seg}
        pathOptions={{
          color: isBlocked ? "red" : "blue",
          weight: isBlocked ? 6 : 5,
          opacity: 0.9,
        }}
        eventHandlers={{ click: handleClickOnRoute }}
      />
    );
  }

  return <>{lines}</>;
}

export default function App() {
  const [pos, setPos] = useState(null);
  const [distanceKm, setDistanceKm] = useState(7);
  const [preferLowOverlap, setPreferLowOverlap] = useState(true);

  const [routeGeo, setRouteGeo] = useState(null);
  const [distM, setDistM] = useState(null);
  const [overlap, setOverlap] = useState(null);
  const [attemptsTried, setAttemptsTried] = useState(null);
  const [loading, setLoading] = useState(false);

  // Waypoints
  const [waypointMode, setWaypointMode] = useState(false);
  const [waypoints, setWaypoints] = useState([]);

  // Avoid-road
  const [avoidMode, setAvoidMode] = useState(false);
  const [blockedSegments, setBlockedSegments] = useState(() => new Set());

  const polyline = useMemo(() => geojsonToLatLngs(routeGeo), [routeGeo]);

  function useMyLocation() {
    if (!navigator.geolocation) {
      alert("Geolocation not supported");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (err) => alert("Location error: " + err.message),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function toggleWaypointMode() {
    setWaypointMode((prev) => {
      const next = !prev;
      if (prev === true && next === false) setWaypoints([]);
      return next;
    });

    // avoid confusion: can't avoid roads while placing waypoints
    setAvoidMode(false);
  }

  function addWaypoint(p) {
    setWaypoints((prev) => [...prev, p]);
  }

  function toggleAvoidMode() {
    if (!routeGeo) return;
    setAvoidMode((prev) => !prev);

    // avoid confusion: can't place waypoints while avoiding roads
    setWaypointMode(false);
  }

  function clearBlocked() {
    setBlockedSegments(new Set());
  }

  function buildBlockedSegmentsPayload() {
    if (!polyline || polyline.length < 2) return [];
    return Array.from(blockedSegments).map((i) => ({
      a: { lat: polyline[i][0], lng: polyline[i][1] },
      b: { lat: polyline[i + 1][0], lng: polyline[i + 1][1] },
    }));
  }

  async function generateLoop() {
    if (loading) return;
    if (!pos) {
      alert("Use your location first");
      return;
    }

    setLoading(true);
    setRouteGeo(null);
    setDistM(null);
    setOverlap(null);
    setAttemptsTried(null);

    // new route -> reset avoid selections
    setAvoidMode(false);
    clearBlocked();

    try {
      const resp = await fetch(`${API_BASE}/api/loop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: pos.lat,
          lng: pos.lng,
          distanceKm: Number(distanceKm),
          preferLowOverlap,
          waypoints,
        }),
      });

      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt);
      }

      const data = await resp.json();
      setRouteGeo(data.geojson);
      setDistM(data.distM);
      setOverlap(data.overlap);
      setAttemptsTried(data.attemptsTried);
    } catch (e) {
      alert("Failed to generate route:\n" + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function rerouteAroundBlocked() {
    if (loading) return;
    if (!routeGeo || !pos) {
      alert("Generate a route first");
      return;
    }
    if (blockedSegments.size === 0) {
      alert("Block at least 1 segment (turn it red) first.");
      return;
    }

    setLoading(true);

    try {
      const blockedSegmentsPayload = buildBlockedSegmentsPayload();

      const resp = await fetch(`${API_BASE}/api/reroute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: pos.lat,
          lng: pos.lng,
          distanceKm: Number(distanceKm),
          waypoints,
          routeGeo,
          blockedSegments: blockedSegmentsPayload,
        }),
      });

      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt);
      }

      const data = await resp.json();
      setRouteGeo(data.geojson);
      setDistM(data.distM);
      setOverlap(data.overlap);
      setAttemptsTried(data.attemptsTried ?? 1);

      // after reroute: clear selection
      clearBlocked();
      setAvoidMode(false);
    } catch (e) {
      alert("Failed to reroute:\n" + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function downloadGpx() {
    if (!pos || !routeGeo) {
      alert("Generate a route first");
      return;
    }

    const resp = await fetch(`${API_BASE}/api/gpx/from-geojson`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        geojson: routeGeo,
        name: `Loop ${distanceKm} km`,
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      alert("GPX download failed:\n" + txt);
      return;
    }

    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `loop-${distanceKm}km.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const mapClickEnabledForStart = !avoidMode && !waypointMode;
  const mapClickEnabledForWaypoints = !avoidMode && waypointMode;

  return (
    <div style={{ height: "100vh", display: "grid", gridTemplateRows: "auto 1fr" }}>
      <div
        style={{
          padding: 12,
          display: "flex",
          gap: 12,
          alignItems: "center",
          borderBottom: "1px solid #ddd",
          flexWrap: "wrap",
        }}
      >
        <button onClick={useMyLocation}>Use my location</button>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Distance (km):
          <input
            type="number"
            min="1"
            max="50"
            step="0.5"
            value={distanceKm}
            onChange={(e) => setDistanceKm(e.target.value)}
            style={{ width: 80 }}
          />
        </label>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={preferLowOverlap}
            onChange={(e) => setPreferLowOverlap(e.target.checked)}
          />
          Avoid overlapping roads
        </label>

        <button
          onClick={toggleWaypointMode}
          style={{
            border: "1px solid #ccc",
            background: waypointMode ? "#eef" : "white",
          }}
        >
          {waypointMode ? "Waypoint mode: ON (click map)" : "Waypoint mode: OFF"}
        </button>

        <button
          onClick={toggleAvoidMode}
          disabled={!routeGeo}
          style={{
            border: "1px solid #ccc",
            background: avoidMode ? "#fee" : "white",
          }}
        >
          {avoidMode ? "Avoid-road mode: ON (click route)" : "Avoid-road mode: OFF"}
        </button>

        <button onClick={clearBlocked} disabled={!routeGeo || blockedSegments.size === 0}>
          Clear blocked roads
        </button>

        <button onClick={generateLoop} disabled={loading}>
          {loading ? "Working..." : "Generate loop"}
        </button>

        <button
          onClick={rerouteAroundBlocked}
          disabled={loading || !routeGeo || blockedSegments.size === 0}
        >
          Reroute around blocked roads
        </button>

        <button onClick={downloadGpx} disabled={!routeGeo}>
          Download GPX
        </button>

        <div style={{ marginLeft: "auto", display: "flex", gap: 16, fontWeight: "bold" }}>
          {distM != null && <div>{(distM / 1000).toFixed(2)} km</div>}
          {overlap != null && <div>Overlap: {(overlap * 100).toFixed(1)}%</div>}
          {attemptsTried != null && <div>Tries: {attemptsTried}</div>}
          {routeGeo && <div>Blocked: {blockedSegments.size}</div>}
        </div>
      </div>

      <MapContainer
        bounds={EUROPE_BOUNDS}
        boundsOptions={{ padding: [20, 20] }}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapController pos={pos} polyline={polyline} />

        {/* Map click behavior:
            - avoidMode ON: disabled
            - waypointMode ON: click adds waypoint
            - else: click sets start location
        */}
        <MapClickHandler enabled={mapClickEnabledForStart} onSelect={setPos} />
        <MapClickHandler enabled={mapClickEnabledForWaypoints} onSelect={addWaypoint} />

        {pos && (
          <Marker position={[pos.lat, pos.lng]}>
            <Popup>Start location</Popup>
          </Marker>
        )}

        {waypoints.map((wp, i) => (
          <Marker key={`${wp.lat}-${wp.lng}-${i}`} position={[wp.lat, wp.lng]}>
            <Popup>Waypoint #{i + 1}</Popup>
          </Marker>
        ))}

        <RouteSegments
          polyline={polyline}
          avoidMode={avoidMode}
          blockedSegments={blockedSegments}
          setBlockedSegments={setBlockedSegments}
        />
      </MapContainer>
    </div>
  );
}
