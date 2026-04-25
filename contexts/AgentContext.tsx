import React, { createContext, useContext, useState, ReactNode } from 'react';
import { AgentState, AgentMission, TripMood, PendingAction } from '../types';

interface AgentContextType extends AgentState {
  setMission: (mission: AgentMission) => void;
  setMood: (mood: TripMood) => void;
  addPendingAction: (action: PendingAction) => void;
  removePendingAction: (id: string) => void;
  setIsThinking: (isThinking: boolean) => void;
}

const AgentContext = createContext<AgentContextType | undefined>(undefined);

export const AgentProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<AgentState>({
    mission: null,
    mood: 'relaxed',
    pendingActions: [],
    isThinking: false,
  });

  const setMission = (mission: AgentMission) => {
    setState(prev => ({ ...prev, mission }));
  };

  const setMood = (mood: TripMood) => {
    setState(prev => ({ ...prev, mood }));
  };

  const addPendingAction = (action: PendingAction) => {
    setState(prev => ({ ...prev, pendingActions: [...prev.pendingActions, action] }));
  };

  const removePendingAction = (id: string) => {
    setState(prev => ({ ...prev, pendingActions: prev.pendingActions.filter(a => a.id !== id) }));
  };

  const setIsThinking = (isThinking: boolean) => {
    setState(prev => ({ ...prev, isThinking }));
  };

  return (
    <AgentContext.Provider value={{ 
      ...state, 
      setMission, 
      setMood, 
      addPendingAction, 
      removePendingAction, 
      setIsThinking 
    }}>
      {children}
    </AgentContext.Provider>
  );
};

export const useAgent = () => {
  const context = useContext(AgentContext);
  if (context === undefined) {
    throw new Error('useAgent must be used within an AgentProvider');
  }
  return context;
};
