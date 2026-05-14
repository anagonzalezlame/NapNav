import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMap, Tooltip, Polyline } from 'react-leaflet';
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
  html: `
    <div class="relative w-8 h-8 flex items-center justify-center">
      <div class="absolute inset-0 bg-blue-500 rounded-full animate-ping opacity-75"></div>
      <div class="relative w-5 h-5 bg-blue-600 border-4 border-white rounded-full shadow-md z-10"></div>
    </div>
  `,
  iconSize: [32, 32],
  iconAnchor: [16, 16]
});

const targetLocationIcon = L.divIcon({
  className: 'custom-target-location-icon',
  html: `
    <div class="relative flex flex-col items-center">
      <div class="absolute -top-1 w-10 h-10 bg-rose-500 rounded-full animate-pulse opacity-20"></div>
      <svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 24 24" fill="#e11d48" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0px 4px 6px rgba(0,0,0,0.4));">
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path>
        <circle cx="12" cy="10" r="3" fill="white"></circle>
      </svg>
    </div>
  `,
  iconSize: [42, 42],
  iconAnchor: [21, 42]
});

export interface MapDisplayProps {
  currentLocation?: Coordinates | null;
  targetLocation?: LocationInfo | null;
  radius?: number;
  center?: Coordinates;
  zoom?: number;
  isTracking?: boolean;
  darkMode?: boolean;
}

// Component to handle programmatic map movement and auto-centering
const MapUpdater: React.FC<{ 
  currentLocation?: Coordinates | null;
  targetLocation?: LocationInfo | null;
  radius: number;
  explicitCenter?: Coordinates;
  zoom: number;
  isTracking?: boolean;
}> = ({ currentLocation, targetLocation, radius, explicitCenter, zoom, isTracking }) => {
  const map = useMap();
  
  useEffect(() => {
    if (!map) return;

    const updateMap = () => {
      try {
        if (explicitCenter && !isTracking) {
          map.setView([explicitCenter.lat, explicitCenter.lng], zoom);
          return;
        }

        if (currentLocation && targetLocation) {
          // Auto-centrado estricto en el usuario, calculando el recuadro para que también incluya el destino
          const userLatLng = L.latLng(currentLocation.lat, currentLocation.lng);
          const targetLatLng = L.latLng(targetLocation.lat, targetLocation.lng);
          const distance = userLatLng.distanceTo(targetLatLng);
          
          // Calculamos radio máximo asegurando que entran destino y círculo (+ padding)
          const maxNeededRadius = distance + radius + 200; 
          
          const latDelta = maxNeededRadius / 111320;
          const lngDelta = maxNeededRadius / (40075000 * Math.cos(currentLocation.lat * Math.PI / 180) / 360);
          
          const bounds = L.latLngBounds(
            [currentLocation.lat - latDelta, currentLocation.lng - lngDelta],
            [currentLocation.lat + latDelta, currentLocation.lng + lngDelta]
          );

          // Ajustamos vista pero centrándose garantizadamente en el usuario siempre
          const size = map.getSize();
          if (size && size.x > 0 && size.y > 0) {
            map.fitBounds(bounds, { animate: true, padding: [20, 20], maxZoom: 17 });
          } else {
            map.setView([currentLocation.lat, currentLocation.lng], 14);
          }
          
        } else if (currentLocation) {
          map.setView([currentLocation.lat, currentLocation.lng], 15);
        } else if (targetLocation) {
          map.setView([targetLocation.lat, targetLocation.lng], 15);
        }
      } catch (e) {
        console.warn("MapUpdater error handled:", e);
      }
    };

    // Al montar (o después de cambiar el DOM) puede que el mapa tenga tamaño = 0, se usa timeout
    const timeout = setTimeout(updateMap, 100);
    return () => clearTimeout(timeout);
  }, [
    explicitCenter?.lat, explicitCenter?.lng, 
    currentLocation?.lat, currentLocation?.lng,
    targetLocation?.lat, targetLocation?.lng,
    radius, zoom, map, isTracking
  ]);

  return null;
};

const MapDisplay: React.FC<MapDisplayProps> = ({ 
  currentLocation, 
  targetLocation, 
  radius = 500, 
  center: explicitCenter, 
  zoom = 13,
  isTracking = false,
  darkMode = false
}) => {
  const defaultCenter = explicitCenter || currentLocation || targetLocation || { lat: -34.9011, lng: -56.1645 };

  // Choose map theme based on tracking mode
  const tileUrl = isTracking || darkMode
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

  return (
    <div style={{ width: '100%', height: '100%', zIndex: 0 }}>
      <MapContainer 
        center={[defaultCenter.lat, defaultCenter.lng]} 
        zoom={zoom} 
        style={{ width: '100%', height: '100%', zIndex: 1 }}
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          url={tileUrl}
        />
        
        <MapUpdater 
          currentLocation={currentLocation}
          targetLocation={targetLocation}
          radius={radius}
          explicitCenter={explicitCenter}
          zoom={zoom} 
          isTracking={isTracking}
        />
        
        {currentLocation && targetLocation && (
           <Polyline 
             positions={[
               [currentLocation.lat, currentLocation.lng], 
               [targetLocation.lat, targetLocation.lng]
             ]}
             pathOptions={{ color: '#818cf8', weight: 4, dashArray: '10 10', opacity: 0.6 }}
           />
        )}
        
        {currentLocation ? (
          <Marker position={[currentLocation.lat, currentLocation.lng]} icon={currentLocationIcon}>
            <Tooltip permanent direction="top" offset={[0, -10]} className="font-bold text-blue-600 bg-white px-2 py-1 rounded shadow text-xs">
              Tú
            </Tooltip>
          </Marker>
        ) : null}

        {targetLocation ? (
          <React.Fragment key="target-group">
            <Marker position={[targetLocation.lat, targetLocation.lng]} icon={targetLocationIcon}>
               <Tooltip permanent direction="bottom" offset={[0, 5]} className="font-bold text-rose-600 bg-white px-2 py-1 rounded shadow text-xs">
                 {targetLocation.name}
               </Tooltip>
            </Marker>
            <Circle 
              center={[targetLocation.lat, targetLocation.lng]} 
              radius={radius}
              pathOptions={{
                fillColor: "#e11d48",
                fillOpacity: 0.2, // A bit stronger to be clearer
                color: "#e11d48",
                opacity: 0.9,
                weight: 3,        // Thicker border
                dashArray: "10 5" // Dashed line for visual distinction
              }}
            />
          </React.Fragment>
        ) : null}
      </MapContainer>
    </div>
  );
};

export default React.memo(MapDisplay);
