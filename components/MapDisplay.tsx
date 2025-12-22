import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMap, Popup } from 'react-leaflet';
import L from 'leaflet';
import { Coordinates, LocationInfo } from '../types';

// Fix for default Leaflet markers in React
const iconUrl = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png";
const iconRetinaUrl = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png";
const shadowUrl = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png";

const DefaultIcon = L.icon({
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
  shadowSize: [41, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

interface MapDisplayProps {
  currentLocation?: Coordinates | null;
  targetLocation?: LocationInfo | null;
  radius?: number;
  center?: Coordinates;
  zoom?: number;
}

const MapUpdater: React.FC<{ center: Coordinates }> = ({ center }) => {
  const map = useMap();
  useEffect(() => {
    map.flyTo([center.lat, center.lng], map.getZoom());
  }, [center, map]);
  return null;
};

const triggerHaptic = () => {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(10); // Subtle vibration (10ms)
  }
};

const MapDisplay: React.FC<MapDisplayProps> = ({ 
  currentLocation, 
  targetLocation, 
  radius = 500, 
  center: explicitCenter, 
  zoom = 13 
}) => {
  // Priority: Explicit center -> Current Location -> Target Location -> Default (Montevideo/London)
  const center = explicitCenter || currentLocation || targetLocation || { lat: -34.9011, lng: -56.1645 };

  return (
    <MapContainer 
      center={[center.lat, center.lng]} 
      zoom={zoom} 
      scrollWheelZoom={true}
      className="rounded-xl z-0 outline-none"
      style={{ height: '100%', width: '100%', minHeight: '0' }} // Force explicit height for mobile
      zoomControl={false} // Cleaner for background
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      />
      
      {targetLocation && (
        <>
          <Marker 
            position={[targetLocation.lat, targetLocation.lng]}
            eventHandlers={{
              click: triggerHaptic
            }}
          >
             <Popup>{targetLocation.name}</Popup>
          </Marker>
          <Circle 
            center={[targetLocation.lat, targetLocation.lng]} 
            pathOptions={{ fillColor: 'red', color: 'red' }} 
            radius={radius} 
            eventHandlers={{
              click: triggerHaptic
            }}
          />
        </>
      )}

      {currentLocation && (
        <>
          <Marker 
            position={[currentLocation.lat, currentLocation.lng]}
            icon={L.divIcon({
              className: 'bg-blue-500 rounded-full border-2 border-white shadow-lg',
              iconSize: [16, 16],
              iconAnchor: [8, 8]
            })}
            eventHandlers={{
              click: triggerHaptic
            }}
          />
          <MapUpdater center={currentLocation} />
        </>
      )}
    </MapContainer>
  );
};

export default MapDisplay;