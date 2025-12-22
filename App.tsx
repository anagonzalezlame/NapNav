import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  MapPin, Navigation, Bell, Search, StopCircle, Volume2, 
  AlertCircle, RefreshCw, Loader2, ArrowLeft, X, User, 
  Settings, Heart, Trash2, History, ChevronRight, Zap, Smartphone, Check,
  Moon, Sun
} from 'lucide-react';
import { LineChart, Line, YAxis, ResponsiveContainer } from 'recharts';
import { findLocation, generateAlarmScript, getPlaceSuggestions } from './services/gemini';
import { calculateDistance, formatDistance } from './utils/geo';
import { AppStatus, LocationInfo, AlarmConfig, Coordinates, SavedPlace, AlarmSettings, AlarmIntensity } from './types';
import MapDisplay from './components/MapDisplay';

const App: React.FC = () => {
  // State
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  
  const [locationError, setLocationError] = useState<string | null>(null);
  const [currentLocation, setCurrentLocation] = useState<Coordinates | null>(null);
  const [useHighAccuracy, setUseHighAccuracy] = useState(true); // Preference

  const [alarmConfig, setAlarmConfig] = useState<AlarmConfig | null>(null);
  const [distanceHistory, setDistanceHistory] = useState<{ distance: number; time: number }[]>([]);
  const [currentDistance, setCurrentDistance] = useState<number | null>(null);
  
  // Persistence State
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [history, setHistory] = useState<SavedPlace[]>([]);

  // Alarm Settings
  const [alarmSettings, setAlarmSettings] = useState<AlarmSettings>({
    volume: 100,
    vibration: true,
    intensity: 'normal'
  });

  // Refs
  const vibrationIntervalRef = useRef<number | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);
  const debounceRef = useRef<number | null>(null);
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Load from LocalStorage
  useEffect(() => {
    const loadedPlaces = localStorage.getItem('napnav_places');
    const loadedHistory = localStorage.getItem('napnav_history');
    const loadedSettings = localStorage.getItem('napnav_settings');
    
    if (loadedPlaces) setSavedPlaces(JSON.parse(loadedPlaces));
    if (loadedHistory) setHistory(JSON.parse(loadedHistory));
    if (loadedSettings) setAlarmSettings(JSON.parse(loadedSettings));
  }, []);

  // Save to LocalStorage
  useEffect(() => {
    localStorage.setItem('napnav_places', JSON.stringify(savedPlaces));
  }, [savedPlaces]);

  useEffect(() => {
    localStorage.setItem('napnav_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem('napnav_settings', JSON.stringify(alarmSettings));
  }, [alarmSettings]);

  // Geolocation Watcher
  useEffect(() => {
    if ('geolocation' in navigator) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }

      console.log(`Iniciando observador de geolocalización. Alta Precisión: ${useHighAccuracy}`);

      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          const newLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          setCurrentLocation(newLocation);
          setLocationError(null);
        },
        (error) => {
          if (error.code === 3 && useHighAccuracy) {
             console.log("Timeout alta precisión -> Fallback.");
          }
          let msg = "Ubicación no disponible.";
           switch (error.code) {
            case 1: msg = "Permiso denegado."; break;
            case 2: msg = "Sin señal GPS."; break;
            case 3: msg = "Tiempo agotado."; break;
          }
          setLocationError(msg);
        },
        { 
          enableHighAccuracy: useHighAccuracy, 
          maximumAge: 10000, 
          timeout: 30000 
        }
      );
    } else {
      setLocationError("Navegador no soportado.");
    }

    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, [useHighAccuracy]);

  // Autocomplete
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length > 2 && status === AppStatus.IDLE) {
      setIsSuggesting(true);
      debounceRef.current = window.setTimeout(async () => {
        try {
          const results = await getPlaceSuggestions(query, currentLocation);
          setSuggestions(results);
          setShowSuggestions(true);
        } catch (e) {
          console.error("Falló el autocompletado", e);
        } finally {
          setIsSuggesting(false);
        }
      }, 500); 
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
      setIsSuggesting(false);
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, currentLocation, status]);

  // Distance Tracking
  useEffect(() => {
    if (status !== AppStatus.TRACKING || !currentLocation || !alarmConfig) return;

    const dist = calculateDistance(currentLocation, alarmConfig.target);
    setCurrentDistance(dist);

    setDistanceHistory((prev) => {
      const newData = [...prev, { distance: dist, time: Date.now() }];
      return newData.slice(-20);
    });

    if (dist <= alarmConfig.radius) {
      triggerAlarm();
    }
  }, [currentLocation, status, alarmConfig]);

  // Wake Lock
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      }
    } catch (err) {
      console.log('Error Wake Lock:', err);
    }
  };

  const releaseWakeLock = useCallback(async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      } catch (err) {
        console.log('Error al liberar Wake Lock', err);
      }
    }
  }, []);

  // --- Logic Functions ---

  const executeSearch = async (searchQuery: string, radiusOverride?: number) => {
    if (!searchQuery.trim()) return;

    setStatus(AppStatus.SEARCHING);
    setShowSuggestions(false);
    try {
      const location = await findLocation(searchQuery);
      // Generate text script instead of audio bytes
      const alarmScript = await generateAlarmScript(location.name, alarmSettings.intensity);

      setAlarmConfig({
        target: location,
        radius: radiusOverride || 500, 
        alarmMessage: alarmScript
      });
      setStatus(AppStatus.CONFIRMING);
    } catch (error) {
      console.error(error);
      alert("No pudimos encontrar ese lugar. Inténtalo de nuevo.");
      setStatus(AppStatus.IDLE);
    }
  };

  const selectSavedLocation = async (place: SavedPlace) => {
    setStatus(AppStatus.SEARCHING);
    try {
      // Regenerate script (or could store it, but generating allows dynamic updates)
      const alarmScript = await generateAlarmScript(place.name, alarmSettings.intensity);
      
      setAlarmConfig({
        target: place,
        radius: place.defaultRadius || 500,
        alarmMessage: alarmScript
      });
      setStatus(AppStatus.CONFIRMING);
    } catch (error) {
      console.error("Error selecting location", error);
      setStatus(AppStatus.IDLE);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    executeSearch(query);
  };

  const handleSuggestionClick = (suggestion: string) => {
    setQuery(suggestion);
    executeSearch(suggestion);
  };

  const startTracking = async () => {
    if (!alarmConfig) return;
    
    // "Prime" the speech synthesis engine on user interaction
    // This helps bypass browser autoplay policies
    window.speechSynthesis.cancel();
    const silent = new SpeechSynthesisUtterance("");
    silent.volume = 0;
    window.speechSynthesis.speak(silent);

    await requestWakeLock();

    // Add to history
    const newHistoryItem: SavedPlace = {
      ...alarmConfig.target,
      id: Date.now().toString(),
      dateAdded: Date.now(),
      defaultRadius: alarmConfig.radius
    };
    
    setHistory(prev => {
      // Remove duplicates by name to avoid clutter
      const filtered = prev.filter(p => p.name !== newHistoryItem.name);
      // Add to top, limit to 5
      return [newHistoryItem, ...filtered].slice(0, 5);
    });

    setStatus(AppStatus.TRACKING);
  };

  const stopTracking = async () => {
    setStatus(AppStatus.IDLE);
    setDistanceHistory([]);
    setCurrentDistance(null);
    stopAlarmSound();
    stopVibration();
    setQuery(''); 
    await releaseWakeLock();
  };

  const triggerAlarm = () => {
    setStatus(AppStatus.ALARM_TRIGGERED);
    playAlarmSound();
    startVibration();
  };

  const playAlarmSound = () => {
    if (!alarmConfig?.alarmMessage) return;

    // Stop any existing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(alarmConfig.alarmMessage);
    speechRef.current = utterance;
    
    // Configure voice
    const voices = window.speechSynthesis.getVoices();
    // Try to find a Spanish voice, fallback to first available
    const spanishVoice = voices.find(v => v.lang.startsWith('es')) || voices[0];
    if (spanishVoice) utterance.voice = spanishVoice;

    // Configure volume (Web Speech API uses 0-1)
    utterance.volume = alarmSettings.volume / 100;
    
    // Configure rate/pitch based on intensity
    if (alarmSettings.intensity === 'soft') {
      utterance.rate = 0.8;
      utterance.pitch = 0.9;
    } else if (alarmSettings.intensity === 'intense') {
      utterance.rate = 1.2;
      utterance.pitch = 1.1;
    }

    // Loop logic
    utterance.onend = () => {
      if (status === AppStatus.ALARM_TRIGGERED) {
        // Create a small pause before repeating
        setTimeout(() => {
          if (status === AppStatus.ALARM_TRIGGERED) {
             window.speechSynthesis.speak(utterance);
          }
        }, 1000);
      }
    };

    window.speechSynthesis.speak(utterance);
  };

  const stopAlarmSound = () => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  };

  const startVibration = () => {
    if (!alarmSettings.vibration || !('vibrate' in navigator)) return;
    
    let pattern: number[] = [];
    let interval = 1000;

    switch (alarmSettings.intensity) {
        case 'soft':
            pattern = [200, 1000];
            interval = 1200;
            break;
        case 'intense':
            pattern = [500, 100, 500, 100];
            interval = 1200;
            break;
        case 'normal':
        default:
            pattern = [500, 500];
            interval = 1000;
            break;
    }

    const vibrate = () => navigator.vibrate(pattern);
    vibrate(); 
    vibrationIntervalRef.current = window.setInterval(vibrate, interval);
  };

  const stopVibration = () => {
    if (vibrationIntervalRef.current) {
        clearInterval(vibrationIntervalRef.current);
        vibrationIntervalRef.current = null;
    }
    if ('vibrate' in navigator) navigator.vibrate(0);
  };

  const toggleSavedPlace = (place: LocationInfo) => {
    const exists = savedPlaces.find(p => p.name === place.name && p.lat === place.lat);
    if (exists) {
      setSavedPlaces(prev => prev.filter(p => p.id !== exists.id));
    } else {
      const newPlace: SavedPlace = {
        ...place,
        id: Date.now().toString(),
        dateAdded: Date.now()
      };
      setSavedPlaces(prev => [newPlace, ...prev]);
    }
  };

  const isSaved = (place: LocationInfo | undefined) => {
    if (!place) return false;
    return savedPlaces.some(p => p.name === place.name && p.lat === place.lat);
  };

  const deleteSavedPlace = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSavedPlaces(prev => prev.filter(p => p.id !== id));
  };

  // --- UI RENDERERS ---

  const renderIdle = () => (
    <div className="relative flex flex-col items-center justify-center min-h-[100dvh] overflow-hidden bg-slate-50">
      {/* Background */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <MapDisplay center={{ lat: -34.9011, lng: -56.1645 }} zoom={13} />
        {/* Improved Overlay Gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-50/90 via-slate-50/80 to-slate-50/95 backdrop-blur-[1px]"></div>
      </div>

      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 p-6 flex justify-end z-20">
        <button 
          onClick={() => setStatus(AppStatus.PROFILE)}
          className="bg-white/90 backdrop-blur-md p-3 rounded-2xl shadow-lg shadow-indigo-500/10 hover:shadow-indigo-500/20 hover:scale-105 transition-all text-slate-700 border border-white/50"
        >
          <User className="w-6 h-6" />
        </button>
      </div>

      <div className="relative z-10 flex flex-col items-center w-full px-6 max-w-lg mx-auto">
        <div className="bg-gradient-to-br from-indigo-500 to-violet-600 p-5 rounded-3xl mb-8 shadow-xl shadow-indigo-500/20 rotate-3 hover:rotate-6 transition-transform duration-300">
          <MapPin className="w-10 h-10 text-white" strokeWidth={2.5} />
        </div>
        <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-br from-slate-900 to-slate-600 mb-3 tracking-tight">
          NapNav
        </h1>
        <p className="text-slate-500 font-medium text-center mb-12 max-w-xs leading-relaxed">
          Duerme tranquilo. Nosotros te despertamos antes de que te pases.
        </p>
        
        <div className="w-full relative group">
          <form onSubmit={handleSearch} className="w-full relative z-20">
            {/* Added pointer-events-none to the decorative shadow to prevent blocking input */}
            <div className="absolute inset-0 bg-indigo-500/5 rounded-3xl transform translate-y-2 blur-md pointer-events-none"></div>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => { if(suggestions.length > 0) setShowSuggestions(true); }}
              placeholder="¿A dónde quieres ir?"
              // Added relative and z-10 to input to ensure it sits on top of the shadow
              className="w-full pl-14 pr-16 py-5 rounded-3xl border border-indigo-100 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] focus:shadow-[0_8px_30px_rgb(99,102,241,0.15)] focus:border-indigo-300 focus:ring-0 transition-all outline-none text-lg text-slate-800 placeholder:text-slate-400 font-medium relative z-10"
            />
            {/* Added pointer-events-none and z-20 to icon to ensure input is clickable around it or it sits on top visually */}
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-indigo-400 w-6 h-6 pointer-events-none z-20" />
            
            {isSuggesting ? (
              <Loader2 className="absolute right-5 top-1/2 -translate-y-1/2 text-indigo-500 w-5 h-5 animate-spin z-20" />
            ) : (
              <button 
                  type="submit" 
                  disabled={!query}
                  className="absolute right-3 top-2 bottom-2 bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-5 rounded-2xl font-bold text-sm disabled:opacity-50 hover:shadow-lg hover:shadow-indigo-500/30 transition-all active:scale-95 z-20"
              >
                  Ir
              </button>
            )}
          </form>

          {/* Autocomplete */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-4 right-4 mt-2 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl shadow-slate-200/50 border border-slate-100 overflow-hidden z-30 animate-in fade-in slide-in-from-top-2 duration-200">
              <ul className="divide-y divide-slate-50">
                {suggestions.map((item, idx) => (
                  <li key={idx}>
                    <button
                      onClick={() => handleSuggestionClick(item)}
                      className="w-full text-left px-5 py-4 hover:bg-indigo-50/50 transition-colors flex items-center gap-4 text-slate-600 hover:text-indigo-700"
                    >
                      <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                        <MapPin className="w-4 h-4 text-slate-400" />
                      </div>
                      <span className="truncate font-medium">{item}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Quick Access UI - Horizontal Scroll */}
        {(savedPlaces.length > 0 || history.length > 0) && (
          <div className="w-full mt-8 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 pl-1">
              Destinos Rápidos
            </h3>
            <div className="flex gap-3 overflow-x-auto pb-4 -mx-6 px-6 scrollbar-hide snap-x">
              {/* Favorites First */}
              {savedPlaces.map(place => (
                <button
                  key={`fav-${place.id}`}
                  onClick={() => selectSavedLocation(place)}
                  className="flex-shrink-0 snap-start bg-white p-3 pr-5 rounded-2xl shadow-sm border border-indigo-100 flex items-center gap-3 hover:shadow-md transition-all active:scale-95 group min-w-[160px]"
                >
                  <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center text-rose-500 group-hover:bg-rose-100 transition-colors">
                    <Heart className="w-5 h-5 fill-current" />
                  </div>
                  <div className="text-left overflow-hidden">
                    <p className="font-bold text-slate-800 text-sm truncate">{place.name}</p>
                    <p className="text-xs text-slate-500">{formatDistance(place.defaultRadius || 500)}</p>
                  </div>
                </button>
              ))}
              
              {/* History Items */}
              {history.map(place => {
                return (
                  <button
                    key={`hist-${place.id}`}
                    onClick={() => selectSavedLocation(place)}
                    className="flex-shrink-0 snap-start bg-white p-3 pr-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-3 hover:shadow-md transition-all active:scale-95 group min-w-[160px]"
                  >
                    <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-500 transition-colors">
                      <History className="w-5 h-5" />
                    </div>
                    <div className="text-left overflow-hidden">
                      <p className="font-bold text-slate-800 text-sm truncate">{place.name}</p>
                      <p className="text-xs text-slate-500">{formatDistance(place.defaultRadius || 500)}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        
        {locationError && (
          <div className="mt-8 flex items-center gap-3 bg-red-50 p-4 rounded-2xl border border-red-100 shadow-sm animate-in fade-in slide-in-from-bottom-2">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
              <div className="flex-1">
                  <p className="text-sm font-semibold text-red-700">{locationError}</p>
                  <button 
                    onClick={() => { setLocationError(null); setUseHighAccuracy(true); window.location.reload(); }}
                    className="text-red-600 text-xs font-bold hover:underline flex items-center gap-1 mt-1"
                  >
                    <RefreshCw className="w-3 h-3" /> Reintentar
                  </button>
              </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderProfile = () => (
    <div className="min-h-[100dvh] bg-slate-50 flex flex-col font-sans">
      {/* Header */}
      <div className="bg-white px-6 pt-12 pb-8 rounded-b-[2.5rem] shadow-sm border-b border-slate-100 relative z-10">
        <div className="flex items-center justify-between mb-8">
            <button 
                onClick={() => setStatus(AppStatus.IDLE)} 
                className="p-3 -ml-2 rounded-2xl hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-colors"
            >
                <ArrowLeft className="w-6 h-6" />
            </button>
            <button 
                onClick={() => setStatus(AppStatus.SETTINGS)}
                className="p-3 bg-slate-50 rounded-2xl text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                aria-label="Configuración"
            >
                <Settings className="w-6 h-6" />
            </button>
        </div>
        
        <div className="flex items-center gap-5">
            <div className="w-20 h-20 bg-gradient-to-br from-indigo-100 to-violet-100 rounded-3xl flex items-center justify-center border-4 border-white shadow-lg shadow-indigo-100">
                <User className="w-10 h-10 text-indigo-600" />
            </div>
            <div>
                <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Mi Perfil</h2>
                <p className="text-slate-500 font-medium">Preferencias y Destinos</p>
            </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        
        {/* Section: Preferences */}
        <section>
          <div className="bg-white rounded-3xl p-2 shadow-sm border border-slate-100">
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-sky-100 flex items-center justify-center text-sky-600">
                     <Navigation className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">GPS de Alta Precisión</p>
                    <p className="text-xs text-slate-500 font-medium">Mejor rastreo, más batería</p>
                  </div>
              </div>
              <button 
                onClick={() => setUseHighAccuracy(!useHighAccuracy)}
                className={`w-14 h-8 rounded-full transition-colors relative shadow-inner ${useHighAccuracy ? 'bg-indigo-500' : 'bg-slate-200'}`}
              >
                <div className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-sm transition-all duration-300 ${useHighAccuracy ? 'left-7' : 'left-1'}`} />
              </button>
            </div>
          </div>
        </section>

        {/* Section: Locations */}
        <section>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 ml-2">Favoritos</h3>
          {savedPlaces.length === 0 ? (
            <div className="text-center py-10 bg-white rounded-3xl border border-dashed border-slate-200">
              <Heart className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-slate-400 font-medium text-sm">Aún no tienes lugares guardados.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {savedPlaces.map(place => (
                <div key={place.id} className="bg-white p-4 rounded-3xl shadow-sm border border-slate-100 flex items-center justify-between group active:scale-[0.98] transition-all">
                  <div 
                    onClick={() => selectSavedLocation(place)}
                    className="flex-1 flex items-center gap-4 cursor-pointer"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-500 shrink-0">
                        <Heart className="w-6 h-6 fill-current" />
                    </div>
                    <div className="min-w-0">
                        <p className="font-bold text-slate-900 truncate">{place.name}</p>
                        <p className="text-xs text-slate-500 truncate">{place.address || "Coordenadas guardadas"}</p>
                    </div>
                  </div>
                  <button 
                    onClick={(e) => deleteSavedPlace(place.id, e)}
                    className="p-3 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-colors"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Section: History */}
        <section>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 ml-2">Recientes</h3>
          {history.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-slate-400 text-sm">Tus viajes recientes aparecerán aquí.</p>
            </div>
          ) : (
            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden divide-y divide-slate-50">
              {history.map(item => (
                <div 
                    key={item.id} 
                    onClick={() => selectSavedLocation(item)}
                    className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 text-sm font-bold">
                       {item.name.charAt(0)}
                    </div>
                    <div>
                        <p className="font-bold text-slate-900 text-sm">{item.name}</p>
                        <p className="text-xs text-slate-500">Radio: {formatDistance(item.defaultRadius || 500)}</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300" />
                </div>
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  );

  const renderSettings = () => {
    return (
      <div className="min-h-[100dvh] bg-slate-50 flex flex-col">
         {/* Header */}
        <div className="bg-white px-6 pt-12 pb-6 border-b border-slate-100">
            <button 
            onClick={() => setStatus(AppStatus.PROFILE)} 
            className="mb-6 p-2 -ml-2 rounded-xl hover:bg-slate-50 inline-flex transition-colors"
            >
            <ArrowLeft className="w-6 h-6 text-slate-700" />
            </button>
            <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
                <div className="bg-indigo-100 p-2 rounded-xl">
                    <Bell className="w-6 h-6 text-indigo-600" />
                </div>
                Configuración
            </h2>
        </div>

        <div className="flex-1 p-6 space-y-6">
            
            {/* Volume */}
            <section className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-orange-100 rounded-lg text-orange-600">
                            <Volume2 className="w-5 h-5" />
                        </div>
                        <h3 className="font-bold text-slate-900">Volumen</h3>
                    </div>
                    <span className="text-sm font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">
                        {alarmSettings.volume}%
                    </span>
                </div>
                <input 
                    type="range" 
                    min="0" 
                    max="100" 
                    value={alarmSettings.volume}
                    onChange={(e) => setAlarmSettings({...alarmSettings, volume: Number(e.target.value)})}
                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
            </section>

            {/* Vibration */}
            <section className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="p-2 bg-purple-100 rounded-lg text-purple-600">
                        <Smartphone className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-900">Vibración</h3>
                        <p className="text-xs text-slate-500 font-medium">Patrón háptico al llegar</p>
                    </div>
                </div>
                <button 
                    onClick={() => setAlarmSettings({...alarmSettings, vibration: !alarmSettings.vibration})}
                    className={`w-14 h-8 rounded-full transition-colors relative shadow-inner ${alarmSettings.vibration ? 'bg-indigo-500' : 'bg-slate-200'}`}
                >
                    <div className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-sm transition-all duration-300 ${alarmSettings.vibration ? 'left-7' : 'left-1'}`} />
                </button>
            </section>

            {/* Intensity */}
            <section className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-yellow-100 rounded-lg text-yellow-600">
                        <Zap className="w-5 h-5" />
                    </div>
                    <h3 className="font-bold text-slate-900">Intensidad de Alarma</h3>
                </div>
                
                <div className="grid grid-cols-1 gap-3">
                    {(['soft', 'normal', 'intense'] as AlarmIntensity[]).map((level) => (
                        <button
                            key={level}
                            onClick={() => setAlarmSettings({...alarmSettings, intensity: level})}
                            className={`p-4 rounded-2xl border-2 text-left transition-all flex items-center justify-between relative overflow-hidden ${
                                alarmSettings.intensity === level 
                                ? 'border-indigo-500 bg-indigo-50/50' 
                                : 'border-slate-100 hover:border-slate-200'
                            }`}
                        >
                            <div className="relative z-10">
                                <span className="block font-bold text-slate-900 capitalize text-lg">
                                    {level === 'soft' ? 'Suave' : level === 'normal' ? 'Normal' : 'Intensa'}
                                </span>
                                <span className="text-xs text-slate-500 font-medium mt-1 block">
                                    {level === 'soft' ? 'Voz calmada y pausas largas' : 
                                     level === 'normal' ? 'Equilibrado y claro' : 'Voz enérgica y rápida'}
                                </span>
                            </div>
                            {alarmSettings.intensity === level && (
                                <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white shadow-lg shadow-indigo-200">
                                    <Check className="w-5 h-5" />
                                </div>
                            )}
                        </button>
                    ))}
                </div>
            </section>

        </div>
      </div>
    );
  };

  const renderSearching = () => (
    <div className="flex flex-col items-center justify-center min-h-[80vh] relative p-6">
      <div className="relative mb-8">
        <div className="absolute inset-0 bg-indigo-500/20 blur-xl rounded-full"></div>
        <div className="relative bg-white p-4 rounded-3xl shadow-xl shadow-indigo-100">
            <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
        </div>
      </div>
      <h3 className="text-xl font-bold text-slate-800 mb-2">Buscando destino...</h3>
      <p className="text-slate-500 font-medium text-center max-w-xs leading-relaxed">
        Consultando a Gemini para localizar las mejores coordenadas.
      </p>
      
      <button 
        onClick={() => setStatus(AppStatus.IDLE)}
        className="mt-12 flex items-center gap-2 text-slate-500 hover:text-red-500 bg-slate-100 px-6 py-3 rounded-2xl transition-all font-semibold text-sm hover:bg-red-50"
      >
        <X className="w-4 h-4" /> Cancelar búsqueda
      </button>
    </div>
  );

  const renderConfirming = () => {
    const isFavorite = isSaved(alarmConfig?.target);

    return (
      <div className="flex flex-col h-[100dvh] bg-slate-50">
        <div className="h-[45%] w-full relative">
          <MapDisplay 
              currentLocation={currentLocation} 
              targetLocation={alarmConfig?.target || null}
              radius={alarmConfig?.radius || 500}
          />
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white to-transparent pointer-events-none z-[400]"></div>
          <button 
              onClick={() => setStatus(AppStatus.IDLE)}
              className="absolute top-4 left-4 bg-white/90 backdrop-blur-md p-3 rounded-2xl shadow-lg shadow-slate-900/5 z-[401] hover:scale-105 transition-all"
          >
              <ArrowLeft className="w-6 h-6 text-slate-800" />
          </button>
        </div>
        
        <div className="h-[55%] bg-white rounded-t-[2.5rem] -mt-10 relative z-10 px-8 pt-8 pb-6 flex flex-col shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
          <div className="w-16 h-1.5 bg-slate-200 rounded-full mx-auto mb-8"></div>
          
          <div className="flex justify-between items-start mb-2">
             <h2 className="text-3xl font-bold text-slate-900 flex-1 mr-4 leading-tight">{alarmConfig?.target.name}</h2>
             <button 
                onClick={() => alarmConfig && toggleSavedPlace(alarmConfig.target)}
                className={`p-3 rounded-2xl transition-all ${isFavorite ? 'bg-rose-50 text-rose-500 shadow-inner' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
             >
                <Heart className={`w-7 h-7 ${isFavorite ? 'fill-current' : ''}`} />
             </button>
          </div>
          
          <p className="text-slate-500 font-medium mb-8 text-sm">{alarmConfig?.target.address}</p>
          
          <div className="bg-indigo-50 p-6 rounded-3xl mb-auto border border-indigo-100/50">
              <div className="flex justify-between items-center mb-4">
                  <span className="text-sm font-bold text-indigo-900 uppercase tracking-wider">Radio de Alarma</span>
                  <span className="text-lg font-black text-indigo-600">{formatDistance(alarmConfig?.radius || 500)}</span>
              </div>
              <input 
                  type="range" 
                  min="100" 
                  max="2000" 
                  step="100"
                  value={alarmConfig?.radius}
                  onChange={(e) => setAlarmConfig(prev => prev ? ({...prev, radius: Number(e.target.value)}) : null)}
                  className="w-full h-2 bg-indigo-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
              <p className="text-xs text-indigo-400 mt-3 font-medium flex items-center gap-2">
                <Bell className="w-3 h-3" />
                Te despertaremos al entrar en esta zona.
              </p>
          </div>

          <div className="flex gap-4 mt-6">
              <button 
                  onClick={startTracking}
                  className="flex-1 bg-gradient-to-r from-indigo-600 to-violet-600 text-white py-4 rounded-2xl text-lg font-bold shadow-xl shadow-indigo-500/30 hover:shadow-indigo-500/50 active:scale-[0.98] transition-all flex items-center justify-center gap-3"
              >
                  <Navigation className="w-6 h-6 fill-white/20" />
                  Iniciar Ruta
              </button>
          </div>
        </div>
      </div>
    );
  };

  const renderTracking = () => (
    <div className="flex flex-col h-[100dvh] bg-slate-900 text-white relative font-sans overflow-hidden">
      {/* Map Section - Takes 60% of the screen, clean visual */}
      <div className="relative flex-1 w-full bg-slate-800 z-0">
        <MapDisplay 
            currentLocation={currentLocation} 
            targetLocation={alarmConfig?.target || null}
            radius={alarmConfig?.radius || 500}
            zoom={15} // Closer zoom for tracking
        />
        {/* Subtle gradient at bottom of map for text readability */}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-900 to-transparent pointer-events-none z-[400]" />
      </div>

      {/* Info Section - Bottom Sheet Style */}
      <div className="relative z-10 bg-slate-900 -mt-6 rounded-t-[2.5rem] px-6 pt-8 pb-8 flex flex-col shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
         <div className="w-12 h-1 bg-slate-700 rounded-full mx-auto mb-6 opacity-50" />
         
         <div className="w-full max-w-md mx-auto">
            <div className="flex items-center justify-between mb-8">
                <div>
                   <div className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 px-3 py-1.5 rounded-full text-indigo-300 text-xs font-bold uppercase tracking-widest mb-2">
                      <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>
                      En Ruta
                   </div>
                   <h2 className="text-2xl font-bold text-white truncate max-w-[200px]">{alarmConfig?.target.name}</h2>
                </div>
                <div className="text-right">
                    <div className="text-4xl font-black tracking-tight text-white tabular-nums">
                        {currentDistance !== null ? formatDistance(currentDistance) : '...'}
                    </div>
                    <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">Distancia</p>
                </div>
            </div>

            <div className="h-16 w-full mb-8 opacity-40">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={distanceHistory}>
                        <YAxis domain={['auto', 'auto']} hide />
                        <Line 
                            type="monotone" 
                            dataKey="distance" 
                            stroke="#818cf8" 
                            strokeWidth={3} 
                            dot={false}
                            isAnimationActive={false}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>

            <button 
                onClick={stopTracking}
                className="w-full bg-slate-800 text-white py-4 rounded-2xl text-lg font-bold border border-slate-700 hover:bg-rose-500/10 hover:border-rose-500/50 hover:text-rose-400 transition-all flex items-center justify-center gap-3 group active:scale-[0.98]"
            >
                <StopCircle className="w-6 h-6 text-slate-500 group-hover:text-rose-400 transition-colors" />
                Cancelar Alarma
            </button>
         </div>
      </div>
    </div>
  );

  const renderAlarm = () => (
    <div className={`fixed inset-0 text-white z-50 flex flex-col items-center justify-center p-8 transition-colors duration-500 ${
        alarmSettings.intensity === 'intense' ? 'bg-rose-600' : 
        alarmSettings.intensity === 'soft' ? 'bg-indigo-400' :
        'bg-violet-600'
    }`}>
      {/* Background Pulse Animation */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-white opacity-20 rounded-full animate-ping"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-white opacity-30 rounded-full animate-pulse delay-75"></div>
      </div>

      <div className="relative z-10 flex flex-col items-center">
          <div className="w-32 h-32 bg-white rounded-full flex items-center justify-center mb-10 shadow-2xl animate-bounce">
            <Volume2 className={`w-16 h-16 ${
                alarmSettings.intensity === 'intense' ? 'text-rose-600' : 
                alarmSettings.intensity === 'soft' ? 'text-indigo-400' :
                'text-violet-600'
            }`} />
          </div>
          
          <h1 className="text-6xl font-black text-center mb-4 tracking-tighter drop-shadow-lg">¡LLEGASTE!</h1>
          <p className="text-2xl font-medium text-center mb-16 opacity-90 max-w-sm leading-relaxed">
            Ya estás cerca de <br/><span className="font-bold">{alarmConfig?.target.name}</span>
          </p>
          
          <button 
              onClick={stopTracking}
              className="w-full max-w-xs bg-white text-slate-900 py-6 rounded-[2rem] text-xl font-bold shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-3"
          >
              <Check className="w-6 h-6" />
              ¡Estoy despierto!
          </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] bg-white font-sans antialiased text-slate-900 selection:bg-indigo-100 selection:text-indigo-900">
      {status === AppStatus.IDLE && renderIdle()}
      {status === AppStatus.PROFILE && renderProfile()}
      {status === AppStatus.SETTINGS && renderSettings()}
      {status === AppStatus.SEARCHING && renderSearching()}
      {status === AppStatus.CONFIRMING && renderConfirming()}
      {status === AppStatus.TRACKING && renderTracking()}
      {status === AppStatus.ALARM_TRIGGERED && renderAlarm()}
    </div>
  );
};

export default App;