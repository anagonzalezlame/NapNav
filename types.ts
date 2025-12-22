export interface Coordinates {
  lat: number;
  lng: number;
}

export interface LocationInfo extends Coordinates {
  name: string;
  address?: string;
}

export enum AppStatus {
  IDLE = 'IDLE',
  SEARCHING = 'SEARCHING',
  CONFIRMING = 'CONFIRMING',
  TRACKING = 'TRACKING',
  ALARM_TRIGGERED = 'ALARM_TRIGGERED',
  PROFILE = 'PROFILE',
  SETTINGS = 'SETTINGS',
}

export type AlarmIntensity = 'soft' | 'normal' | 'intense';

export interface AlarmSettings {
  volume: number; // 0 to 100
  vibration: boolean;
  intensity: AlarmIntensity;
}

export interface AlarmConfig {
  target: LocationInfo;
  radius: number;
  alarmMessage: string; // Cambiamos audioBase64 por el texto que leerá Gemini
}

export interface SavedPlace extends LocationInfo {
  id: string;
  defaultRadius?: number;
  dateAdded: number;
}