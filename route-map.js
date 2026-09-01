(function () {
  "use strict";

  const mapElement = document.getElementById("route-map-interactive");
  const statusElement = document.getElementById("route-map-status");
  if (!mapElement || !statusElement) return;

  const showStatus = (message, isError = false) => {
    statusElement.textContent = message;
    statusElement.classList.toggle("route-map-status--error", isError);
  };

  if (!window.L) {
    showStatus("The interactive map could not load. The route description and GPX download remain available below.", true);
    return;
  }

  const map = window.L.map(mapElement, {
    keyboard: true,
    scrollWheelZoom: false,
    zoomControl: true,
  });
  const tiles = window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  });
  let tileFailures = 0;
  tiles.on("tileerror", () => {
    tileFailures += 1;
    if (tileFailures === 1) {
      showStatus("Some background map tiles are unavailable. The route line, route description and GPX download remain available.", true);
    }
  });
  tiles.addTo(map);

  fetch("downloads/blorenge-fell-race-2026.gpx")
    .then((response) => {
      if (!response.ok) throw new Error(`GPX request returned ${response.status}`);
      return response.text();
    })
    .then((text) => {
      const documentXml = new DOMParser().parseFromString(text, "application/xml");
      if (documentXml.querySelector("parsererror")) throw new Error("GPX could not be parsed");
      const points = [...documentXml.querySelectorAll("trkpt")].map((point) => [
        Number(point.getAttribute("lat")),
        Number(point.getAttribute("lon")),
      ]);
      if (points.length < 2 || points.some(([lat, lon]) => !Number.isFinite(lat) || !Number.isFinite(lon))) {
        throw new Error("GPX does not contain a usable track");
      }

      const route = window.L.polyline(points, {
        color: "#9a3f2b",
        opacity: 1,
        weight: 5,
      }).addTo(map);
      route.bindTooltip("Confirmed 2026 race route");
      window.L.circleMarker(points[0], {
        color: "#173126",
        fillColor: "#fffdf8",
        fillOpacity: 1,
        radius: 7,
        weight: 3,
      }).addTo(map).bindPopup("Start and finish: bottom of Church Lane, Llanfoist");
      map.fitBounds(route.getBounds(), { padding: [24, 24] });
      if (tileFailures === 0) showStatus("Interactive route map loaded. Use the map controls to pan and zoom.");
    })
    .catch(() => {
      map.setView([51.81323, -3.03694], 14);
      showStatus("The route line could not load. The route description and GPX download remain available below.", true);
    });
}());
