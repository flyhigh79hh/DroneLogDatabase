import React, { useRef, useEffect, useMemo } from 'react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix for default marker icon issue with Webpack
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
});

interface FlightDataPoint {
  id: number;
  timestamp: string;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  speed?: number;
  rx_bt?: number;
  rssi?: number;
  rqly?: number;
  distance_from_start?: number;
}

interface MapDisplayProps {
  flightData: FlightDataPoint[];
  showAllPoints: boolean;
}

const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371000; // Radius of Earth in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in meters
};

const MapDisplay: React.FC<MapDisplayProps> = ({ flightData, showAllPoints }) => {
  const mapRef = useRef<HTMLDivElement>(null);

  const validFlightData = useMemo(() => flightData.filter(point => 
    point.latitude !== undefined && point.latitude !== null &&
    point.longitude !== undefined && point.longitude !== null
  ), [flightData]);

  const intelligentPoints = useMemo(() => {
    if (validFlightData.length < 2) return validFlightData;

    const filteredPoints: FlightDataPoint[] = [validFlightData[0]];
    let lastPoint = validFlightData[0];

    for (let i = 1; i < validFlightData.length; i++) {
      const currentPoint = validFlightData[i];
      if (currentPoint.latitude && currentPoint.longitude && lastPoint.latitude && lastPoint.longitude) {
        const distance = haversineDistance(
          lastPoint.latitude,
          lastPoint.longitude,
          currentPoint.latitude,
          currentPoint.longitude
        );
        if (distance >= 10) {
          filteredPoints.push(currentPoint);
          lastPoint = currentPoint;
        }
      }
    }
    if (validFlightData[validFlightData.length - 1].id !== lastPoint.id) {
        filteredPoints.push(validFlightData[validFlightData.length - 1]);
    }
    return filteredPoints;
  }, [validFlightData]);

  const pointsToRender = showAllPoints ? validFlightData : intelligentPoints;

  const getColorForSpeed = (speed: number | undefined) => {
    if (speed === undefined) return '#808080';
    if (speed < 10) return '#00FF00';
    if (speed < 30) return '#FFFF00';
    return '#FF0000';
  };

  useEffect(() => {
    if (!mapRef.current) return;

    const map = L.map(mapRef.current, { zoomControl: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    const layers: L.Layer[] = [];

    if (validFlightData.length > 0) {
      const positions = validFlightData.map(p => [p.latitude!, p.longitude!] as [number, number]);
      const latLngs = positions.map(p => L.latLng(p[0], p[1]));
      const bounds = L.latLngBounds(latLngs);
      if (positions.length > 0) map.fitBounds(bounds);
      else map.setView([0, 0], 2);

      validFlightData.slice(0, -1).forEach((point, index) => {
        const nextPoint = validFlightData[index + 1];
        const segmentPositions = [[point.latitude!, point.longitude!], [nextPoint.latitude!, nextPoint.longitude!]] as [number, number][];
        const segmentColor = getColorForSpeed(point.speed);
        const polyline = L.polyline(segmentPositions, { color: segmentColor, weight: 3 }).addTo(map);
        layers.push(polyline);
      });

      pointsToRender.forEach(point => {
        const circleMarker = L.circleMarker([point.latitude!, point.longitude!], {
          radius: 4,
          color: '#000000',
          fillColor: getColorForSpeed(point.speed),
          fillOpacity: 0.8,
        }).addTo(map);

        let popupContent = `
          <strong>Timestamp:</strong> ${new Date(point.timestamp).toLocaleString()}<br />
          <strong>Altitude:</strong> ${point.altitude?.toFixed(2)} m<br />
          <strong>Speed:</strong> ${point.speed?.toFixed(2)} km/h<br />
          <strong>Distance:</strong> ${point.distance_from_start?.toFixed(2)} m`;

        if (point.rssi !== undefined && point.rssi !== null) {
          popupContent += `<br /><strong>RSSI:</strong> ${point.rssi} dB`;
        }
        if (point.rx_bt !== undefined && point.rx_bt !== null) {
          popupContent += `<br /><strong>Rx Voltage:</strong> ${point.rx_bt?.toFixed(2)} V`;
        }

        circleMarker.bindPopup(popupContent);
        layers.push(circleMarker);
      });

      if (positions.length > 0) {
        const startMarker = L.marker(positions[0]).addTo(map).bindPopup('Flight Start');
        layers.push(startMarker);
      }
      if (positions.length > 1) {
        const endMarker = L.marker(positions[positions.length - 1]).addTo(map).bindPopup('Flight End');
        layers.push(endMarker);
      }
    }

    return () => {
      layers.forEach(layer => map.removeLayer(layer));
      map.remove();
    };
  }, [validFlightData, pointsToRender]);

  return <div ref={mapRef} style={{ height: '100%', width: '100%' }} />;
};

export default MapDisplay;
