import L from "leaflet";
import waypointSvg from "./icons/waypoint.svg";

export const waypointIcon = L.icon({
  iconUrl: waypointSvg,
  iconSize: [32, 48],
  iconAnchor: [16, 48],
  popupAnchor: [0, -48],
});
