import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  MapPin, Navigation, Bell, Search, StopCircle, Volume2, 
  AlertCircle, RefreshCw, Loader2, ArrowLeft, X, User as UserIcon, 
  Settings, Heart, Trash2, History, ChevronRight, Zap, Smartphone, Check,
  Moon, Sun, Key, MessageSquare, LogOut, LogIn
} from 'lucide-react';
import { useAgent } from './contexts/AgentContext';
import { motion, AnimatePresence } from 'framer-motion';
import { generateAlarmAudio, getPlaceSuggestions } from './services/gemini';
import { calculateDistance, formatDistance } from './utils/geo';
import { AppStatus, LocationInfo, AlarmConfig, Coordinates, SavedPlace, AlarmSettings, AlarmIntensity, PendingAction } from './types';
import MapDisplay from './components/MapDisplay';
import { auth, db, signInWithGoogle, logout, handleFirestoreError, OperationType } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  doc, setDoc, getDoc, collection, onSnapshot, 
  serverTimestamp, deleteDoc, writeBatch 
} from 'firebase/firestore';

const App: React.FC = () => {
  // Agent Context
  const { mission, pendingActions, addPendingAction, removePendingAction, mood, setMood } = useAgent();

  // Auth State
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

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
  const [alarmSettings, setAlarmSettings] = useState<AlarmSettings>(() => {
    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return {
      volume: 100,
      vibration: true,
      intensity: 'normal',
      darkMode: isDark
    };
  });

  // Refs
  const vibrationIntervalRef = useRef<number | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);
  const debounceRef = useRef<number | null>(null);
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);
  const beepTimeoutRef = useRef<number | null>(null);
  const initialSyncDone = useRef(false);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
      
      if (currentUser) {
        // Ensure user profile exists
        const userDocRef = doc(db, 'users', currentUser.uid);
        getDoc(userDocRef).then((snap) => {
          if (!snap.exists()) {
            setDoc(userDocRef, {
              userId: currentUser.uid,
              email: currentUser.email,
              displayName: currentUser.displayName,
              photoURL: currentUser.photoURL,
              updatedAt: serverTimestamp(),
              settings: alarmSettings
            }, { merge: true }).catch(err => handleFirestoreError(err, OperationType.WRITE, `users/${currentUser.uid}`));
          }
        });
      } else {
        initialSyncDone.current = false;
      }
    });
    return () => unsubscribe();
  }, []);

  // Firebase Real-time Sync
  useEffect(() => {
    if (!user) return;

    const userPath = `users/${user.uid}`;
    
    // Sync Settings
    const unsubSettings = onSnapshot(doc(db, userPath), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.settings) {
          setAlarmSettings(prev => ({ ...prev, ...data.settings }));
        }
      }
    }, (err) => handleFirestoreError(err, OperationType.GET, userPath));

    // Sync Saved Places
    const unsubPlaces = onSnapshot(collection(db, `${userPath}/savedPlaces`), (snap) => {
      const places: SavedPlace[] = [];
      snap.forEach(doc => places.push(doc.data() as SavedPlace));
      setSavedPlaces(places.sort((a, b) => b.dateAdded - a.dateAdded));
    }, (err) => handleFirestoreError(err, OperationType.GET, `${userPath}/savedPlaces`));

    // Sync History
    const unsubHistory = onSnapshot(collection(db, `${userPath}/history`), (snap) => {
      const historyItems: SavedPlace[] = [];
      snap.forEach(doc => historyItems.push(doc.data() as SavedPlace));
      // Enforce unique by name and limit to 5
      const sorted = historyItems.sort((a, b) => b.dateAdded - a.dateAdded);
      const unique: SavedPlace[] = [];
      const seen = new Set();
      for (const item of sorted) {
        const key = item.name?.trim().toLowerCase() || item.id;
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(item);
        }
        if (unique.length >= 5) break;
      }
      setHistory(unique);
    }, (err) => handleFirestoreError(err, OperationType.GET, `${userPath}/history`));

    // Sync Alarms
    const unsubAlarms = onSnapshot(collection(db, `${userPath}/alarms`), (snap) => {
      const alarmItems: AlarmConfig[] = [];
      snap.forEach(doc => alarmItems.push(doc.data() as AlarmConfig));
      setAlarms(alarmItems);
    }, (err) => handleFirestoreError(err, OperationType.GET, `${userPath}/alarms`));

    return () => {
      unsubSettings();
      unsubPlaces();
      unsubHistory();
      unsubAlarms();
    };
  }, [user]);

  // Migrate local data to Firebase on login
  useEffect(() => {
    if (user && !initialSyncDone.current) {
      const migrate = async () => {
        const batch = writeBatch(db);
        const userPath = `users/${user.uid}`;

        // Migrate settings if different
        const settingsDoc = doc(db, userPath);
        batch.set(settingsDoc, { settings: alarmSettings, updatedAt: serverTimestamp() }, { merge: true });

        // Migrate places
        savedPlaces.forEach(p => {
          const pDoc = doc(db, `${userPath}/savedPlaces`, p.id);
          batch.set(pDoc, p);
        });

        // Migrate history
        history.forEach(h => {
          const hDoc = doc(db, `${userPath}/history`, h.id);
          batch.set(hDoc, h);
        });

        // Migrate alarms
        alarms.forEach(a => {
          const aDoc = doc(db, `${userPath}/alarms`, a.id);
          batch.set(aDoc, a);
        });

        try {
          await batch.commit();
          initialSyncDone.current = true;
          console.log("Datosa locales migrados a Firebase exitosamente.");
        } catch (e) {
          console.error("Error migrando datos:", e);
        }
      };
      
      migrate();
    }
  }, [user]);

  // Load from LocalStorage (Fallback/Initial)
  useEffect(() => {
    if (!user) {
      const loadedPlaces = localStorage.getItem('napnav_places');
      const loadedHistory = localStorage.getItem('napnav_history');
      const loadedSettings = localStorage.getItem('napnav_settings');
      const loadedAlarms = localStorage.getItem('napnav_alarms');
      
      if (loadedPlaces) setSavedPlaces(JSON.parse(loadedPlaces));
      if (loadedHistory) setHistory(JSON.parse(loadedHistory));
      if (loadedSettings) {
        const parsed = JSON.parse(loadedSettings);
        setAlarmSettings(prev => ({ ...prev, ...parsed }));
      }
      if (loadedAlarms) setAlarms(JSON.parse(loadedAlarms));
    }
  }, [user]);

  // Save to LocalStorage / Firebase
  useEffect(() => {
    if (user) {
      // Local copy as cache
      localStorage.setItem('napnav_places', JSON.stringify(savedPlaces));
    } else {
      localStorage.setItem('napnav_places', JSON.stringify(savedPlaces));
    }
  }, [savedPlaces, user]);

  useEffect(() => {
    if (user) {
      localStorage.setItem('napnav_history', JSON.stringify(history));
    } else {
      localStorage.setItem('napnav_history', JSON.stringify(history));
    }
  }, [history, user]);

  useEffect(() => {
    if (user) {
      localStorage.setItem('napnav_settings', JSON.stringify(alarmSettings));
      // Update Firebase Settings
      const userDocRef = doc(db, 'users', user.uid);
      setDoc(userDocRef, { settings: alarmSettings, updatedAt: serverTimestamp() }, { merge: true })
        .catch(err => handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`));
    } else {
      localStorage.setItem('napnav_settings', JSON.stringify(alarmSettings));
    }
    
    // Toggle dark mode class on document element
    if (alarmSettings.darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [alarmSettings, user]);

  useEffect(() => {
    if (!user) {
      localStorage.setItem('napnav_alarms', JSON.stringify(alarms));
    }
  }, [alarms, user]);

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
          let msg = "Ubicación no disponible en este momento. Por favor, intenta de nuevo.";
          switch (error.code) {
            case 1: 
              msg = "Permiso denegado. Para que NapNav funcione, habilita los permisos de ubicación en los ajustes de tu navegador."; 
              break;
            case 2: 
              msg = "Sin señal GPS. Asegúrate de estar en un lugar con cielo despejado o usa una conexión Wi-Fi estable."; 
              break;
            case 3: 
              msg = "Tiempo agotado al buscar tu posición. Intenta refrescar o verifica tu conexión a internet."; 
              break;
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
          // Using Gemini AI for context-aware autocomplete
          const suggestionsList = await getPlaceSuggestions(query, currentLocation);
          
          if (suggestionsList && suggestionsList.length > 0) {
            const mappedResults = suggestionsList.map(name => ({
              display_name: name,
            }));

            setSuggestions(mappedResults);
            setShowSuggestions(true);
          }
        } catch (e) {
          console.error("Falló el autocompletado", e);
        } finally {
          setIsSuggesting(false);
        }
      }, 250); // Reduced delay to 250ms for near-instant feedback
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
      setIsSuggesting(false);
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, status, currentLocation]);

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

  const executeSearch = async (searchQuery: string, radiusOverride: number = 500) => {
    if (!searchQuery.trim()) return;

    // Quitar el foco del input para ocultar el teclado en móviles
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    setStatus(AppStatus.SEARCHING);
    setShowSuggestions(false);
    setQuery(''); // Limpiar el input al confirmar
    
    try {
      let locationBias = '&lat=-34.9011&lon=-56.1645'; // Default to Montevideo
      if (currentLocation) {
         locationBias = `&lat=${currentLocation.lat}&lon=${currentLocation.lng}`;
      }
      const response = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(searchQuery)}&limit=1${locationBias}`);
      const results = await response.json();
      
      if (!results || !results.features || results.features.length === 0) {
        throw new Error("No results");
      }
      
      const feature = results.features[0];
      const p = feature.properties;
      const namePart = p.name || p.street || 'Ubicación';
      const locationParts = [p.city, p.state, p.country].filter(Boolean);
      const display_name = `${namePart}, ${locationParts.join(', ')}`.replace(/(^,\s*)|(,\s*$)/g, '');

      const location: LocationInfo = {
        name: namePart,
        address: display_name,
        lat: feature.geometry.coordinates[1],
        lng: feature.geometry.coordinates[0]
      };

      const alarmScript = `¡Atención! Estás llegando a ${location.name}.`;

      setDraftAlarm({
        target: location,
        radius: radiusOverride, 
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
      const alarmScript = place.alarmMessage || `¡Atención! Estás llegando a ${place.name}.`;
      
      setDraftAlarm({
        target: place,
        radius: place.defaultRadius || 500,
        alarmMessage: alarmScript,
        recurrence: place.recurrence || { type: 'once' }
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

    setShowSuggestions(false);
    setQuery(''); // Limpiar el input al confirmar
    
    // Delegate to executeSearch because suggestion is just a plain string display name now
    executeSearch(suggestion.display_name);
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
      target: draftAlarm.target as LocationInfo,
      radius: draftAlarm.radius,
      alarmMessage: draftAlarm.alarmMessage,
      recurrence: draftAlarm.recurrence
    };

    // Add to history
    const newHistoryItem: SavedPlace = {
      ...(draftAlarm.target as LocationInfo),
      id: Date.now().toString(),
      dateAdded: Date.now(),
      defaultRadius: draftAlarm.radius,
      alarmMessage: draftAlarm.alarmMessage,
      recurrence: draftAlarm.recurrence
    };

    if (user) {
      const userPath = `users/${user.uid}`;
      await setDoc(doc(db, `${userPath}/alarms`, newAlarm.id), newAlarm).catch(err => handleFirestoreError(err, OperationType.WRITE, `${userPath}/alarms/${newAlarm.id}`));
      
      // Handle Unique History in Firebase
      const normalizedNewName = newHistoryItem.name?.trim().toLowerCase() || '';
      const existingInHistory = history.find(p => (p.name?.trim().toLowerCase() || '') === normalizedNewName);
      
      if (existingInHistory) {
        // Delete old one to make it "unique" and move to top
        await deleteDoc(doc(db, `${userPath}/history`, existingInHistory.id)).catch(err => handleFirestoreError(err, OperationType.DELETE, `${userPath}/history/${existingInHistory.id}`));
      }
      
      await setDoc(doc(db, `${userPath}/history`, newHistoryItem.id), newHistoryItem).catch(err => handleFirestoreError(err, OperationType.WRITE, `${userPath}/history/${newHistoryItem.id}`));
      
      // Optional: Cleanup old items if we strictly want only 5 in DB
      if (history.length >= 5 && !existingInHistory) {
        const sorted = [...history].sort((a, b) => b.dateAdded - a.dateAdded);
        const oldest = sorted[sorted.length - 1];
        await deleteDoc(doc(db, `${userPath}/history`, oldest.id)).catch(err => handleFirestoreError(err, OperationType.DELETE, `${userPath}/history/${oldest.id}`));
      }
    } else {
      setAlarms(prev => [...prev, newAlarm]);
      setHistory(prev => {
        const normalizedNewName = newHistoryItem.name?.trim().toLowerCase() || '';
        const filtered = prev.filter(p => (p.name?.trim().toLowerCase() || '') !== normalizedNewName);
        return [newHistoryItem, ...filtered].slice(0, 5);
      });
    }

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

  const triggerAlarm = async (alarm: AlarmConfig) => {
    setActiveAlarm(alarm);
    setStatus(AppStatus.ALARM_TRIGGERED);
    playAlarmSound(alarm);
    startVibration();
    
    // If it's a 'once' alarm, disable it
    if (alarm.recurrence.type === 'once') {
      if (user) {
        const path = `users/${user.uid}/alarms/${alarm.id}`;
        await setDoc(doc(db, path), { ...alarm, enabled: false }).catch(err => handleFirestoreError(err, OperationType.UPDATE, path));
      } else {
        setAlarms(prev => prev.map(a => a.id === alarm.id ? { ...a, enabled: false } : a));
      }
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

  const toggleSavedPlace = async (place: LocationInfo, settings?: { radius?: number, message?: string, recurrence?: RecurrenceConfig }) => {
    const exists = savedPlaces.find(p => (p.name === place.name || p.address === place.address) && p.lat === place.lat && p.lng === place.lng);
    
    if (user) {
      const userPath = `users/${user.uid}/savedPlaces`;
      if (exists) {
        await deleteDoc(doc(db, userPath, exists.id)).catch(err => handleFirestoreError(err, OperationType.DELETE, `${userPath}/${exists.id}`));
      } else {
        const id = Date.now().toString();
        const newPlace: SavedPlace = {
          ...place,
          id,
          dateAdded: Date.now(),
          defaultRadius: settings?.radius,
          alarmMessage: settings?.message,
          recurrence: settings?.recurrence
        };
        await setDoc(doc(db, userPath, id), newPlace).catch(err => handleFirestoreError(err, OperationType.WRITE, `${userPath}/${id}`));
      }
      return;
    }

    if (exists) {
      setSavedPlaces(prev => prev.filter(p => p.id !== exists.id));
    } else {
      const newPlace: SavedPlace = {
        ...place,
        id: Date.now().toString(),
        dateAdded: Date.now(),
        defaultRadius: settings?.radius,
        alarmMessage: settings?.message,
        recurrence: settings?.recurrence
      };
      setSavedPlaces(prev => [newPlace, ...prev]);
    }
  };

  const isSaved = (place: LocationInfo | undefined) => {
    if (!place) return false;
    return savedPlaces.some(p => (p.name === place.name || p.address === place.address) && p.lat === place.lat && p.lng === place.lng);
  };

  const deleteSavedPlace = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (user) {
      const path = `users/${user.uid}/savedPlaces/${id}`;
      await deleteDoc(doc(db, 'users', user.uid, 'savedPlaces', id)).catch(err => handleFirestoreError(err, OperationType.DELETE, path));
      return;
    }
    setSavedPlaces(prev => prev.filter(p => p.id !== id));
  };

  // --- UI RENDERERS ---

  const renderAlerts = () => (
    <div className="min-h-[100dvh] bg-slate-50 dark:bg-slate-900 flex flex-col font-sans">
      <div className="bg-white dark:bg-slate-800 dark:bg-slate-800 px-6 pt-12 pb-8 rounded-b-[2.5rem] shadow-sm border-b border-slate-100 dark:border-slate-700 relative z-10">
        <div className="flex items-center justify-between mb-8">
            <button 
                onClick={() => setStatus(AppStatus.IDLE)} 
                className="p-3 -ml-2 rounded-full bg-slate-50/50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all duration-300 active:scale-95"
            >
                <ArrowLeft className="w-6 h-6" />
            </button>
        </div>
        
        <div className="flex items-center gap-5">
            <div className="w-20 h-20 bg-gradient-to-br from-amber-100 to-orange-100 rounded-3xl flex items-center justify-center border-4 border-white shadow-lg shadow-amber-100">
                <MessageSquare className="w-10 h-10 text-amber-600" />
            </div>
            <div>
                <h2 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Alertas del Agente</h2>
                <p className="text-slate-500 dark:text-slate-400 font-medium">{pendingActions.length} pendientes</p>
            </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {pendingActions.length === 0 ? (
          <div className="text-center text-slate-500 dark:text-slate-400 mt-10">
            No tienes alertas nuevas en este momento.
          </div>
        ) : (
          pendingActions.map(action => (
            <div key={action.id} className="bg-white dark:bg-slate-800 dark:bg-slate-800 p-5 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 flex flex-col gap-4">
              <div className="flex items-start gap-4">
                <div className="bg-amber-100 p-3 rounded-2xl text-amber-600 shrink-0">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-slate-900 dark:text-white text-lg mb-1">{action.type === 'notification' ? 'Notificación' : action.type === 'route_change' ? 'Ruta Alternativa' : 'Aviso de Alarma'}</h3>
                  <p className="text-slate-600 dark:text-slate-300 text-sm">{action.description}</p>
                </div>
              </div>
              <div className="flex gap-3 border-t border-slate-50 pt-4">
                <button 
                  onClick={() => {
                    alert(`Accion confirmada. Procesando...`);
                    removePendingAction(action.id);
                  }}
                  className="flex-[2] py-3.5 bg-gradient-to-r from-indigo-500 to-violet-500 text-white rounded-[1.25rem] font-bold border border-white/20 text-sm shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 transition-all duration-300"
                >
                  Confirmar
                </button>
                <button 
                  onClick={() => removePendingAction(action.id)}
                  className="flex-1 py-3.5 bg-gradient-to-b from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900 text-slate-600 dark:text-slate-300 rounded-[1.25rem] font-bold border border-slate-200/60 dark:border-slate-700/60 text-sm shadow-sm hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:scale-95 transition-all duration-300"
                >
                  Ignorar
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderAlarmsList = () => (
    <div className="min-h-[100dvh] bg-slate-50 dark:bg-slate-900 flex flex-col font-sans">
      <div className="bg-white dark:bg-slate-800 dark:bg-slate-800 px-6 pt-12 pb-8 rounded-b-[2.5rem] shadow-sm border-b border-slate-100 dark:border-slate-700 relative z-10">
        <div className="flex items-center justify-between mb-8">
            <button 
                onClick={() => setStatus(AppStatus.IDLE)} 
                className="p-3 -ml-2 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-700 dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:text-white transition-colors"
            >
                <ArrowLeft className="w-6 h-6" />
            </button>
        </div>
        
        <div className="flex items-center gap-5">
            <div className="w-20 h-20 bg-gradient-to-br from-indigo-100 to-violet-100 rounded-3xl flex items-center justify-center border-4 border-white shadow-lg shadow-indigo-100">
                <Bell className="w-10 h-10 text-indigo-600" />
            </div>
            <div>
                <h2 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Mis Alarmas</h2>
                <p className="text-slate-500 dark:text-slate-400 font-medium">{alarms.length} guardadas</p>
            </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {alarms.length === 0 ? (
          <div className="text-center py-10 bg-white dark:bg-slate-800 dark:bg-slate-800 rounded-3xl border border-dashed border-slate-200 dark:border-slate-600">
            <Bell className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-slate-400 font-medium text-sm">No tienes alarmas configuradas.</p>
          </div>
        ) : (
          alarms.map(alarm => (
            <div key={alarm.id} className="bg-white dark:bg-slate-800 dark:bg-slate-800 p-5 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 flex flex-col gap-4">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-lg">{alarm.target.name}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{
                    alarm.recurrence.type === 'once' ? 'Una vez' :
                    alarm.recurrence.type === 'always' ? 'Siempre' :
                    alarm.recurrence.type === 'daysOfWeek' ? 'Días específicos' : 'Hasta fecha'
                  }</p>
                </div>
                <button 
                  onClick={async () => {
                    const newEnabled = !alarm.enabled;
                    if (user) {
                      const path = `users/${user.uid}/alarms/${alarm.id}`;
                      await setDoc(doc(db, path), { ...alarm, enabled: newEnabled }).catch(err => handleFirestoreError(err, OperationType.UPDATE, path));
                    } else {
                      setAlarms(prev => prev.map(a => a.id === alarm.id ? { ...a, enabled: newEnabled } : a));
                    }
                  }}
                  className={`w-14 h-8 rounded-full transition-all duration-300 relative shadow-inner shrink-0 ${alarm.enabled ? 'bg-gradient-to-r from-indigo-500 to-violet-500' : 'bg-slate-200 dark:bg-slate-700'}`}
                >
                  <div className={`absolute top-1 w-6 h-6 rounded-full bg-white dark:bg-slate-800 dark:bg-slate-800 shadow-sm transition-all duration-300 ${alarm.enabled ? 'left-7' : 'left-1'}`} />
                </button>
              </div>

              <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-2xl border border-slate-100 dark:border-slate-700">
                  <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Radio de Alarma</span>
                      <span className="text-sm font-bold text-indigo-600">{formatDistance(alarm.radius)}</span>
                  </div>
                  <input 
                      type="range" 
                      min="100" 
                      max="2000" 
                      step="100"
                      value={alarm.radius}
                      onChange={async (e) => {
                        const newRadius = Number(e.target.value);
                        if (user) {
                          const path = `users/${user.uid}/alarms/${alarm.id}`;
                          await setDoc(doc(db, path), { ...alarm, radius: newRadius }).catch(err => handleFirestoreError(err, OperationType.UPDATE, path));
                        } else {
                          setAlarms(prev => prev.map(a => a.id === alarm.id ? { ...a, radius: newRadius } : a));
                        }
                      }}
                      className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
              </div>

              <div className="flex gap-2 border-t border-slate-50 pt-2">
                <button 
                  onClick={async () => {
                    setDraftAlarm(alarm);
                    setStatus(AppStatus.CONFIRMING);
                    // Also remove the old one so it gets replaced, or handle update in saveAlarm
                    if (user) {
                      const path = `users/${user.uid}/alarms/${alarm.id}`;
                      await deleteDoc(doc(db, path)).catch(err => handleFirestoreError(err, OperationType.DELETE, path));
                    } else {
                      setAlarms(prev => prev.filter(a => a.id !== alarm.id));
                    }
                  }}
                  className="flex-1 py-2 bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 rounded-xl font-medium text-sm hover:bg-slate-100 transition-colors"
                >
                  Editar
                </button>
                <button 
                  onClick={async () => {
                    if (user) {
                      const path = `users/${user.uid}/alarms/${alarm.id}`;
                      await deleteDoc(doc(db, path)).catch(err => handleFirestoreError(err, OperationType.DELETE, path));
                    } else {
                      setAlarms(prev => prev.filter(a => a.id !== alarm.id));
                    }
                  }}
                  className="group relative p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-colors"
                >
                  <Trash2 className="w-5 h-5" />
                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-slate-900 dark:bg-slate-700 text-white text-xs font-bold rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 whitespace-nowrap z-50 pointer-events-none shadow-xl border border-white/10 translate-y-1 group-hover:translate-y-0">
                    Eliminar
                  </span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderIdle = () => (
    <div className="relative flex flex-col items-center justify-center min-h-[100dvh] overflow-hidden bg-slate-50 dark:bg-slate-900">
      {/* Background */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 opacity-40 grayscale-[0.8] brightness-105">
          <MapDisplay center={{ lat: -34.9011, lng: -56.1645 }} zoom={13} darkMode={alarmSettings.darkMode} />
        </div>
        {/* Improved overlay for legibility */}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-50/95 via-slate-50/75 to-slate-50/95 backdrop-blur-sm"></div>
      </div>

      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 p-6 flex justify-between z-20">
        <div className="flex gap-3">
          <button 
            onClick={() => setStatus(AppStatus.ALARMS_LIST)}
            className="group relative bg-gradient-to-b from-white to-slate-50 dark:from-slate-800 dark:to-slate-800/90 backdrop-blur-md p-3.5 rounded-[1.25rem] shadow-sm hover:shadow-md shadow-indigo-500/5 hover:scale-105 transition-all text-slate-700 dark:text-slate-200 border border-slate-200/60 dark:border-slate-700/60 flex items-center gap-2"
          >
            <Bell className="w-6 h-6" />
            {alarms.filter(a => a.enabled).length > 0 && (
              <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
            )}
            <span className="absolute top-full left-0 mt-3 px-3 py-1.5 bg-slate-900 dark:bg-slate-700 text-white text-xs font-bold rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 whitespace-nowrap z-50 pointer-events-none shadow-xl border border-white/10 translate-y-1 group-hover:translate-y-0">
              Mis Alarmas
            </span>
          </button>
          <button 
            onClick={() => setStatus(AppStatus.ALERTS)}
            className="group relative bg-gradient-to-b from-white to-slate-50 dark:from-slate-800 dark:to-slate-800/90 backdrop-blur-md p-3.5 rounded-[1.25rem] shadow-sm hover:shadow-md shadow-amber-500/10 hover:scale-105 transition-all text-amber-600 border border-slate-200/60 dark:border-slate-700/60 flex items-center gap-2"
          >
            <MessageSquare className="w-6 h-6" />
            {pendingActions.length > 0 && (
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
            )}
            <span className="absolute top-full left-1/2 -translate-x-1/2 mt-3 px-3 py-1.5 bg-slate-900 dark:bg-slate-700 text-white text-xs font-bold rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 whitespace-nowrap z-50 pointer-events-none shadow-xl border border-white/10 translate-y-1 group-hover:translate-y-0">
              Alertas del Agente
            </span>
          </button>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => setAlarmSettings({...alarmSettings, darkMode: !alarmSettings.darkMode})}
            className="group relative bg-gradient-to-b from-white to-slate-50 dark:from-slate-800 dark:to-slate-800/90 backdrop-blur-md p-3.5 rounded-[1.25rem] shadow-sm hover:shadow-md shadow-indigo-500/5 hover:scale-105 transition-all duration-300 text-slate-700 dark:text-slate-200 border border-slate-200/60 dark:border-slate-700/60 aspect-square flex items-center justify-center inline-flex"
          >
            {alarmSettings.darkMode ? <Moon className="w-6 h-6" /> : <Sun className="w-6 h-6" />}
            <span className="absolute top-full right-0 mt-3 px-3 py-1.5 bg-slate-900 dark:bg-slate-700 text-white text-xs font-bold rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 whitespace-nowrap z-50 pointer-events-none shadow-xl border border-white/10 translate-y-1 group-hover:translate-y-0">
              Alternar Tema
            </span>
          </button>
          <button 
            onClick={() => setStatus(AppStatus.PROFILE)}
            className="group relative bg-white dark:bg-slate-800 dark:bg-slate-800/90 backdrop-blur-md p-3 rounded-2xl shadow-lg shadow-indigo-500/10 hover:shadow-indigo-500/20 hover:scale-105 transition-all text-slate-700 dark:text-slate-200 border border-white/50"
          >
            <UserIcon className="w-6 h-6" />
            <span className="absolute top-full right-0 mt-3 px-3 py-1.5 bg-slate-900 dark:bg-slate-700 text-white text-xs font-bold rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 whitespace-nowrap z-50 pointer-events-none shadow-xl border border-white/10 translate-y-1 group-hover:translate-y-0">
              Mi Perfil
            </span>
          </button>
        </div>
      </div>

      <div className="relative z-10 flex flex-col items-center w-full px-6 max-w-lg mx-auto">
        <div className="bg-gradient-to-br from-indigo-500 to-violet-600 p-6 rounded-[2rem] mb-10 shadow-2xl shadow-indigo-500/30 rotate-3 hover:rotate-6 transition-transform duration-300 border border-white/20">
          <MapPin className="w-12 h-12 text-white" strokeWidth={2.5} />
        </div>
        <h1 className="text-7xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-600 mb-4 tracking-tighter">
          NapNav
        </h1>
        <p className="text-slate-500 dark:text-slate-400 font-semibold text-center mb-14 max-w-xs leading-relaxed text-lg">
          Tu secretaria personal de movilidad. Te cuidamos mientras descansas.
        </p>
        
        <div className="w-full max-w-md mx-auto relative z-30">
          <div className="relative group">
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/40 to-violet-500/40 rounded-[2.5rem] blur-2xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-700 pointer-events-none"></div>
            <div className="relative overflow-hidden rounded-[2.5rem] p-[2px] bg-white/20 dark:bg-slate-800/20 backdrop-blur-3xl focus-within:bg-gradient-to-r focus-within:from-indigo-500 focus-within:to-violet-500 transition-all duration-300 shadow-2xl shadow-indigo-900/10">
              <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl rounded-[2.4rem] flex items-center p-3">
                <div className="p-3.5 text-indigo-500 bg-indigo-50/50 dark:bg-indigo-500/10 rounded-full mr-3 shadow-inner">
                  <Search className="w-7 h-7" />
                </div>
                <form onSubmit={handleSearch} className="flex-1 flex items-center">
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
                    placeholder="¿A dónde quieres ir?"
                    className="flex-1 min-w-0 py-4 px-3 outline-none text-slate-800 dark:text-slate-100 placeholder:text-slate-400 font-extrabold bg-transparent text-xl tracking-tight"
                  />
                  <div className="flex items-center gap-2 pl-2">
                    {isSuggesting && <Loader2 className="w-6 h-6 animate-spin text-indigo-500 shrink-0" />}
                    <button 
                      type="submit"
                      disabled={!query.trim()}
                      className="bg-gradient-to-r from-indigo-500 to-violet-500 text-white px-6 sm:px-10 py-3.5 sm:py-4 rounded-full disabled:opacity-50 shadow-xl shadow-indigo-500/30 hover:shadow-indigo-500/50 hover:-translate-y-1 active:translate-y-0 active:scale-95 transition-all duration-300 font-black text-lg flex items-center gap-2 border border-white/20 whitespace-nowrap shrink-0"
                    >
                      <span>Ir</span>
                      <Navigation className="w-6 h-6" />
                    </button>
                  </div>
                </form>
              </div>
            </div>
            
            <AnimatePresence>
              {showSuggestions && suggestions.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.95 }}
                  className="absolute top-full left-0 right-0 mt-5 bg-white/90 dark:bg-slate-900/90 backdrop-blur-3xl rounded-[2rem] shadow-2xl border border-white/50 dark:border-slate-800/50 overflow-hidden z-40 p-2"
                >
                  {suggestions.map((sug, i) => (
                    <button
                      key={i}
                      onClick={() => handleSuggestionClick(sug)}
                      className="w-full text-left px-6 py-5 hover:bg-indigo-500 hover:text-white rounded-2xl outline-none flex items-start gap-5 transition-all duration-200 group"
                    >
                      <MapPin className="w-6 h-6 text-indigo-500 group-hover:text-white shrink-0 mt-1 transition-colors" />
                      <div className="flex-1 min-w-0">
                        <p className="font-extrabold text-slate-800 dark:text-slate-100 group-hover:text-white truncate text-lg tracking-tight">
                          {sug.display_name.split(',')[0]}
                        </p>
                        <p className="text-sm text-slate-500 dark:text-slate-400 group-hover:text-indigo-100 truncate mt-0.5 font-medium">
                          {sug.display_name.split(',').slice(1).join(',')}
                        </p>
                      </div>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>



        {/* Quick Access UI - Horizontal Scroll */}
        {(savedPlaces.length > 0 || history.length > 0) && (
          <div className="w-full mt-8 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 pl-1">
              Destinos Rápidos
            </h3>
            <div className="flex gap-4 overflow-x-auto pb-6 -mx-6 px-6 scrollbar-hide snap-x">
              {/* Favorites First */}
              {savedPlaces.map(place => (
                <button
                  key={`fav-${place.id}`}
                  onClick={() => selectSavedLocation(place)}
                  className="flex-shrink-0 snap-start bg-white/70 dark:bg-slate-800/70 backdrop-blur-xl p-3 pr-6 rounded-3xl shadow-[0_4px_15px_rgba(0,0,0,0.03)] dark:shadow-[0_4px_15px_rgba(0,0,0,0.2)] border border-white/60 dark:border-slate-700/50 flex items-center gap-4 hover:shadow-[0_8px_25px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_25px_rgba(0,0,0,0.3)] hover:-translate-y-1 transition-all duration-300 active:translate-y-0 active:scale-95 group w-[240px]"
                >
                  <div className="w-14 h-14 rounded-[1.25rem] bg-gradient-to-br from-rose-50 to-pink-50 dark:from-rose-500/10 dark:to-pink-500/5 flex items-center justify-center text-rose-500 shadow-inner group-hover:scale-105 transition-transform duration-300 shrink-0">
                    <Heart className="w-6 h-6 fill-current drop-shadow-sm" />
                  </div>
                  <div className="text-left overflow-hidden min-w-0">
                    <p className="font-bold text-slate-800 dark:text-slate-100 text-[15px] truncate drop-shadow-sm">{place.name}</p>
                    <p className="text-[13px] text-slate-500 dark:text-slate-400 font-medium truncate mt-0.5">{place.address || `${formatDistance(place.defaultRadius || 500)} de radio`}</p>
                  </div>
                </button>
              ))}
              
              {/* History Items */}
              {history.map(place => (
                  <button
                    key={`hist-${place.id}`}
                    onClick={() => selectSavedLocation(place)}
                    className="flex-shrink-0 snap-start bg-white/70 dark:bg-slate-800/70 backdrop-blur-xl p-3 pr-6 rounded-3xl shadow-[0_4px_15px_rgba(0,0,0,0.03)] dark:shadow-[0_4px_15px_rgba(0,0,0,0.2)] border border-white/60 dark:border-slate-700/50 flex items-center gap-4 hover:shadow-[0_8px_25px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_25px_rgba(0,0,0,0.3)] hover:-translate-y-1 transition-all duration-300 active:translate-y-0 active:scale-95 group w-[240px]"
                  >
                    <div className="w-14 h-14 rounded-[1.25rem] bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-700 dark:to-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 group-hover:from-indigo-50 group-hover:to-blue-50 dark:group-hover:from-indigo-500/10 dark:group-hover:to-blue-500/5 group-hover:text-indigo-500 shadow-inner group-hover:scale-105 transition-transform duration-300 shrink-0">
                      <History className="w-6 h-6 drop-shadow-sm" />
                    </div>
                    <div className="text-left overflow-hidden min-w-0">
                      <p className="font-bold text-slate-800 dark:text-slate-100 text-[15px] truncate drop-shadow-sm">{place.name}</p>
                      <p className="text-[13px] text-slate-500 dark:text-slate-400 font-medium truncate mt-0.5">{place.address || `${formatDistance(place.defaultRadius || 500)} de radio`}</p>
                    </div>
                  </button>
              ))}
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
    <div className="min-h-[100dvh] bg-slate-50 dark:bg-slate-900 flex flex-col font-sans">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 dark:bg-slate-800 px-6 pt-12 pb-8 rounded-b-[2.5rem] shadow-sm border-b border-slate-100 dark:border-slate-700 relative z-10">
        <div className="flex items-center justify-between mb-8">
            <button 
                onClick={() => setStatus(AppStatus.IDLE)} 
                className="px-5 py-2.5 -ml-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:text-white transition-all duration-300 flex items-center gap-2 font-bold border border-transparent hover:border-slate-200 dark:hover:border-slate-700 active:scale-95"
            >
                <ArrowLeft className="w-5 h-5" /> Atrás
            </button>
            <div className="flex gap-2">
              <button 
                  onClick={() => setStatus(AppStatus.SETTINGS)}
                  className="group relative p-3 bg-slate-50 dark:bg-slate-900 rounded-2xl text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:bg-indigo-900/30 hover:text-indigo-600 transition-colors"
                  aria-label="Configuración"
              >
                  <Settings className="w-6 h-6" />
                  <span className="absolute top-full right-0 mt-3 px-3 py-1.5 bg-slate-900 dark:bg-slate-700 text-white text-xs font-bold rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 whitespace-nowrap z-50 pointer-events-none shadow-xl border border-white/10 translate-y-1 group-hover:translate-y-0">
                    Configuración
                  </span>
              </button>
              {user && (
                <button 
                    onClick={() => logout()}
                    className="group relative p-3 bg-rose-50 dark:bg-rose-900/30 rounded-2xl text-rose-600 hover:bg-rose-100 transition-colors"
                    aria-label="Cerrar Sesión"
                >
                    <LogOut className="w-6 h-6" />
                    <span className="absolute top-full right-0 mt-3 px-3 py-1.5 bg-slate-900 dark:bg-slate-700 text-white text-xs font-bold rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 whitespace-nowrap z-50 pointer-events-none shadow-xl border border-white/10 translate-y-1 group-hover:translate-y-0">
                      Cerrar Sesión
                    </span>
                </button>
              )}
            </div>
        </div>
        
        <div className="flex items-center gap-5">
            <div className="w-20 h-20 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-3xl flex items-center justify-center border-4 border-white shadow-lg shadow-indigo-100 overflow-hidden">
                {user?.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName || ''} className="w-full h-full object-cover" />
                ) : (
                  <UserIcon className="w-10 h-10 text-white" />
                )}
            </div>
            <div className="flex-1">
                <h2 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight truncate">
                  {user ? (user.displayName || 'Usuario') : 'Mi Perfil'}
                </h2>
                <p className="text-slate-500 dark:text-slate-400 font-medium truncate">
                  {user ? user.email : 'Bienvenido a NapNav'}
                </p>
            </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8 pb-32">
        
        {/* Auth Section */}
        {!user && (
          <section className="bg-gradient-to-br from-indigo-500 to-violet-600 p-8 rounded-[2.5rem] shadow-xl shadow-indigo-500/20 text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <Key className="w-24 h-24 rotate-12" />
            </div>
            <div className="relative z-10">
              <h3 className="text-2xl font-black mb-3 leading-tight">Guarda tus lugares <br/>en la nube</h3>
              <p className="text-indigo-100 mb-8 font-medium max-w-[220px] text-sm leading-relaxed">
                Inicia sesión para sincronizar tus favoritos e historial en todos tus dispositivos.
              </p>
              <button 
                onClick={() => signInWithGoogle()}
                className="w-full py-4 bg-white text-indigo-600 rounded-2xl font-black shadow-lg hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 active:scale-95 transition-all duration-300 flex items-center justify-center gap-3"
              >
                <LogIn className="w-5 h-5" />
                Acceder con Google
              </button>
            </div>
          </section>
        )}
        
        {/* Section: Preferences */}
        <section>
          <div className="bg-white dark:bg-slate-800 dark:bg-slate-800 rounded-3xl p-2 shadow-sm border border-slate-100 dark:border-slate-700">
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-sky-100 flex items-center justify-center text-sky-600">
                     <Navigation className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-900 dark:text-white">GPS de Alta Precisión</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Mejor rastreo, más batería</p>
                  </div>
              </div>
              <button 
                onClick={() => setUseHighAccuracy(!useHighAccuracy)}
                className={`w-14 h-8 rounded-full transition-all duration-300 relative shadow-inner ${useHighAccuracy ? 'bg-gradient-to-r from-indigo-500 to-violet-500 shadow-indigo-500/20' : 'bg-slate-200 dark:bg-slate-700'}`}
              >
                <div className={`absolute top-1 w-6 h-6 rounded-full bg-white dark:bg-slate-800 dark:bg-slate-800 shadow-sm transition-all duration-300 ${useHighAccuracy ? 'left-7' : 'left-1'}`} />
              </button>
            </div>
          </div>
        </section>

        {/* Section: Locations */}
        <section>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 ml-2">Mis Lugares</h3>
          {savedPlaces.length === 0 ? (
            <div className="text-center py-10 bg-white dark:bg-slate-800 dark:bg-slate-800/60 backdrop-blur-xl rounded-3xl border border-dashed border-slate-300/50">
              <Heart className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-slate-400 font-medium text-sm">Aún no tienes lugares guardados.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {savedPlaces.map(place => (
                <div key={place.id} className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-3xl p-4 rounded-[2rem] shadow-[0_4px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.2)] hover:shadow-[0_12px_30px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_12px_30px_rgba(0,0,0,0.3)] border border-white/80 dark:border-slate-700/50 flex items-center justify-between group hover:-translate-y-1 active:translate-y-0 active:scale-[0.98] transition-all duration-500">
                  <div 
                    onClick={() => selectSavedLocation(place)}
                    className="flex-1 flex items-center gap-4 cursor-pointer"
                  >
                    <div className="w-14 h-14 rounded-[1.25rem] bg-gradient-to-br from-indigo-50/80 to-violet-50/80 dark:from-indigo-500/10 dark:to-violet-500/10 flex items-center justify-center text-indigo-500 shrink-0 shadow-[inset_0_2px_10px_rgba(255,255,255,1)] dark:shadow-[inset_0_2px_10px_rgba(255,255,255,0.05)] group-hover:scale-105 group-hover:rotate-3 transition-transform duration-500">
                        <MapPin className="w-7 h-7 drop-shadow-sm" />
                    </div>
                    <div className="min-w-0 pr-2">
                        <p className="font-bold text-slate-800 dark:text-slate-100 text-[16px] truncate">{place.name}</p>
                        <p className="text-[13px] text-slate-500 dark:text-slate-400 truncate mt-0.5 font-medium">{place.address || "Coordenadas guardadas"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button 
                      onClick={(e) => { e.stopPropagation(); toggleSavedPlace(place); }}
                      className={`group relative p-3 rounded-2xl transition-all duration-300 ${isSaved(place) ? 'text-rose-500 bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                    >
                      <Heart className={`w-5 h-5 ${isSaved(place) ? 'fill-current drop-shadow-[0_0_8px_rgba(244,63,94,0.4)]' : ''}`} />
                      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-slate-900 dark:bg-slate-700 text-white text-xs font-bold rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 whitespace-nowrap z-50 pointer-events-none shadow-xl border border-white/10 translate-y-1 group-hover:translate-y-0">
                        {isSaved(place) ? "Quitar de favoritos" : "Añadir a favoritos"}
                      </span>
                    </button>
                    <button 
                      onClick={(e) => deleteSavedPlace(place.id, e)}
                      className="group relative p-3 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-2xl transition-all duration-300"
                    >
                      <Trash2 className="w-5 h-5" />
                      <span className="absolute bottom-full right-0 mb-2 px-3 py-1.5 bg-slate-900 dark:bg-slate-700 text-white text-xs font-bold rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 whitespace-nowrap z-50 pointer-events-none shadow-xl border border-white/10 translate-y-1 group-hover:translate-y-0">
                        Eliminar
                      </span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Section: Mis Alarmas (History) */}
        <section>
          <div className="flex items-center justify-between mb-4 ml-2">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Mis Alarmas</h3>
            <History className="w-4 h-4 text-slate-400" />
          </div>
          {history.length === 0 ? (
            <div className="text-center py-8 bg-white dark:bg-slate-800 dark:bg-slate-800/60 backdrop-blur-xl rounded-3xl border border-dashed border-slate-300/50">
              <p className="text-slate-400 text-sm">Tus alarmas recientes aparecerán aquí.</p>
            </div>
          ) : (
            <div className="bg-white/40 dark:bg-slate-800/40 backdrop-blur-3xl rounded-[2rem] shadow-[0_4px_20px_rgba(0,0,0,0.03)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.15)] border border-white/60 dark:border-slate-700/30 overflow-hidden flex flex-col divide-y divide-slate-100/50 dark:divide-slate-700/50">
              {history.map(item => (
                <div key={item.id} className="group relative">
                  <button 
                      onClick={() => selectSavedLocation(item)}
                      className="w-full p-5 flex items-center justify-between text-left bg-transparent hover:bg-white/80 dark:hover:bg-slate-700/40 transition-all duration-300"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-[1.2rem] bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center text-indigo-500 text-base shadow-inner group-hover:scale-105 transition-all duration-300">
                         <Bell className="w-5 h-5" />
                      </div>
                      <div>
                          <p className="font-bold text-slate-800 dark:text-slate-100 text-[16px]">{item.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[13px] text-slate-500 dark:text-slate-400 font-medium">Radio: {formatDistance(item.defaultRadius || 500)}</span>
                          </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                       <button 
                        onClick={(e) => { e.stopPropagation(); toggleSavedPlace(item); }}
                        className={`p-2.5 rounded-xl transition-all duration-300 ${isSaved(item) ? 'text-rose-500 bg-rose-50 dark:bg-rose-500/10' : 'text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50'}`}
                      >
                        <Heart className={`w-4.5 h-4.5 ${isSaved(item) ? 'fill-current' : ''}`} />
                      </button>
                      <button 
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          setHistory(prev => prev.filter(p => p.id !== item.id)); 
                        }}
                        className="p-2.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-xl transition-all duration-300"
                      >
                        <Trash2 className="w-4.5 h-4.5" />
                      </button>
                      <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-indigo-500 dark:text-slate-600 dark:group-hover:text-indigo-400 transition-colors" />
                    </div>
                  </button>
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
      <div className="min-h-[100dvh] bg-slate-50 dark:bg-slate-900 flex flex-col">
         {/* Header */}
        <div className="bg-white dark:bg-slate-800 dark:bg-slate-800 px-6 pt-12 pb-6 border-b border-slate-100 dark:border-slate-700">
            <button 
            onClick={() => setStatus(AppStatus.PROFILE)} 
            className="mb-6 p-2 -ml-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 dark:bg-slate-900 inline-flex transition-colors"
            >
            <ArrowLeft className="w-6 h-6 text-slate-700 dark:text-slate-200" />
            </button>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
                <div className="bg-indigo-100 p-2 rounded-xl">
                    <Bell className="w-6 h-6 text-indigo-600" />
                </div>
                Configuración
            </h2>
        </div>

        <div className="flex-1 p-6 space-y-6">
            
            {/* Volume */}
            <section className="bg-white dark:bg-slate-800 dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-orange-100 rounded-lg text-orange-600">
                            <Volume2 className="w-5 h-5" />
                        </div>
                        <h3 className="font-bold text-slate-900 dark:text-white">Volumen</h3>
                    </div>
                    <span className="text-sm font-bold text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1 rounded-full">
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
            <section className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-xl p-5 rounded-[2rem] shadow-sm border border-white/60 dark:border-slate-700/50 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-violet-100 dark:bg-violet-500/10 rounded-2xl text-violet-600">
                        <Smartphone className="w-6 h-6" />
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-900 dark:text-white">Vibración</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Patrón háptico al llegar</p>
                    </div>
                </div>
                <button 
                    onClick={() => setAlarmSettings({...alarmSettings, vibration: !alarmSettings.vibration})}
                    className={`w-14 h-8 rounded-full transition-all duration-300 relative shadow-inner ${alarmSettings.vibration ? 'bg-gradient-to-r from-indigo-500 to-violet-500 shadow-indigo-500/20' : 'bg-slate-200 dark:bg-slate-700'}`}
                >
                    <div className={`absolute top-1 w-6 h-6 rounded-full bg-white dark:bg-slate-800 shadow-sm transition-all duration-300 ${alarmSettings.vibration ? 'left-7' : 'left-1'}`} />
                </button>
            </section>

            {/* Dark Mode */}
            <section className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-xl p-5 rounded-[2rem] shadow-sm border border-white/60 dark:border-slate-700/50 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-slate-100 dark:bg-slate-700/50 rounded-2xl text-slate-600 dark:text-slate-300">
                        {alarmSettings.darkMode ? <Moon className="w-6 h-6" /> : <Sun className="w-6 h-6" />}
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-900 dark:text-white">Modo Oscuro</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Tema visual de la interfaz</p>
                    </div>
                </div>
                <button 
                    onClick={() => setAlarmSettings({...alarmSettings, darkMode: !alarmSettings.darkMode})}
                    className={`w-14 h-8 rounded-full transition-all duration-300 relative shadow-inner ${alarmSettings.darkMode ? 'bg-gradient-to-r from-indigo-500 to-violet-500 shadow-indigo-500/20' : 'bg-slate-200 dark:bg-slate-700'}`}
                >
                    <div className={`absolute top-1 w-6 h-6 rounded-full bg-white dark:bg-slate-800 shadow-sm transition-all duration-300 ${alarmSettings.darkMode ? 'left-7' : 'left-1'}`} />
                </button>
            </section>

            {/* Intensity */}
            <section className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-xl p-6 rounded-[2rem] shadow-sm border border-white/60 dark:border-slate-700/50">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-3 bg-indigo-100 dark:bg-indigo-500/10 rounded-2xl text-indigo-600">
                        <Zap className="w-6 h-6" />
                    </div>
                    <h3 className="font-bold text-slate-900 dark:text-white">Intensidad de Alarma</h3>
                </div>
                
                <div className="grid grid-cols-1 gap-3">
                    {(['soft', 'normal', 'intense'] as AlarmIntensity[]).map((level) => (
                        <button
                            key={level}
                            onClick={() => setAlarmSettings({...alarmSettings, intensity: level})}
                            className={`p-5 rounded-[1.5rem] border-2 text-left transition-all flex items-center justify-between relative overflow-hidden ${
                                alarmSettings.intensity === level 
                                ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-500/20' 
                                : 'border-slate-100 dark:border-slate-700/50 hover:border-indigo-200 dark:hover:border-indigo-900/50'
                            }`}
                        >
                            <div className="relative z-10">
                                <span className="block font-bold text-slate-900 dark:text-white capitalize text-lg tracking-tight">
                                    {level === 'soft' ? 'Suave' : level === 'normal' ? 'Normal' : 'Intensa'}
                                </span>
                                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-1 block">
                                    {level === 'soft' ? 'Voz calmada y pausas largas' : 
                                     level === 'normal' ? 'Equilibrado y claro' : 'Voz enérgica y rápida'}
                                </span>
                            </div>
                            {alarmSettings.intensity === level && (
                                <div className="w-8 h-8 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30">
                                    <Check className="w-5 h-5 stroke-[3px]" />
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
      <div className="flex flex-col items-center justify-center relative">
        <div className="relative mb-8">
          <div className="absolute inset-0 bg-indigo-500/30 blur-3xl rounded-full animate-pulse"></div>
          <div className="relative bg-white/40 dark:bg-slate-800/40 backdrop-blur-3xl p-6 rounded-[2rem] shadow-2xl border border-white/50 dark:border-slate-700/50">
              <Loader2 className="w-12 h-12 text-indigo-500 animate-spin" />
          </div>
        </div>
        <h3 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 mb-2 tracking-tight">Buscando ubicación...</h3>
        <p className="text-slate-500 dark:text-slate-400 font-medium text-center max-w-xs leading-relaxed">
          Localizando las mejores coordenadas para tu destino.
        </p>
      </div>
      
      <button 
        onClick={() => setStatus(AppStatus.IDLE)}
        className="mt-12 flex items-center gap-3 text-slate-500 dark:text-slate-400 bg-white/20 dark:bg-slate-900/20 backdrop-blur-3xl px-8 py-4 rounded-[1.5rem] border border-white/40 dark:border-slate-700/40 hover:bg-white/40 dark:hover:bg-slate-800/40 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all duration-300 font-bold group"
      >
        <X className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
        <span>Cancelar búsqueda</span>
      </button>
    </div>
  );

  const renderConfirming = () => {
    const isFavorite = isSaved(draftAlarm?.target);

    return (
      <div className="flex flex-col h-[100dvh] bg-slate-50 dark:bg-slate-900">
        <div className="h-[35%] w-full relative">
          <MapDisplay 
              currentLocation={currentLocation} 
              targetLocation={draftAlarm?.target || null}
              radius={draftAlarm?.radius || 500}
              darkMode={alarmSettings.darkMode}
          />
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white to-transparent pointer-events-none z-[400]"></div>
          <button 
              onClick={() => setStatus(AppStatus.IDLE)}
              className="absolute top-4 left-4 bg-white/90 dark:bg-slate-800/90 backdrop-blur-md px-5 py-3.5 rounded-full shadow-lg shadow-slate-900/5 z-[401] hover:scale-105 active:scale-95 transition-all duration-300 flex items-center gap-2 border border-slate-200/50 dark:border-slate-700/50"
          >
              <ArrowLeft className="w-5 h-5 text-slate-800 dark:text-slate-100" />
              <span className="font-bold text-slate-800 dark:text-slate-100 text-sm">Atrás</span>
          </button>
        </div>
        
        <div className="h-[65%] bg-white/95 dark:bg-slate-800/95 backdrop-blur-2xl rounded-t-[3rem] -mt-10 relative z-10 px-8 pt-8 pb-6 flex flex-col shadow-[0_-15px_40px_rgba(0,0,0,0.08)] border-t border-slate-100/50 dark:border-slate-700/50 overflow-y-auto">
          <div className="w-16 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full mx-auto mb-8 shrink-0"></div>
          
          <div className="flex justify-between items-start mb-2">
             <h2 className="text-3xl font-bold text-slate-900 dark:text-white flex-1 mr-4 leading-tight drop-shadow-sm">{draftAlarm?.target?.name}</h2>
             <button 
                onClick={() => draftAlarm?.target && toggleSavedPlace(draftAlarm.target, { 
                  radius: draftAlarm.radius, 
                  message: draftAlarm.alarmMessage, 
                  recurrence: draftAlarm.recurrence 
                })}
                className={`group relative p-3 rounded-2xl transition-all duration-300 ${isFavorite ? 'bg-rose-50 dark:bg-rose-500/10 text-rose-500 shadow-inner' : 'bg-slate-50 dark:bg-slate-900 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
             >
                <Heart className={`w-7 h-7 ${isFavorite ? 'fill-current drop-shadow-[0_0_8px_rgba(244,63,94,0.4)]' : ''}`} />
                <span className="absolute bottom-full right-0 mb-3 px-3 py-1.5 bg-slate-900 dark:bg-slate-700 text-white text-xs font-bold rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 whitespace-nowrap z-50 pointer-events-none shadow-xl border border-white/10 translate-y-1 group-hover:translate-y-0">
                  {isFavorite ? "Quitar de favoritos" : "Añadir a favoritos"}
                </span>
             </button>
          </div>
          
          <p className="text-slate-500 dark:text-slate-400 font-medium mb-6 text-[15px]">{draftAlarm?.target?.address}</p>
          
          <div className="bg-gradient-to-br from-indigo-50/80 to-blue-50/50 dark:from-indigo-900/40 dark:to-blue-900/20 p-5 rounded-[2rem] mb-4 border border-indigo-100/60 dark:border-indigo-500/10 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 dark:bg-indigo-400/5 rounded-bl-[100px] pointer-events-none"></div>
              <div className="flex justify-between items-center mb-4 relative z-10">
                  <span className="text-sm font-bold text-indigo-900 dark:text-indigo-200 uppercase tracking-wider">Radio de Alarma</span>
                  <span className="text-lg font-black text-indigo-600 dark:text-indigo-300">{formatDistance(draftAlarm?.radius || 500)}</span>
              </div>
              <div className="relative z-10">
                <input 
                    type="range" 
                    min="100" 
                    max="2000" 
                    step="100"
                    value={draftAlarm?.radius}
                    onChange={(e) => setDraftAlarm(prev => prev ? ({...prev, radius: Number(e.target.value)}) : null)}
                    className="w-full h-2 bg-indigo-200/70 dark:bg-indigo-900/50 rounded-lg appearance-none cursor-pointer accent-indigo-600 dark:accent-indigo-400"
                />
              </div>
          </div>

          <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-800/80 dark:to-slate-900/80 p-5 rounded-[2rem] mb-auto border border-slate-200/60 dark:border-slate-700/60 shadow-sm relative overflow-hidden">
              <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-slate-200/30 dark:bg-slate-700/20 rounded-tl-[100px] pointer-events-none"></div>
              <div className="relative z-10">
                <span className="text-sm font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider block mb-3">Recurrencia</span>
                <select 
                  value={draftAlarm?.recurrence?.type || 'once'}
                  onChange={(e) => setDraftAlarm(prev => prev ? ({...prev, recurrence: { type: e.target.value as any, days: e.target.value === 'daysOfWeek' ? [1,2,3,4,5] : undefined }}) : null)}
                  className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded-xl px-4 py-3 font-bold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all mb-3 shadow-sm"
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
                          className={`w-10 h-10 rounded-full font-bold text-[13px] flex items-center justify-center transition-all duration-300 ${isSelected ? 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30 border border-indigo-400' : 'bg-white dark:bg-slate-800 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 hover:scale-105'}`}
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
                    className="w-full bg-white dark:bg-slate-800 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded-xl px-4 py-3 font-bold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all shadow-sm"
                  />
                )}
              </div>
          </div>

          <div className="flex gap-4 mt-6 shrink-0 relative z-10">
              <button 
                  onClick={() => setStatus(AppStatus.IDLE)}
                  className="flex-[0.8] bg-gradient-to-b from-white to-slate-50 dark:from-slate-800 dark:to-slate-900 backdrop-blur-3xl text-slate-700 dark:text-slate-300 py-4 rounded-[1.25rem] text-[16px] font-bold hover:shadow-md active:scale-95 transition-all duration-300 flex items-center justify-center gap-2 border border-slate-200/60 dark:border-slate-700/60 shadow-sm hover:-translate-y-0.5 h-[64px]"
              >
                  <X className="w-6 h-6 text-slate-500 dark:text-slate-400" />
                  <span className="hidden sm:inline tracking-wide">Cancelar</span>
              </button>
              <button 
                  onClick={saveAlarm}
                  className="group flex-[2] bg-gradient-to-r from-indigo-500 via-violet-500 to-indigo-500 bg-[length:200%_auto] hover:bg-[position:right_center] text-white py-4 rounded-[1.25rem] text-[17px] font-extrabold shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 transition-all duration-500 flex items-center justify-center gap-3 border border-white/20 h-[64px] relative overflow-hidden"
              >
                  <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out"></div>
                  <Navigation className="w-5 h-5 text-white fill-white drop-shadow-md group-hover:rotate-12 transition-transform duration-500" />
                  <span className="tracking-wide drop-shadow-md">Iniciar Ruta</span>
              </button>
          </div>
        </div>
      </div>
    );
  };

  const renderTracking = () => (
    <div className="relative h-[100dvh] bg-slate-900 text-white font-sans overflow-hidden flex flex-col">
      {/* Map Section - Full screen */}
      <div className="absolute inset-0 z-0">
        <MapDisplay 
            currentLocation={currentLocation} 
            targetLocation={activeAlarm?.target || null}
            radius={activeAlarm?.radius || 500}
            zoom={16} // Un poco más cerca
            isTracking={true}
        />
        {/* Gradiente para transición suave y legibilidad */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/40 to-transparent pointer-events-none z-10" />
      </div>

      {/* Info Section - Bottom Sheet Style overlaying the map */}
      <div className="mt-auto relative z-20 bg-slate-900/60 backdrop-blur-3xl rounded-t-[2.5rem] px-6 pt-8 pb-8 flex flex-col border-t border-white/10 shadow-[0_-20px_50px_rgba(0,0,0,0.5)]">
         <div className="w-12 h-1 bg-slate-500 rounded-full mx-auto mb-6 opacity-50" />
         
         <div className="w-full max-w-md mx-auto">
            <div className="flex items-center justify-between mb-8">
                <div>
                   <div className="inline-flex items-center gap-2 bg-indigo-500/20 border border-indigo-500/30 px-3 py-1.5 rounded-full text-indigo-300 text-xs font-bold uppercase tracking-widest mb-2 shadow-[0_0_15px_rgba(99,102,241,0.3)]">
                      <motion.div
                        animate={{ 
                          scale: [1, 1.2, 1],
                          rotate: [0, 10, -10, 0]
                        }}
                        transition={{ 
                          duration: 3, 
                          repeat: Infinity,
                          ease: "easeInOut"
                        }}
                        className="flex items-center justify-center"
                      >
                        <Navigation className="w-3.5 h-3.5 fill-indigo-400 text-indigo-400" />
                      </motion.div>
                      En Ruta
                   </div>
                   <h2 className="text-2xl font-bold text-white truncate max-w-[200px] drop-shadow-md">{activeAlarm?.target?.name || 'Buscando...'}</h2>
                </div>
                <div className="text-right">
                    {/* Contraste y glow más tecnológicos */}
                    <div className="text-5xl font-black tracking-tighter tabular-nums mb-1 text-white" 
                         style={{ 
                           textShadow: "0 0 20px rgba(34, 211, 238, 0.9), 0 0 40px rgba(56, 189, 248, 0.6), 0 0 60px rgba(56, 189, 248, 0.3)" 
                         }}>
                        {currentDistance !== null ? formatDistance(currentDistance) : '...'}
                    </div>
                    <p className="text-cyan-200/80 text-xs font-bold uppercase tracking-widest drop-shadow-md">Distancia</p>
                </div>
            </div>

            <div className="h-16 w-full mb-8 opacity-60">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={distanceHistory}>
                        <YAxis domain={['auto', 'auto']} hide />
                        <Line 
                            type="monotone" 
                            dataKey="distance" 
                            stroke="#a5b4fc" 
                            strokeWidth={4} 
                            dot={false}
                            isAnimationActive={false}
                            style={{ filter: "drop-shadow(0 0 8px rgba(165,180,252,0.6))" }}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>

            <button 
                onClick={() => {
                  if (window.confirm("¿Estás seguro que deseas cancelar tu ruta actual?")) {
                    setStatus(AppStatus.IDLE);
                  }
                }}
                className="w-full bg-gradient-to-r from-rose-900/80 to-rose-800/80 backdrop-blur-xl text-white py-4 rounded-[1.25rem] text-lg font-bold border border-rose-500/20 hover:from-rose-800 hover:to-rose-700 transition-all duration-300 flex items-center justify-center gap-3 group active:scale-95 hover:-translate-y-0.5 shadow-lg shadow-rose-900/40 hover:shadow-rose-900/60"
            >
                <X className="w-6 h-6 text-rose-300 group-hover:text-white transition-colors" />
                Cancelar Ruta
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
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-white dark:bg-slate-800 dark:bg-slate-800 opacity-20 rounded-full animate-ping"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-white dark:bg-slate-800 dark:bg-slate-800 opacity-30 rounded-full animate-pulse delay-75"></div>
      </div>

      <div className="relative z-10 flex flex-col items-center">
          <div className="w-32 h-32 bg-white dark:bg-slate-800 dark:bg-slate-800 rounded-full flex items-center justify-center mb-10 shadow-2xl animate-bounce">
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
              className="w-full max-w-xs bg-gradient-to-b from-white to-slate-50 dark:from-slate-800 dark:to-slate-900 text-slate-900 dark:text-white py-5 rounded-[1.5rem] text-xl font-black shadow-xl shadow-white/20 dark:shadow-black/40 border border-white/50 dark:border-white/10 hover:-translate-y-1 hover:shadow-2xl active:translate-y-0 active:scale-95 transition-all duration-300 flex items-center justify-center gap-3"
          >
              <Check className="w-7 h-7 text-green-500" />
              ¡Estoy despierto!
          </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] bg-white dark:bg-slate-800 dark:bg-slate-800 font-sans antialiased text-slate-900 dark:text-white selection:bg-indigo-100 selection:text-indigo-900 dark:text-indigo-200 overflow-x-hidden">
      <AnimatePresence mode="wait">
        <motion.div
           key={status}
           initial={{ opacity: 0, scale: 0.98, filter: "blur(4px)" }}
           animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
           exit={{ opacity: 0, scale: 1.02, filter: "blur(4px)" }}
           transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
           className="w-full min-h-[100dvh] flex flex-col"
        >
          {status === AppStatus.IDLE && renderIdle()}
          {status === AppStatus.ALERTS && renderAlerts()}
          {status === AppStatus.ALARMS_LIST && renderAlarmsList()}
          {status === AppStatus.PROFILE && renderProfile()}
          {status === AppStatus.SETTINGS && renderSettings()}
          {status === AppStatus.SEARCHING && renderSearching()}
          {status === AppStatus.CONFIRMING && renderConfirming()}
          {status === AppStatus.TRACKING && renderTracking()}
          {status === AppStatus.ALARM_TRIGGERED && renderAlarm()}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default App;