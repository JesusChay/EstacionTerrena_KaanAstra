import Leaflet from 'leaflet';

export function createLandingPredictionOverlay({ map }) {
  const estimatedPath = Leaflet.polyline([], {
    color: '#ffb300',
    dashArray: '8 10',
    opacity: 0.95,
    weight: 3
  }).addTo(map);
  const uncertaintyCircle = Leaflet.circle([0, 0], {
    color: '#4bc0c0',
    fillColor: '#4bc0c0',
    fillOpacity: 0.12,
    opacity: 0.7,
    radius: 0,
    weight: 2
  }).addTo(map);
  const landingMarker = Leaflet.marker([0, 0], {
    icon: Leaflet.divIcon({
      className: 'predicted-landing-icon-wrapper',
      html: '<div class="predicted-landing-icon"></div>',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    })
  }).addTo(map);

  let isVisible = false;
  clear();

  function render(prediction) {
    const trajectory = Array.isArray(prediction?.estimatedTrajectory)
      ? prediction.estimatedTrajectory
        .filter((point) => Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude))
        .map((point) => [point.latitude, point.longitude])
      : [];
    const landingPoint = prediction?.predictedLanding;

    if (!landingPoint || !Number.isFinite(landingPoint.latitude) || !Number.isFinite(landingPoint.longitude)) {
      clear();
      return;
    }

    estimatedPath.setLatLngs(trajectory);
    landingMarker.setLatLng([landingPoint.latitude, landingPoint.longitude]);
    uncertaintyCircle.setLatLng([landingPoint.latitude, landingPoint.longitude]);
    uncertaintyCircle.setRadius(Number.isFinite(prediction?.uncertaintyRadiusMeters) ? prediction.uncertaintyRadiusMeters : 0);

    if (!isVisible) {
      estimatedPath.addTo(map);
      landingMarker.addTo(map);
      uncertaintyCircle.addTo(map);
      isVisible = true;
    }
  }

  function clear() {
    estimatedPath.setLatLngs([]);
    uncertaintyCircle.setRadius(0);
    landingMarker.setLatLng([0, 0]);

    if (isVisible) {
      map.removeLayer(estimatedPath);
      map.removeLayer(landingMarker);
      map.removeLayer(uncertaintyCircle);
      isVisible = false;
    }
  }

  return {
    clear,
    render
  };
}
