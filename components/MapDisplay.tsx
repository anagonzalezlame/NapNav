import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Coordinates, LocationInfo } from '../types';

// Fix Leaflet default icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Custom icons
const currentLocationIcon = L.divIcon({
  className: 'custom-current-location-icon',
  html: `<div style="width: 16px; height: 16px; background-color: #4F46E5; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 4px rgba(0,0,0,0.3);"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});

const targetLocationIcon = L.divIcon({
  className: 'custom-target-location-icon',
  html: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#e11d48" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle></svg>`,
  iconSize: [32, 32],
  iconAnchor: [16, 32]
});

interface MapDisplayProps {
  currentLocation?: Coordinates | null;
  targetLocation?: LocationInfo | null;
  radius?: number;
  center?: Coordinates;
  zoom?: number;
}

// Component to handle programmatic map movement
const MapUpdater: React.FC<{ center: Coordinates; zoom: number }> = ({ center, zoom }) => {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lng], zoom);
  }, [center, zoom, map]);
  return null;
};

const MapDisplay: React.FC<MapDisplayProps> = ({ 
  currentLocation, 
  targetLocation, 
  radius = 500, 
  center: explicitCenter, 
  zoom = 13
}) => {
  const center = explicitCenter || currentLocation || targetLocation || { lat: -34.9011, lng: -56.1645 };

  return (
    <div style={{ width: '100%', height: '100%', zIndex: 0 }}>
      <MapContainer 
        center={[center.lat, center.lng]} 
        zoom={zoom} 
        style={{ width: '100%', height: '100%', zIndex: 1 }}
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        />
        <MapUpdater center={center} zoom={zoom} />
        
        {currentLocation && (
          <Marker position={[currentLocation.lat, currentLocation.lng]} icon={currentLocationIcon} />
        )}

        {targetLocation && (
          <>
            <Marker position={[targetLocation.lat, targetLocation.lng]} icon={targetLocationIcon} />
            <Circle 
              center={[targetLocation.lat, targetLocation.lng]} 
              radius={radius}
              pathOptions={{
                fillColor: "#e11d48",
                fillOpacity: 0.15,
                color: "#e11d48",
                opacity: 0.8,
                weight: 2,
              }}
            />
          </>
        )}
      </MapContainer>
    </div>
  );
};

export default React.memo(MapDisplay);
