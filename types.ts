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
  ALARMS_LIST = 'ALARMS_LIST',
  ALERTS = 'ALERTS',
}

export type AlarmIntensity = 'soft' | 'normal' | 'intense';

export interface AlarmSettings {
  volume: number; // 0 to 100
  vibration: boolean;
  intensity: AlarmIntensity;
  darkMode?: boolean;
}

export type RecurrenceType = 'once' | 'always' | 'daysOfWeek' | 'untilDate';

export interface RecurrenceConfig {
  type: RecurrenceType;
  days?: number[]; // 0 = Sunday, 1 = Monday, etc.
  until?: string; // ISO date string YYYY-MM-DD
}

export interface AlarmConfig {
  id: string;
  enabled: boolean;
  target: LocationInfo;
  radius: number;
  alarmMessage: string;
  recurrence: RecurrenceConfig;
}

export interface SavedPlace extends LocationInfo {
  id: string;
  defaultRadius?: number;
  dateAdded: number;
}

export interface AgentMission {
  destination: string;
  date: string;
  context: string;
  eta?: string;
  eventTime?: string;
}

export type TripMood = 'relaxed' | 'focused' | 'hurried' | 'emergency';

export interface PendingAction {
  id: string;
  type: 'notification' | 'route_change' | 'alarm_update';
  description: string;
  data: any;
}

export interface AgentState {
  mission: AgentMission | null;
  mood: TripMood;
  pendingActions: PendingAction[];
  isThinking: boolean;
}
