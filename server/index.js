// server/index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});


// -------------------- Helpers --------------------

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000; // m
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(a));
}

function lineDistanceM(coordsLngLat) {
  if (!coordsLngLat || coordsLngLat.length < 2) return null;
  let total = 0;
  for (let i = 1; i < coordsLngLat.length; i++) {
    const [lng1, lat1] = coordsLngLat[i - 1];
    const [lng2, lat2] = coordsLngLat[i];
    total += haversineM(lat1, lng1, lat2, lng2);
  }
  return total;
}

/**
 * Rough self-overlap estimator (metric)
 */
function overlapRatio(coordsLngLat, gridMeters = 20) {
  if (!coordsLngLat || coordsLngLat.length < 3) return 1;

  const seen = new Map();
  let overlapped = 0;
  let total = 0;

  const avgLat =
    coordsLngLat.reduce((s, c) => s + c[1], 0) / coordsLngLat.length;

  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos(toRad(avgLat));

  const snapLat = gridMeters / mPerDegLat;
  const snapLon = gridMeters / mPerDegLon;

  for (let i = 1; i < coordsLngLat.length; i++) {
    const [lng1, lat1] = coordsLngLat[i - 1];
    const [lng2, lat2] = coordsLngLat[i];

    const segLen = haversineM(lat1, lng1, lat2, lng2);
    total += segLen;

    const midLat = (lat1 + lat2) / 2;
    const midLng = (lng1 + lng2) / 2;

    const key =
      `${Math.round(midLat / snapLat)}:` + `${Math.round(midLng / snapLon)}`;

    const lastIdx = seen.get(key);
    if (lastIdx !== undefined && i - lastIdx > 12) {
      overlapped += segLen;
    } else if (lastIdx === undefined) {
      seen.set(key, i);
    }
  }

  return total > 0 ? overlapped / total : 1;
}

/**
 * Spur detector
 */
function hasShortOutAndBackSpur(coordsLngLat, maxDetourM = 140) {
  if (!coordsLngLat || coordsLngLat.length < 40) return false;

  const closeM = 12;
  const minSteps = 18;
  const maxSteps = 90;

  for (let i = 0; i < coordsLngLat.length - (minSteps + 1); i++) {
    const [lngA, latA] = coordsLngLat[i];
    let detour = 0;

    for (let j = i + 1; j < Math.min(coordsLngLat.length, i + maxSteps); j++) {
      const [lngPrev, latPrev] = coordsLngLat[j - 1];
      const [lngCur, latCur] = coordsLngLat[j];
      detour += haversineM(latPrev, lngPrev, latCur, lngCur);

      if (j - i >= minSteps) {
        const backClose = haversineM(latA, lngA, latCur, lngCur);
        if (backClose <= closeM && detour <= maxDetourM) return true;
      }

      if (detour > maxDetourM) break;
    }
  }

  return false;
}

function geojsonToGpx(geojson, name = "Loop route") {
  const coords = geojson?.features?.[0]?.geometry?.coordinates;
  if (!coords || coords.length === 0) {
    throw new Error("No coordinates to convert to GPX");
  }

  const trkpts = coords
    .map(([lng, lat]) => `<trkpt lat="${lat}" lon="${lng}"><ele>0</ele></trkpt>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx
  version="1.1"
  creator="LoopRoute"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1
  http://www.topografix.com/GPX/1/1/gpx.xsd">

  <metadata>
    <name>${name}</name>
  </metadata>

  <trk>
    <name>${name}</name>
    <trkseg>
      ${trkpts}
    </trkseg>
  </trk>

</gpx>`;
}

// -------------------- Waypoints + detour helpers --------------------

function normalizeWaypoints(waypoints) {
  if (!Array.isArray(waypoints)) return [];
  return waypoints
    .filter((w) => w && Number.isFinite(w.lat) && Number.isFinite(w.lng))
    .map((w) => ({ lat: Number(w.lat), lng: Number(w.lng) }));
}

function metersToDegLat(m) {
  return m / 111320;
}

function metersToDegLng(m, atLat) {
  return m / (111320 * Math.cos(toRad(atLat)));
}

function makeDetourWaypoint(start, wp, offsetMeters = 350) {
  const lat1 = Number(start.lat);
  const lng1 = Number(start.lng);
  const lat2 = Number(wp.lat);
  const lng2 = Number(wp.lng);

  const avgLat = (lat1 + lat2) / 2;
  const x = (lng2 - lng1) * (111320 * Math.cos(toRad(avgLat)));
  const y = (lat2 - lat1) * 111320;

  const len = Math.hypot(x, y);
  if (!Number.isFinite(len) || len < 50) {
    return { lat: lat2 + metersToDegLat(offsetMeters), lng: lng2 };
  }

  const nx = -y / len;
  const ny = x / len;
  const side = Math.random() < 0.5 ? -1 : 1;

  const dxM = nx * offsetMeters * side;
  const dyM = ny * offsetMeters * side;

  const detourLat = lat2 + metersToDegLat(dyM);
  const detourLng = lng2 + metersToDegLng(dxM, avgLat);

  return { lat: detourLat, lng: detourLng };
}

function buildDirectionsCoordinates({ startLat, startLng, waypoints }) {
  const coords = [];
  coords.push([startLng, startLat]);
  for (const wp of waypoints) coords.push([wp.lng, wp.lat]);
  coords.push([startLng, startLat]);
  return coords;
}

// -------------------- Avoid polygons from blocked segments --------------------

function segmentToRectanglePolygon(a, b, halfWidthMeters = 18) {
  const lat1 = Number(a.lat), lng1 = Number(a.lng);
  const lat2 = Number(b.lat), lng2 = Number(b.lng);

  const avgLat = (lat1 + lat2) / 2;

  const x = (lng2 - lng1) * (111320 * Math.cos(toRad(avgLat)));
  const y = (lat2 - lat1) * 111320;

  const len = Math.hypot(x, y);
  if (!Number.isFinite(len) || len < 2) return null;

  const nx = -y / len;
  const ny = x / len;

  const dxM = nx * halfWidthMeters;
  const dyM = ny * halfWidthMeters;

  const dLat = metersToDegLat(dyM);
  const dLng = metersToDegLng(dxM, avgLat);

  const p1 = [lng1 + dLng, lat1 + dLat];
  const p2 = [lng1 - dLng, lat1 - dLat];
  const p3 = [lng2 - dLng, lat2 - dLat];
  const p4 = [lng2 + dLng, lat2 + dLat];

  return [[p1, p2, p3, p4, p1]];
}

function buildAvoidPolygons(blockedSegments, halfWidthMeters = 18) {
  if (!Array.isArray(blockedSegments) || blockedSegments.length === 0) return null;

  const polygons = [];
  for (const seg of blockedSegments) {
    if (!seg?.a || !seg?.b) continue;
    if (!Number.isFinite(seg.a.lat) || !Number.isFinite(seg.a.lng)) continue;
    if (!Number.isFinite(seg.b.lat) || !Number.isFinite(seg.b.lng)) continue;

    const poly = segmentToRectanglePolygon(seg.a, seg.b, halfWidthMeters);
    if (poly) polygons.push(poly);
  }

  if (polygons.length === 0) return null;

  return {
    type: "MultiPolygon",
    coordinates: polygons,
  };
}

// -------------------- GeoJSON concat helpers --------------------

function getCoords(geojson) {
  return geojson?.features?.[0]?.geometry?.coordinates || [];
}

function makeLineStringGeoJson(coordsLngLat) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: coordsLngLat,
        },
      },
    ],
  };
}

function concatRoutesGeoJson(g1, g2) {
  const c1 = getCoords(g1);
  const c2 = getCoords(g2);

  if (c1.length === 0) return g2;
  if (c2.length === 0) return g1;

  const last1 = c1[c1.length - 1];
  const first2 = c2[0];

  const same =
    last1 &&
    first2 &&
    Math.abs(last1[0] - first2[0]) < 1e-6 &&
    Math.abs(last1[1] - first2[1]) < 1e-6;

  const merged = same ? [...c1, ...c2.slice(1)] : [...c1, ...c2];
  return makeLineStringGeoJson(merged);
}

// -------------------- Filler / anchor helpers --------------------

function farthestPointFromStart(coordsLngLat, startLat, startLng) {
  if (!coordsLngLat || coordsLngLat.length < 2) return null;

  let best = null;
  let bestD = -1;

  for (const [lng, lat] of coordsLngLat) {
    const d = haversineM(startLat, startLng, lat, lng);
    if (d > bestD) {
      bestD = d;
      best = { lat, lng, d };
    }
  }

  return best;
}

// -------------------- ORS calls --------------------

async function orsDirectionsGeoJson({
  apiKey,
  coordinates,
  profile = "foot-walking",
  options = undefined,
}) {
  const orsUrl = `https://api.openrouteservice.org/v2/directions/${profile}/geojson`;

  const body = { coordinates };
  if (options) body.options = options;

  const resp = await fetch(orsUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify(body),
  });

  if (resp.status === 429) {
    const text = await resp.text();
    const err = new Error("Rate limit exceeded");
    err.status = 429;
    err.details = text;
    throw err;
  }

  if (!resp.ok) {
    const text = await resp.text();
    const err = new Error("ORS request failed");
    err.status = resp.status;
    err.details = text;
    throw err;
  }

  return await resp.json();
}

async function orsRoundTripGeoJson({
  apiKey,
  startLat,
  startLng,
  lengthMeters,
  profile = "foot-walking",
  points = 6,
  seed = 1,
}) {
  const orsUrl = `https://api.openrouteservice.org/v2/directions/${profile}/geojson`;

  const resp = await fetch(orsUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({
      coordinates: [[startLng, startLat]],
      options: {
        round_trip: {
          length: Math.round(lengthMeters),
          points,
          seed,
        },
      },
    }),
  });

  if (resp.status === 429) {
    const text = await resp.text();
    const err = new Error("Rate limit exceeded");
    err.status = 429;
    err.details = text;
    throw err;
  }

  if (!resp.ok) {
    const text = await resp.text();
    const err = new Error("ORS round-trip request failed");
    err.status = resp.status;
    err.details = text;
    throw err;
  }

  return await resp.json();
}

// -------------------- Loop generation (round-trip + retry) --------------------

async function generateLoopGeoJson({ lat, lng, distanceKm, apiKey, avoidSpurs = true }) {
  const targetM = Number(distanceKm) * 1000;
  const attempts = 10;

  let best = null;

  for (let a = 0; a < attempts; a++) {
    const seed = Math.floor(Math.random() * 1_000_000);
    const points = a % 2 === 0 ? 6 : 8;

    const geojson = await orsRoundTripGeoJson({
      apiKey,
      startLat: lat,
      startLng: lng,
      lengthMeters: targetM,
      profile: "foot-walking",
      points,
      seed,
    });

    const coords = geojson?.features?.[0]?.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;

    const feat = geojson?.features?.[0];
    const distFromOrs =
      feat?.properties?.summary?.distance ??
      feat?.properties?.segments?.[0]?.distance ??
      null;

    const distM = distFromOrs ?? lineDistanceM(coords);
    if (distM == null || Number.isNaN(distM) || distM <= 0) continue;

    if (avoidSpurs && hasShortOutAndBackSpur(coords, 160)) continue;

    const distError = Math.abs(distM - targetM) / targetM;
    const ov = overlapRatio(coords, 20);

    const score = distError;

    const candidate = {
      geojson,
      distM,
      targetM,
      overlap: ov,
      distError,
      attemptsTried: a + 1,
      score,
    };

    if (!best || candidate.score < best.score) best = candidate;
    if (distError <= 0.03) return best;
  }

  return best;
}

async function bestFillerRoundTrip({ apiKey, startLat, startLng, lengthMeters, attempts = 8 }) {
  let best = null;

  for (let i = 0; i < attempts; i++) {
    const seed = Math.floor(Math.random() * 1_000_000);
    const points = i % 2 === 0 ? 6 : 8;

    const g = await orsRoundTripGeoJson({
      apiKey,
      startLat,
      startLng,
      lengthMeters,
      profile: "foot-walking",
      points,
      seed,
    });

    const coords = getCoords(g);
    if (!coords || coords.length < 2) continue;

    const dist = lineDistanceM(coords);
    if (!dist) continue;

    if (hasShortOutAndBackSpur(coords, 160)) continue;

    const ov = overlapRatio(coords, 20);
    const distErr = Math.abs(dist - lengthMeters) / lengthMeters;

    const score = ov * 1.0 + distErr * 0.2;

    const cand = { geojson: g, score };
    if (!best || cand.score < best.score) best = cand;
  }

  return best?.geojson || null;
}

// -------------------- Reroute helpers --------------------

function geojsonToCoordsLngLat(geojson) {
  return geojson?.features?.[0]?.geometry?.coordinates || [];
}

/**
 * Pick N evenly spaced points from coords array.
 * Returns [ [lng,lat], ... ]
 */
function sampleCoordsEvenly(coordsLngLat, n) {
  if (!coordsLngLat || coordsLngLat.length === 0) return [];
  if (n <= 0) return [];

  if (coordsLngLat.length <= n) return coordsLngLat;

  const result = [];
  const last = coordsLngLat.length - 1;

  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const idx = Math.round(t * last);
    result.push(coordsLngLat[idx]);
  }
  return result;
}

// -------------------- Routes --------------------

app.get("/api/health", (req, res) => res.json({ ok: true, build: "debug-1" }));

import { createRequire } from "module";
const require = createRequire(import.meta.url);

app.get("/api/_debug/info", (req, res) => {
  let expressVersion = null;
  try {
    expressVersion = require("express/package.json").version;
  } catch (e) {
    expressVersion = "unknown";
  }

  res.json({
    ok: true,
    expressVersion,
    has_app__router: Boolean(app._router),
    has_app_router: Boolean(app.router),
    app_keys_sample: Object.keys(app).slice(0, 30),
  });
});


app.get("/api/debug-key", (req, res) => {
  const key = process.env.ORS_API_KEY;
  res.json({
    hasKey: Boolean(key),
    keyLength: key ? key.length : 0,
    keyPreview: key ? `${key.slice(0, 6)}...${key.slice(-6)}` : null,
  });
});

// Generate loop (supports waypoints + filler to reach target distance)
app.post("/api/loop", async (req, res) => {
  try {
    const { lat, lng, distanceKm, avoidSpurs, waypoints } = req.body;

    if (!lat || !lng || !distanceKm) {
      return res.status(400).json({ error: "Missing lat/lng/distanceKm" });
    }

    const startLat = Number(lat);
    const startLng = Number(lng);
    const targetM = Number(distanceKm) * 1000;

    let wps = normalizeWaypoints(waypoints);

    // No waypoints -> random round trip
    if (wps.length === 0) {
      const result = await generateLoopGeoJson({
        lat: startLat,
        lng: startLng,
        distanceKm,
        apiKey: process.env.ORS_API_KEY,
        avoidSpurs: avoidSpurs !== false,
      });

      if (!result) {
        return res.status(502).json({
          error: "Failed to generate route",
          details:
            "No valid route returned by ORS round-trip (try again / check ORS key/quota).",
        });
      }

      return res.json({
        targetM: result.targetM,
        distM: result.distM,
        overlap: result.overlap,
        distError: result.distError,
        attemptsTried: result.attemptsTried,
        geojson: result.geojson,
      });
    }

    // 1 waypoint -> auto detour so it's a loop-ish triangle
    if (wps.length === 1) {
      const start = { lat: startLat, lng: startLng };
      const offset = Math.max(250, Math.min(900, targetM * 0.08));
      const detour = makeDetourWaypoint(start, wps[0], offset);
      wps = [wps[0], detour];
    }

    // Base directions route for waypoints
    const coordinates = buildDirectionsCoordinates({
      startLat,
      startLng,
      waypoints: wps,
    });

    let geojson = await orsDirectionsGeoJson({
      apiKey: process.env.ORS_API_KEY,
      coordinates,
      profile: "foot-walking",
    });

    let coordsLngLat = getCoords(geojson);
    let distM = lineDistanceM(coordsLngLat);

    // If too short -> add a filler loop away from start (anchor)
    if (distM != null && distM < targetM) {
      const missingM = targetM - distM;
      const fillerM = Math.max(1600, Math.round(missingM));

      const anchor = farthestPointFromStart(coordsLngLat, startLat, startLng);
      const minAnchorDist = 600;

      let anchorLat = startLat;
      let anchorLng = startLng;

      if (anchor && anchor.d >= minAnchorDist) {
        anchorLat = anchor.lat;
        anchorLng = anchor.lng;
      } else if (wps.length >= 1) {
        anchorLat = wps[0].lat;
        anchorLng = wps[0].lng;
      }

      const filler = await bestFillerRoundTrip({
        apiKey: process.env.ORS_API_KEY,
        startLat: anchorLat,
        startLng: anchorLng,
        lengthMeters: fillerM,
        attempts: 14,
      });

      if (filler) {
        geojson = concatRoutesGeoJson(geojson, filler);
        coordsLngLat = getCoords(geojson);
        distM = lineDistanceM(coordsLngLat);
      }
    }

    // Final metrics
    const finalOverlap = overlapRatio(coordsLngLat, 20);
    const distError = distM ? Math.abs(distM - targetM) / targetM : null;

    return res.json({
      targetM,
      distM,
      overlap: finalOverlap,
      distError,
      attemptsTried: 1,
      geojson,
    });
  } catch (err) {
    res.status(err?.status || 500).json({
      error: "Server error",
      details: err?.details || String(err),
    });
  }
});

// Reroute around blocked roads (keeps route shape, detours around avoid polygons)
app.post("/api/reroute", async (req, res) => {
  try {
    const { lat, lng, distanceKm, waypoints, routeGeo, blockedSegments } = req.body;

    if (!lat || !lng || !distanceKm || !routeGeo) {
      return res.status(400).json({ error: "Missing lat/lng/distanceKm/routeGeo" });
    }

    const startLat = Number(lat);
    const startLng = Number(lng);

    const avoidPolys = buildAvoidPolygons(blockedSegments, 18);
    if (!avoidPolys) {
      return res.status(400).json({ error: "No valid blockedSegments received" });
    }

    const options = { avoid_polygons: avoidPolys };
    const wps = normalizeWaypoints(waypoints);

    // Sample a few "shape points" from current route so reroute stays similar
    const baseCoords = geojsonToCoordsLngLat(routeGeo);
    const sampled = sampleCoordsEvenly(baseCoords, 7); // keep small to avoid ORS limits

    // Build coordinates: start -> sampled middle points -> user waypoints -> start
    const coordinates = [];
    coordinates.push([startLng, startLat]);

    // skip first+last from sampled (they're close to start in a loop)
    for (let i = 1; i < sampled.length - 1; i++) {
      coordinates.push(sampled[i]);
    }

    for (const wp of wps) {
      coordinates.push([wp.lng, wp.lat]);
    }

    coordinates.push([startLng, startLat]);

    const geojson = await orsDirectionsGeoJson({
      apiKey: process.env.ORS_API_KEY,
      coordinates,
      profile: "foot-walking",
      options,
    });

    const feat = geojson?.features?.[0];
    const coordsLngLat = feat?.geometry?.coordinates || [];

    const distFromOrs =
      feat?.properties?.summary?.distance ??
      feat?.properties?.segments?.[0]?.distance ??
      null;

    const distM = distFromOrs ?? lineDistanceM(coordsLngLat);
    const ov = overlapRatio(coordsLngLat, 20);

    return res.json({
      distM,
      overlap: ov,
      attemptsTried: 1,
      geojson,
    });
  } catch (err) {
    res.status(err?.status || 500).json({
      error: "Server error",
      details: err?.details || String(err),
    });
  }
});

// GPX from GeoJSON
app.post("/api/gpx/from-geojson", (req, res) => {
  try {
    const { geojson, name } = req.body;
    if (!geojson) return res.status(400).json({ error: "Missing geojson" });

    const gpx = geojsonToGpx(geojson, name || "Loop route");
    res.setHeader("Content-Type", "application/gpx+xml");
    res.setHeader("Content-Disposition", `attachment; filename="loop.gpx"`);
    res.send(gpx);
  } catch (err) {
    res.status(500).json({ error: "GPX generation failed", details: String(err) });
  }
});
app.get("/api/_debug/routes", (req, res) => {
  try {
    const stack = app._router?.stack || app.router?.stack;

    if (!Array.isArray(stack)) {
      return res.json({
        ok: false,
        reason: "No router stack found on app._router.stack or app.router.stack",
        has_app__router: Boolean(app._router),
        has_app_router: Boolean(app.router),
        stackType: typeof stack,
      });
    }

    const routes = [];
    for (const layer of stack) {
      const route = layer?.route;
      if (!route?.path) continue;

      routes.push({
        path: route.path,
        methods: Object.keys(route.methods || {}).filter(Boolean),
      });
    }

    res.json({ ok: true, count: routes.length, routes });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e), stack: e?.stack });
  }
});




// -------------------- Start server --------------------

const port = process.env.PORT || 5050;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
