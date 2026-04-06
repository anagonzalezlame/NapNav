import React, { useEffect, useState, useCallback } from 'react';
import { GoogleMap, useJsApiLoader, Marker, Circle } from '@react-google-maps/api';
import { Coordinates, LocationInfo } from '../types';

interface MapDisplayProps {
  currentLocation?: Coordinates | null;
  targetLocation?: LocationInfo | null;
  radius?: number;
  center?: Coordinates;
  zoom?: number;
}

const containerStyle = {
  width: '100%',
  height: '100%'
};

const MAPS_API_KEY = 'AIzaSyAikM7wcxEjvIaVlhxcS11aObn_bNP1JyM';
const libraries: ("places")[] = ["places"];

const MapDisplay: React.FC<MapDisplayProps> = ({ 
  currentLocation, 
  targetLocation, 
  radius = 500, 
  center: explicitCenter, 
  zoom = 13
}) => {
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: MAPS_API_KEY,
    libraries
  });

  const [map, setMap] = useState<google.maps.Map | null>(null);

  const onLoad = useCallback(function callback(map: google.maps.Map) {
    setMap(map);
  }, []);

  const onUnmount = useCallback(function callback(map: google.maps.Map) {
    setMap(null);
  }, []);

  // Priority: Explicit center -> Current Location -> Target Location -> Default (Montevideo)
  const center = explicitCenter || currentLocation || targetLocation || { lat: -34.9011, lng: -56.1645 };

  useEffect(() => {
    if (map && center) {
      map.panTo(center);
    }
  }, [center, map]);

  if (loadError) {
    return <div className="w-full h-full flex items-center justify-center bg-slate-100 text-slate-500">Error loading Google Maps</div>;
  }

  if (!isLoaded) {
    return <div className="w-full h-full flex items-center justify-center bg-slate-100 text-slate-500">Loading map...</div>;
  }

  return (
    <GoogleMap
      mapContainerStyle={containerStyle}
      center={center}
      zoom={zoom}
      onLoad={onLoad}
      onUnmount={onUnmount}
      options={{
        disableDefaultUI: true,
        zoomControl: false,
        gestureHandling: 'greedy'
      }}
    >
      {targetLocation && (
        <>
          <Marker position={{ lat: targetLocation.lat, lng: targetLocation.lng }} />
          <Circle 
            center={{ lat: targetLocation.lat, lng: targetLocation.lng }}
            radius={radius}
            options={{
              fillColor: '#FF0000',
              fillOpacity: 0.2,
              strokeColor: '#FF0000',
              strokeOpacity: 0.8,
              strokeWeight: 2,
            }}
          />
        </>
      )}

      {currentLocation && (
        <Marker 
          position={{ lat: currentLocation.lat, lng: currentLocation.lng }}
          icon={{
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: '#3b82f6',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          }}
        />
      )}
    </GoogleMap>
  );
};

export default React.memo(MapDisplay);