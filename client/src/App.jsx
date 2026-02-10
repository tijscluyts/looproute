import { useEffect, useMemo, useState, Fragment } from "react";
import "leaflet/dist/leaflet.css";

import waypointSvg from "./icons/waypoint.svg";
import startSvg from "./icons/waypoint.svg"; // reuse is fine


const StartIcon = L.icon({
  iconUrl: startSvg,
  iconSize: [34, 34],
  iconAnchor: [17, 34],
  popupAnchor: [0, -30],
});

const WaypointIcon = L.icon({
  iconUrl: waypointSvg,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  popupAnchor: [0, -24],
});

import {
  MapContainer,
  TileLayer,
  Polyline,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";

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
function MapController({ pos, polyline, fitAfterGenerate }) {
  const map = useMap();

  useEffect(() => {
    if (!pos) return;
    map.flyTo([pos.lat, pos.lng], 15, { animate: true, duration: 1.2 });
  }, [pos, map]);

  useEffect(() => {
    if (!fitAfterGenerate) return;
    if (!polyline || polyline.length < 2) return;

    map.fitBounds(L.latLngBounds(polyline), { padding: [30, 30] });
  }, [polyline, map, fitAfterGenerate]);

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
  rangeStartIdx,
  setRangeStartIdx,
  setLastBlockedRange,
}) {

  const map = useMap();

  if (!polyline || polyline.length < 2) return null;

  function findClosestSegmentIndex(e) {
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

    return bestIdx;
  }

  function toggleRange(startIdx, endIdx) {
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);

    setBlockedSegments((prev) => {
      const next = new Set(prev);

      // Decide action:
      // If every segment in range is already blocked -> unblock all.
      // Else -> block all.
      let allBlocked = true;
      for (let i = lo; i <= hi; i++) {
        if (!next.has(i)) {
          allBlocked = false;
          break;
        }
      }

      if (allBlocked) {
        for (let i = lo; i <= hi; i++) next.delete(i);
      } else {
        for (let i = lo; i <= hi; i++) next.add(i);
      }

      return next;
    });
  }

  function handleClickOnRoute(e) {
    if (!avoidMode) return;

    const idx = findClosestSegmentIndex(e);
    if (idx < 0) return;

    // First click: set start
    if (rangeStartIdx == null) {
      setRangeStartIdx(idx);
      return;
    }

    // Second click: toggle whole range, then reset start
    toggleRange(rangeStartIdx, idx);

    // ✅ remember the last selected range for backend reroute
    const start = Math.min(rangeStartIdx, idx);
    const end = Math.max(rangeStartIdx, idx);
    setLastBlockedRange({ startIdx: start, endIdx: end });

    setRangeStartIdx(null);

  }

  const lines = [];
  for (let i = 0; i < polyline.length - 1; i++) {
    const seg = [polyline[i], polyline[i + 1]];
    const isBlocked = blockedSegments.has(i);
    const isRangeStart = avoidMode && rangeStartIdx === i;

    lines.push(
      <Fragment key={`seg-${i}`}>
        <Polyline
          positions={seg}
          pathOptions={{
            color: isBlocked ? "red" : isRangeStart ? "orange" : "blue",
            weight: isBlocked ? 6 : isRangeStart ? 7 : 5,
            opacity: 0.9,
          }}
          eventHandlers={{ click: handleClickOnRoute }}
        />
      </Fragment>
    );
  }

  return <>{lines}</>;
}



function SegmentArrows({ segment, color }) {
  const map = useMap();

  useEffect(() => {
    if (!segment || segment.length < 2) return;

    const latLngs = segment.map(([lat, lng]) => L.latLng(lat, lng));

    

    
  }, [map, segment, color]);

  return null;
}
function RouteArrows({ polyline }) {
  const map = useMap();

  useEffect(() => {
    if (!polyline || polyline.length < 2) return;

    const arrows = [];

    for (let i = 0; i < polyline.length - 1; i += 8) {
      const [lat1, lng1] = polyline[i];
      const [lat2, lng2] = polyline[i + 1];

      const angle =
        (Math.atan2(lng2 - lng1, lat2 - lat1) * 180) / Math.PI;

      const icon = L.divIcon({
        className: "",
        html: `
          <div style="
            transform: rotate(${angle}deg);
            font-size: 18px;
            color: blue;
            line-height: 1;
          ">➤</div>
        `,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });

      const marker = L.marker([lat1, lng1], { icon }).addTo(map);
      arrows.push(marker);
    }

    return () => {
      arrows.forEach((m) => map.removeLayer(m));
    };
  }, [map, polyline]);

  return null;
}


export default function App() {
  const [fitAfterGenerate, setFitAfterGenerate] = useState(false);


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
  const [rangeStartIdx, setRangeStartIdx] = useState(null); // start segment index for range blocking
  const [lastBlockedRange, setLastBlockedRange] = useState(null);

  const polyline = useMemo(() => geojsonToLatLngs(routeGeo), [routeGeo]);

  useEffect(() => {
  if (!polyline || polyline.length < 2) return;

  let worst = { i: -1, d: 0, a: null, b: null };

  for (let i = 0; i < polyline.length - 1; i++) {
    const [lat1, lng1] = polyline[i];
    const [lat2, lng2] = polyline[i + 1];

    // rough distance (degrees) - enough to detect a crazy jump
    const d = Math.hypot(lat2 - lat1, lng2 - lng1);

    if (d > worst.d) worst = { i, d, a: polyline[i], b: polyline[i + 1] };
  }

  console.log("WORST JUMP", worst);
}, [polyline]);


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
    setRangeStartIdx(null);

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
    setRangeStartIdx(null);
    setLastBlockedRange(null);


    setFitAfterGenerate(true);

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
    setRangeStartIdx(null);

    setFitAfterGenerate(false);

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

        // ✅ NEW: tells backend exact blocked range indices
        blockedRange: lastBlockedRange,
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

        <MapController pos={pos} polyline={polyline} fitAfterGenerate={fitAfterGenerate} />

        {/* Map click behavior:
            - avoidMode ON: disabled
            - waypointMode ON: click adds waypoint
            - else: click sets start location
        */}
        <MapClickHandler enabled={mapClickEnabledForStart} onSelect={setPos} />
        <MapClickHandler enabled={mapClickEnabledForWaypoints} onSelect={addWaypoint} />

        {pos && (
          <Marker position={[pos.lat, pos.lng]} icon={StartIcon}>
            <Popup>Start location</Popup>
          </Marker>
        )}

        {waypoints.map((wp, i) => (
          <Marker key={`${wp.lat}-${wp.lng}-${i}`} position={[wp.lat, wp.lng]} icon={WaypointIcon}>
            <Popup>Waypoint #{i + 1}</Popup>
          </Marker>
        ))}

        <RouteSegments
          polyline={polyline}
          avoidMode={avoidMode}
          blockedSegments={blockedSegments}
          setBlockedSegments={setBlockedSegments}
          rangeStartIdx={rangeStartIdx}
          setRangeStartIdx={setRangeStartIdx}
          setLastBlockedRange={setLastBlockedRange}
        />



        <RouteArrows polyline={polyline} />

      </MapContainer>
    </div>
  );
}
