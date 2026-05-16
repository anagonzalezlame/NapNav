import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMap, Tooltip, Polyline, useMapEvents } from 'react-leaflet';
import { LocateFixed } from 'lucide-react'; // Icon for recentering
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

const trackingCurrentIcon = L.divIcon({
  className: 'custom-current-location-icon-tracking',
  html: `
    <div class="relative w-10 h-10 flex items-center justify-center">
      <div class="absolute inset-0 bg-cyan-400 rounded-full animate-ping opacity-40" style="animation-duration: 2s;"></div>
      <div class="absolute inset-2 bg-cyan-500 rounded-full opacity-30 blur-md"></div>
      <div class="relative w-5 h-5 bg-cyan-400 border-[3px] border-slate-900 rounded-full shadow-[0_0_15px_rgba(34,211,238,0.8)] z-10"></div>
    </div>
  `,
  iconSize: [40, 40],
  iconAnchor: [20, 20]
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

const trackingTargetIcon = L.divIcon({
  className: 'custom-target-location-icon-tracking',
  html: `
    <div class="relative flex flex-col items-center">
      <div class="absolute -top-2 w-12 h-12 bg-rose-500 rounded-full animate-pulse opacity-30 blur-md"></div>
      <div class="absolute -top-1 w-10 h-10 bg-rose-400 rounded-full animate-ping opacity-20" style="animation-duration: 3s;"></div>
      <svg xmlns="http://www.w3.org/2000/svg" width="46" height="46" viewBox="0 0 24 24" fill="#f43f5e" stroke="#0f172a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0px 0px 10px rgba(244,63,94,0.8)); position: relative; z-index: 10;">
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path>
        <circle cx="12" cy="10" r="3" fill="#0f172a"></circle>
      </svg>
    </div>
  `,
  iconSize: [46, 46],
  iconAnchor: [23, 46]
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
  autoCenter?: boolean;
}> = ({ currentLocation, targetLocation, radius, explicitCenter, zoom, isTracking, autoCenter = true }) => {
  const map = useMap();
  
  useEffect(() => {
    if (!map) return;

    const updateMap = () => {
      try {
        if (explicitCenter && !isTracking) {
          map.setView([explicitCenter.lat, explicitCenter.lng], zoom);
          return;
        }

        if (!autoCenter && isTracking) {
          // If the user has dragged and we are tracking, we stop auto-centering
          return;
        }

        if (currentLocation && targetLocation) {
          if (isTracking) {
            map.setView([currentLocation.lat, currentLocation.lng], zoom, { animate: true });
          } else {
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
    radius, zoom, map, isTracking, autoCenter
  ]);

  return null;
};

const MapEventsHandler = ({ onDrag }: { onDrag: () => void }) => {
  useMapEvents({
    dragstart: () => {
      onDrag();
    },
  });
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

  const [autoCenter, setAutoCenter] = useState(true);

  // Choose map theme based on tracking mode
  const tileUrl = isTracking || darkMode
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

  return (
    <div style={{ width: '100%', height: '100%', zIndex: 0, position: 'relative' }}>
      {isTracking && !autoCenter && (
        <button 
          onClick={() => setAutoCenter(true)}
          className="absolute top-6 right-6 z-[400] bg-white/90 dark:bg-slate-800/90 backdrop-blur-md p-3.5 rounded-full shadow-xl hover:scale-105 active:scale-95 transition-all text-indigo-500 border border-indigo-500/20"
        >
          <LocateFixed className="w-5 h-5" />
        </button>
      )}
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
        
        <MapEventsHandler onDrag={() => setAutoCenter(false)} />
        
        <MapUpdater 
          currentLocation={currentLocation}
          targetLocation={targetLocation}
          radius={radius}
          explicitCenter={explicitCenter}
          zoom={zoom} 
          isTracking={isTracking}
          autoCenter={autoCenter}
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
          <Marker 
            position={[currentLocation.lat, currentLocation.lng]} 
            icon={isTracking ? trackingCurrentIcon : currentLocationIcon}
            eventHandlers={{
              click: () => {
                if (window.navigator && window.navigator.vibrate) {
                  window.navigator.vibrate(10);
                }
              }
            }}
          >
            <Tooltip permanent direction="top" offset={[0, -10]} className={`font-bold px-2 py-1 rounded shadow text-xs ${isTracking ? 'text-cyan-400 bg-slate-900 border border-slate-700' : 'text-blue-600 bg-white'}`}>
              Tú
            </Tooltip>
          </Marker>
        ) : null}

        {targetLocation ? (
          <React.Fragment key="target-group">
            <Marker 
              position={[targetLocation.lat, targetLocation.lng]} 
              icon={isTracking ? trackingTargetIcon : targetLocationIcon}
              eventHandlers={{
                click: () => {
                  if (window.navigator && window.navigator.vibrate) {
                    window.navigator.vibrate(10);
                  }
                }
              }}
            >
               <Tooltip permanent direction="bottom" offset={[0, 5]} className={`font-bold px-2 py-1 rounded shadow text-xs ${isTracking ? 'text-rose-400 bg-slate-900 border border-slate-700' : 'text-rose-600 bg-white'}`}>
                 {targetLocation.name}
               </Tooltip>
            </Marker>
            <Circle 
              center={[targetLocation.lat, targetLocation.lng]} 
              radius={radius}
              eventHandlers={{
                click: () => {
                  if (window.navigator && window.navigator.vibrate) {
                    window.navigator.vibrate(10);
                  }
                }
              }}
              pathOptions={{
                fillColor: isTracking ? "#f43f5e" : "#e11d48",
                fillOpacity: isTracking ? 0.15 : 0.2, // A bit stronger to be clearer
                color: isTracking ? "#f43f5e" : "#e11d48",
                opacity: isTracking ? 0.8 : 0.9,
                weight: isTracking ? 2 : 3,        // Thicker border
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
