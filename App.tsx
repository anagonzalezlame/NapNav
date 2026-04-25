import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  MapPin, Navigation, Bell, Search, StopCircle, Volume2, 
  AlertCircle, RefreshCw, Loader2, ArrowLeft, X, User, 
  Settings, Heart, Trash2, History, ChevronRight, Zap, Smartphone, Check,
  Moon, Sun, Key, MessageSquare
} from 'lucide-react';
import { useAgent } from './contexts/AgentContext';
import { AgentChat } from './components/AgentChat';
import { motion, AnimatePresence } from 'framer-motion';
import { generateAlarmAudio, getPlaceSuggestions } from './services/gemini';
import { calculateDistance, formatDistance } from './utils/geo';
import { AppStatus, LocationInfo, AlarmConfig, Coordinates, SavedPlace, AlarmSettings, AlarmIntensity, PendingAction } from './types';
import MapDisplay from './components/MapDisplay';

const App: React.FC = () => {
  // Agent Context
  const { mission, pendingActions, addPendingAction, removePendingAction, mood, setMood } = useAgent();

  // State
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  
  const [locationError, setLocationError] = useState<string | null>(null);
  const [currentLocation, setCurrentLocation] = useState<Coordinates | null>(null);
  const [useHighAccuracy, setUseHighAccuracy] = useState(true); // Preference

  const [alarms, setAlarms] = useState<AlarmConfig[]>([]);
  const [activeAlarm, setActiveAlarm] = useState<AlarmConfig | null>(null);
  const [draftAlarm, setDraftAlarm] = useState<Partial<AlarmConfig> | null>(null);
  
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
  const beepTimeoutRef = useRef<number | null>(null);

  // Load from LocalStorage
  useEffect(() => {
    const loadedPlaces = localStorage.getItem('napnav_places');
    const loadedHistory = localStorage.getItem('napnav_history');
    const loadedSettings = localStorage.getItem('napnav_settings');
    const loadedAlarms = localStorage.getItem('napnav_alarms');
    
    if (loadedPlaces) setSavedPlaces(JSON.parse(loadedPlaces));
    if (loadedHistory) setHistory(JSON.parse(loadedHistory));
    if (loadedSettings) setAlarmSettings(JSON.parse(loadedSettings));
    if (loadedAlarms) setAlarms(JSON.parse(loadedAlarms));
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

  useEffect(() => {
    localStorage.setItem('napnav_alarms', JSON.stringify(alarms));
  }, [alarms]);

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
          const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&viewbox=-56.4,-34.7,-56.0,-34.9&bounded=1`, {
            headers: {
              'User-Agent': 'NapNav/1.0 (anitagl@gmail.com)'
            }
          });
          const results = await response.json();
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
  }, [query, status]);

  const isRecurrenceValid = useCallback((recurrence: RecurrenceConfig): boolean => {
    const now = new Date();
    if (recurrence.type === 'once') return true;
    if (recurrence.type === 'always') return true;
    if (recurrence.type === 'daysOfWeek' && recurrence.days) {
      return recurrence.days.includes(now.getDay());
    }
    if (recurrence.type === 'untilDate' && recurrence.until) {
      const untilDate = new Date(recurrence.until);
      // Compare dates ignoring time
      untilDate.setHours(23, 59, 59, 999);
      return now <= untilDate;
    }
    return true;
  }, []);

  // Distance Tracking (Background Check)
  useEffect(() => {
    if (!currentLocation || status === AppStatus.ALARM_TRIGGERED) return;

    const enabledAlarms = alarms.filter(a => a.enabled && isRecurrenceValid(a.recurrence));
    
    if (enabledAlarms.length === 0) {
      if (status === AppStatus.TRACKING) {
        setStatus(AppStatus.IDLE);
      }
      return;
    }

    let triggered: AlarmConfig | null = null;
    let minDistance = Infinity;
    let closestAlarm: AlarmConfig | null = null;

    for (const alarm of enabledAlarms) {
      const dist = calculateDistance(currentLocation, alarm.target);
      if (dist < minDistance) {
        minDistance = dist;
        closestAlarm = alarm;
      }
      
      if (dist <= alarm.radius) {
        triggered = alarm;
        break;
      }
    }

    if (minDistance !== Infinity) {
      setCurrentDistance(minDistance);
      setDistanceHistory((prev) => {
        const newData = [...prev, { distance: minDistance, time: Date.now() }];
        return newData.slice(-20);
      });
    }

    // Update active alarm for tracking view if needed
    if (status === AppStatus.TRACKING && closestAlarm && (!activeAlarm || activeAlarm.id !== closestAlarm.id)) {
      setActiveAlarm(closestAlarm);
    }

    if (triggered) {
      triggerAlarm(triggered);
    }
  }, [currentLocation, status, alarms, isRecurrenceValid, activeAlarm]);

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

  // Reset query when returning to IDLE
  useEffect(() => {
    if (status === AppStatus.IDLE) {
      setQuery('');
    }
  }, [status]);

  // Proactive Agent Monitoring
  useEffect(() => {
    if (mission?.eta && mission?.eventTime) {
      // Simple parse for time format (HH:MM)
      const parseTime = (t: string) => {
        const parts = t.match(/(\d+):(\d+)/);
        if (!parts) return null;
        return parseInt(parts[1]) * 60 + parseInt(parts[2]);
      };

      const etaVal = parseTime(mission.eta);
      const eventVal = parseTime(mission.eventTime);

      if (etaVal !== null && eventVal !== null && etaVal > eventVal + 5) {
        const alreadyNotified = pendingActions.some(a => a.id === 'eta-delay-alert');
        if (!alreadyNotified) {
          addPendingAction({
            id: 'eta-delay-alert',
            type: 'notification',
            description: `Se detectó una demora. Llegada estimada: ${mission.eta}. El evento inicia: ${mission.eventTime}. ¿Deseas avisar a quienes integran el grupo Rhea?`,
            data: { group: mission.context || 'Rhea' }
          });
        }
      }
    }
  }, [mission, pendingActions, addPendingAction]);

  // --- Logic Functions ---

  const executeSearch = async (searchQuery: string, radiusOverride?: number) => {
    if (!searchQuery.trim()) return;

    // Quitar el foco del input para ocultar el teclado en móviles
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    setStatus(AppStatus.SEARCHING);
    setShowSuggestions(false);
    setQuery(''); // Limpiar el input al confirmar
    
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&viewbox=-56.4,-34.7,-56.0,-34.9&bounded=1`, {
        headers: {
          'User-Agent': 'NapNav/1.0 (anitagl@gmail.com)'
        }
      });
      const results = await response.json();
      
      if (!results || results.length === 0) {
        throw new Error("No results");
      }
      
      const suggestion = results[0];
      const location: LocationInfo = {
        name: suggestion.display_name.split(',')[0],
        address: suggestion.display_name,
        lat: parseFloat(suggestion.lat),
        lng: parseFloat(suggestion.lon)
      };

      // Generate text script instead of audio bytes
      const alarmScript = await generateAlarmAudio(location.name, alarmSettings.intensity);

      if (alarmScript === "FALLBACK_BEEP") {
        alert("Servidor de voz saturado, usando alerta básica");
      }

      setDraftAlarm({
        target: location,
        radius: radiusOverride || 500, 
        alarmMessage: alarmScript,
        recurrence: { type: 'once' }
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
      const alarmScript = await generateAlarmAudio(place.name, alarmSettings.intensity);
      
      if (alarmScript === "FALLBACK_BEEP") {
        alert("Servidor de voz saturado, usando alerta básica");
      }

      setDraftAlarm({
        target: place,
        radius: place.defaultRadius || 500,
        alarmMessage: alarmScript,
        recurrence: { type: 'once' }
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

  const handleSuggestionClick = async (suggestion: any) => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    setStatus(AppStatus.SEARCHING);
    setShowSuggestions(false);
    setQuery(''); // Limpiar el input al confirmar
    
    try {
      const location: LocationInfo = {
        name: suggestion.display_name.split(',')[0],
        address: suggestion.display_name,
        lat: parseFloat(suggestion.lat),
        lng: parseFloat(suggestion.lon)
      };

      const alarmScript = await generateAlarmAudio(location.name, alarmSettings.intensity);

      if (alarmScript === "FALLBACK_BEEP") {
        alert("Servidor de voz saturado, usando alerta básica");
      }

      setDraftAlarm({
        target: location,
        radius: 500, 
        alarmMessage: alarmScript,
        recurrence: { type: 'once' }
      });
      setStatus(AppStatus.CONFIRMING);
    } catch (error) {
      console.error(error);
      alert("No pudimos configurar la alarma. Inténtalo de nuevo.");
      setStatus(AppStatus.IDLE);
    }
  };

  const saveAlarm = async () => {
    if (!draftAlarm || !draftAlarm.target || !draftAlarm.radius || !draftAlarm.alarmMessage || !draftAlarm.recurrence) return;
    
    // "Prime" the speech synthesis engine on user interaction
    window.speechSynthesis.cancel();
    const silent = new SpeechSynthesisUtterance("");
    silent.volume = 0;
    window.speechSynthesis.speak(silent);

    await requestWakeLock();

    const newAlarm: AlarmConfig = {
      id: Date.now().toString(),
      enabled: true,
      target: draftAlarm.target,
      radius: draftAlarm.radius,
      alarmMessage: draftAlarm.alarmMessage,
      recurrence: draftAlarm.recurrence
    };

    setAlarms(prev => [...prev, newAlarm]);

    // Add to history
    const newHistoryItem: SavedPlace = {
      ...draftAlarm.target,
      id: Date.now().toString(),
      dateAdded: Date.now(),
      defaultRadius: draftAlarm.radius
    };
    
    setHistory(prev => {
      const filtered = prev.filter(p => p.name !== newHistoryItem.name);
      return [newHistoryItem, ...filtered].slice(0, 5);
    });

    setDraftAlarm(null);
    setStatus(AppStatus.ALARMS_LIST);
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

  const triggerAlarm = (alarm: AlarmConfig) => {
    setActiveAlarm(alarm);
    setStatus(AppStatus.ALARM_TRIGGERED);
    playAlarmSound(alarm);
    startVibration();
    
    // If it's a 'once' alarm, disable it
    if (alarm.recurrence.type === 'once') {
      setAlarms(prev => prev.map(a => a.id === alarm.id ? { ...a, enabled: false } : a));
    }
  };

  const playAlarmSound = (alarm: AlarmConfig) => {
    if (!alarm?.alarmMessage) return;

    // Stop any existing speech or beep
    stopAlarmSound();

    if (alarm.alarmMessage === "FALLBACK_BEEP") {
      const playBeep = () => {
        try {
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const oscillator = audioCtx.createOscillator();
          const gainNode = audioCtx.createGain();
          
          oscillator.type = 'sine';
          // Adjust frequency based on intensity
          if (alarmSettings.intensity === 'soft') oscillator.frequency.setValueAtTime(440, audioCtx.currentTime);
          else if (alarmSettings.intensity === 'intense') oscillator.frequency.setValueAtTime(1046.50, audioCtx.currentTime);
          else oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
          
          gainNode.gain.setValueAtTime(alarmSettings.volume / 100, audioCtx.currentTime);
          
          oscillator.connect(gainNode);
          gainNode.connect(audioCtx.destination);
          
          oscillator.start();
          oscillator.stop(audioCtx.currentTime + 0.5);
          
          oscillator.onended = () => {
            if (status === AppStatus.ALARM_TRIGGERED) {
              beepTimeoutRef.current = window.setTimeout(() => {
                if (status === AppStatus.ALARM_TRIGGERED) {
                  playBeep();
                }
              }, 500);
            }
          };
        } catch (e) {
          console.error("Error playing beep", e);
        }
      };
      playBeep();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(alarm.alarmMessage);
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
    if (beepTimeoutRef.current) {
      clearTimeout(beepTimeoutRef.current);
      beepTimeoutRef.current = null;
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

  const renderAlarmsList = () => (
    <div className="min-h-[100dvh] bg-slate-50 flex flex-col font-sans">
      <div className="bg-white px-6 pt-12 pb-8 rounded-b-[2.5rem] shadow-sm border-b border-slate-100 relative z-10">
        <div className="flex items-center justify-between mb-8">
            <button 
                onClick={() => setStatus(AppStatus.IDLE)} 
                className="p-3 -ml-2 rounded-2xl hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-colors"
            >
                <ArrowLeft className="w-6 h-6" />
            </button>
        </div>
        
        <div className="flex items-center gap-5">
            <div className="w-20 h-20 bg-gradient-to-br from-indigo-100 to-violet-100 rounded-3xl flex items-center justify-center border-4 border-white shadow-lg shadow-indigo-100">
                <Bell className="w-10 h-10 text-indigo-600" />
            </div>
            <div>
                <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Mis Alarmas</h2>
                <p className="text-slate-500 font-medium">{alarms.length} guardadas</p>
            </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {alarms.length === 0 ? (
          <div className="text-center py-10 bg-white rounded-3xl border border-dashed border-slate-200">
            <Bell className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-slate-400 font-medium text-sm">No tienes alarmas configuradas.</p>
          </div>
        ) : (
          alarms.map(alarm => (
            <div key={alarm.id} className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 flex flex-col gap-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold text-slate-900 text-lg">{alarm.target.name}</h3>
                  <p className="text-xs text-slate-500">{formatDistance(alarm.radius)} • {
                    alarm.recurrence.type === 'once' ? 'Una vez' :
                    alarm.recurrence.type === 'always' ? 'Siempre' :
                    alarm.recurrence.type === 'daysOfWeek' ? 'Días específicos' : 'Hasta fecha'
                  }</p>
                </div>
                <button 
                  onClick={() => setAlarms(prev => prev.map(a => a.id === alarm.id ? { ...a, enabled: !a.enabled } : a))}
                  className={`w-14 h-8 rounded-full transition-colors relative shadow-inner shrink-0 ${alarm.enabled ? 'bg-indigo-500' : 'bg-slate-200'}`}
                >
                  <div className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-sm transition-all duration-300 ${alarm.enabled ? 'left-7' : 'left-1'}`} />
                </button>
              </div>
              <div className="flex gap-2 border-t border-slate-50 pt-4">
                <button 
                  onClick={() => {
                    setDraftAlarm(alarm);
                    setStatus(AppStatus.CONFIRMING);
                    // Also remove the old one so it gets replaced, or handle update in saveAlarm
                    setAlarms(prev => prev.filter(a => a.id !== alarm.id));
                  }}
                  className="flex-1 py-2 bg-slate-50 text-slate-600 rounded-xl font-medium text-sm hover:bg-slate-100 transition-colors"
                >
                  Editar
                </button>
                <button 
                  onClick={() => setAlarms(prev => prev.filter(a => a.id !== alarm.id))}
                  className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-colors"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderIdle = () => (
    <div className="relative flex flex-col items-center justify-center min-h-[100dvh] overflow-hidden bg-slate-50">
      {/* Background */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 opacity-40 grayscale-[0.8] brightness-105">
          <MapDisplay center={{ lat: -34.9011, lng: -56.1645 }} zoom={13} />
        </div>
        {/* Improved overlay for legibility */}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-50/95 via-slate-50/75 to-slate-50/95 backdrop-blur-sm"></div>
      </div>

      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 p-6 flex justify-between z-20">
        <button 
          onClick={() => setStatus(AppStatus.ALARMS_LIST)}
          className="bg-white/90 backdrop-blur-md p-3 rounded-2xl shadow-lg shadow-indigo-500/10 hover:shadow-indigo-500/20 hover:scale-105 transition-all text-slate-700 border border-white/50 flex items-center gap-2"
        >
          <Bell className="w-6 h-6" />
          {alarms.filter(a => a.enabled).length > 0 && (
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
          )}
        </button>
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
        <h1 className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-600 mb-3 tracking-tighter animate-gradient-x">
          NapNav
        </h1>
        <p className="text-slate-500 font-medium text-center mb-12 max-w-xs leading-relaxed">
          NapNav: Tu secretaria personal de movilidad. Te cuidamos mientras descansas.
        </p>
        
        <AgentChat onLocationFound={(location) => {
          setDraftAlarm({
            target: location,
            radius: 500,
            alarmMessage: `Hola,NapNav te avisa que estamos llegando a ${location.name}. Todo bajo control según tu plan.`,
            recurrence: { type: 'once' }
          });
          setStatus(AppStatus.CONFIRMING);
        }} />

        {/* Global Agent Alerts Overlay */}
        <AnimatePresence>
          {pendingActions.length > 0 && (
            <div className="fixed bottom-24 left-6 right-6 z-50 space-y-3">
              {pendingActions.map(action => (
                <div key={action.id} className="bg-white/95 backdrop-blur-xl border border-indigo-100 p-4 rounded-2xl shadow-2xl flex items-start gap-4">
                  <div className="bg-amber-100 p-2 rounded-xl text-amber-600">
                    <AlertCircle className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-700 leading-tight mb-2">
                      {action.description}
                    </p>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => {
                          alert(`Enviando notificación a ${action.data.group}...`);
                          removePendingAction(action.id);
                        }}
                        className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold"
                      >
                        Confirmar Envío
                      </button>
                      <button 
                        onClick={() => removePendingAction(action.id)}
                        className="bg-slate-100 text-slate-500 px-3 py-1.5 rounded-lg text-xs font-bold"
                      >
                        Ignorar
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </AnimatePresence>

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
      <h3 className="text-xl font-bold text-slate-800 mb-2">Buscando ubicación para la persona usuaria...</h3>
      <p className="text-slate-500 font-medium text-center max-w-xs leading-relaxed">
        Consultando a Nominatim para localizar las mejores coordenadas.
      </p>
      
      <button 
        onClick={() => setStatus(AppStatus.IDLE)}
        className="mt-12 flex items-center gap-2 text-slate-900 bg-white shadow-xl shadow-slate-200/50 px-8 py-4 rounded-2xl transition-all font-bold text-sm hover:bg-slate-50 active:scale-95 border border-slate-100"
      >
        <X className="w-5 h-5" /> Cancelar búsqueda
      </button>
    </div>
  );

  const renderConfirming = () => {
    const isFavorite = isSaved(draftAlarm?.target);

    return (
      <div className="flex flex-col h-[100dvh] bg-slate-50">
        <div className="h-[35%] w-full relative">
          <MapDisplay 
              currentLocation={currentLocation} 
              targetLocation={draftAlarm?.target || null}
              radius={draftAlarm?.radius || 500}
          />
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white to-transparent pointer-events-none z-[400]"></div>
          <button 
              onClick={() => setStatus(AppStatus.IDLE)}
              className="absolute top-4 left-4 bg-white/90 backdrop-blur-md p-3 rounded-2xl shadow-lg shadow-slate-900/5 z-[401] hover:scale-105 transition-all"
          >
              <ArrowLeft className="w-6 h-6 text-slate-800" />
          </button>
        </div>
        
        <div className="h-[65%] bg-white rounded-t-[2.5rem] -mt-10 relative z-10 px-8 pt-8 pb-6 flex flex-col shadow-[0_-10px_40px_rgba(0,0,0,0.05)] overflow-y-auto">
          <div className="w-16 h-1.5 bg-slate-200 rounded-full mx-auto mb-8 shrink-0"></div>
          
          <div className="flex justify-between items-start mb-2">
             <h2 className="text-3xl font-bold text-slate-900 flex-1 mr-4 leading-tight">{draftAlarm?.target?.name}</h2>
             <button 
                onClick={() => draftAlarm?.target && toggleSavedPlace(draftAlarm.target)}
                className={`p-3 rounded-2xl transition-all ${isFavorite ? 'bg-rose-50 text-rose-500 shadow-inner' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
             >
                <Heart className={`w-7 h-7 ${isFavorite ? 'fill-current' : ''}`} />
             </button>
          </div>
          
          <p className="text-slate-500 font-medium mb-6 text-sm">{draftAlarm?.target?.address}</p>
          
          <div className="bg-indigo-50 p-5 rounded-3xl mb-4 border border-indigo-100/50">
              <div className="flex justify-between items-center mb-4">
                  <span className="text-sm font-bold text-indigo-900 uppercase tracking-wider">Radio de Alarma</span>
                  <span className="text-lg font-black text-indigo-600">{formatDistance(draftAlarm?.radius || 500)}</span>
              </div>
              <input 
                  type="range" 
                  min="100" 
                  max="2000" 
                  step="100"
                  value={draftAlarm?.radius}
                  onChange={(e) => setDraftAlarm(prev => prev ? ({...prev, radius: Number(e.target.value)}) : null)}
                  className="w-full h-2 bg-indigo-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
          </div>

          <div className="bg-slate-50 p-5 rounded-3xl mb-auto border border-slate-100">
              <span className="text-sm font-bold text-slate-700 uppercase tracking-wider block mb-3">Recurrencia</span>
              <select 
                value={draftAlarm?.recurrence?.type || 'once'}
                onChange={(e) => setDraftAlarm(prev => prev ? ({...prev, recurrence: { type: e.target.value as any, days: e.target.value === 'daysOfWeek' ? [1,2,3,4,5] : undefined }}) : null)}
                className="w-full bg-white border border-slate-200 text-slate-700 rounded-xl px-4 py-3 font-medium outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all mb-3"
              >
                <option value="once">Solo una vez</option>
                <option value="always">Siempre activa</option>
                <option value="daysOfWeek">Días específicos</option>
                <option value="untilDate">Hasta una fecha</option>
              </select>

              {draftAlarm?.recurrence?.type === 'daysOfWeek' && (
                <div className="flex justify-between gap-1 mt-2">
                  {['D', 'L', 'M', 'M', 'J', 'V', 'S'].map((day, idx) => {
                    const isSelected = draftAlarm.recurrence?.days?.includes(idx);
                    return (
                      <button
                        key={idx}
                        onClick={() => {
                          setDraftAlarm(prev => {
                            if (!prev || !prev.recurrence) return prev;
                            const days = prev.recurrence.days || [];
                            const newDays = days.includes(idx) ? days.filter(d => d !== idx) : [...days, idx];
                            return { ...prev, recurrence: { ...prev.recurrence, days: newDays } };
                          });
                        }}
                        className={`w-10 h-10 rounded-full font-bold text-sm flex items-center justify-center transition-all ${isSelected ? 'bg-indigo-500 text-white shadow-md' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'}`}
                      >
                        {day}
                      </button>
                    )
                  })}
                </div>
              )}

              {draftAlarm?.recurrence?.type === 'untilDate' && (
                <input 
                  type="date"
                  value={draftAlarm.recurrence.until || ''}
                  onChange={(e) => setDraftAlarm(prev => prev ? ({...prev, recurrence: { ...prev.recurrence!, until: e.target.value }}) : null)}
                  className="w-full bg-white border border-slate-200 text-slate-700 rounded-xl px-4 py-3 font-medium outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all"
                />
              )}
          </div>

          <div className="flex gap-4 mt-6 shrink-0">
              <button 
                  onClick={saveAlarm}
                  className="flex-1 bg-gradient-to-r from-indigo-600 to-violet-600 text-white py-4 rounded-2xl text-lg font-bold shadow-xl shadow-indigo-500/30 hover:shadow-indigo-500/50 active:scale-[0.98] transition-all flex items-center justify-center gap-3"
              >
                  <Check className="w-6 h-6 fill-white/20" />
                  Guardar Alarma
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
            targetLocation={activeAlarm?.target || null}
            radius={activeAlarm?.radius || 500}
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
                   <h2 className="text-2xl font-bold text-white truncate max-w-[200px]">{activeAlarm?.target?.name || 'Buscando...'}</h2>
                </div>
                <div className="text-right">
                    <div className="text-4xl font-black tracking-tight text-white tabular-nums drop-shadow-[0_0_15px_rgba(129,140,248,0.8)]">
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
                onClick={() => setStatus(AppStatus.IDLE)}
                className="w-full bg-slate-800 text-white py-4 rounded-2xl text-lg font-bold border border-slate-700 hover:bg-slate-700 transition-all flex items-center justify-center gap-3 group active:scale-[0.98]"
            >
                <ArrowLeft className="w-6 h-6 text-slate-500 group-hover:text-white transition-colors" />
                Volver al inicio
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
            Ya estás cerca de <br/><span className="font-bold">{activeAlarm?.target?.name}</span>
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
      {status === AppStatus.ALARMS_LIST && renderAlarmsList()}
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