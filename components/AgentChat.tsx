import React, { useState, useRef, useEffect } from 'react';
import { useAgent } from '../contexts/AgentContext';
import { chatWithAgent, extractMissionData, findLocation, getPlaceSuggestions } from '../services/gemini';
import { Search, Send, Loader2, Sparkles, AlertCircle, CheckCircle2, MapPin } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Message {
  role: 'user' | 'model';
  text: string;
}

interface AgentChatProps {
  onLocationFound: (location: any) => void;
}

export const AgentChat = ({ onLocationFound }: AgentChatProps) => {
  const { mission, setMission, setIsThinking, isThinking } = useAgent();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const suggestionTimeout = useRef<any>(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Autocomplete Logic
  useEffect(() => {
    if (suggestionTimeout.current) clearTimeout(suggestionTimeout.current);

    if (input.trim().length > 3 && !isThinking) {
      suggestionTimeout.current = setTimeout(async () => {
        setIsSuggesting(true);
        try {
          const res = await getPlaceSuggestions(input, null);
          setSuggestions(res);
          if (res.length > 0) setShowSuggestions(true);
        } catch (e) {
          console.error("Error fetching suggestions", e);
        } finally {
          setIsSuggesting(false);
        }
      }, 600);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [input, isThinking]);

  const handleSelectSuggestion = async (suggestion: string) => {
    setInput(suggestion);
    setShowSuggestions(false);
    await processInput(suggestion);
  };

  const processInput = async (userMessage: string) => {
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setIsThinking(true);
    setIsOpen(true);

    try {
      // 1. Proactively try to geocode if it looks like a direct location search
      if (userMessage.length < 50) {
        try {
          const location = await findLocation(userMessage);
          onLocationFound(location);
          setMessages(prev => [...prev, { 
            role: 'model', 
            text: `¡Entendido! He configurado el destino en ${location.name}. ¿Deseas que coordine algo más para este viaje?` 
          }]);
          setIsThinking(false);
          return;
        } catch (err) {
          // Fallback to agent if direct geocode fails
        }
      }

      // 2. Process with Gemini Agent (Function Calling)
      const result = await chatWithAgent(userMessage, messages.map(m => ({ 
        role: m.role, 
        parts: [{ text: m.text }] 
      })));

      setMessages(prev => [...prev, { role: 'model', text: result.text }]);

      // 3. Proactively try to extract mission data
      if (!mission || !mission.destination) {
        const extracted = await extractMissionData(userMessage);
        if (extracted.destination) {
          setMission(extracted);
          try {
            const location = await findLocation(extracted.destination);
            onLocationFound(location);
          } catch (err) {
            console.error("No se pudo geocodificar el destino extraído", err);
          }
        }
      }

    } catch (error) {
      console.error("Error en AgentChat:", error);
      setMessages(prev => [...prev, { 
        role: 'model', 
        text: "Hubo un inconveniente al procesar tu solicitud. Pero no te preocupes, como persona usuaria de NapNav siempre tienes mi apoyo. ¿Cómo te gustaría continuar?" 
      }]);
    } finally {
      setIsThinking(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isThinking) return;
    await processInput(input.trim());
  };

  return (
    <div className="w-full max-w-md mx-auto relative z-30">
      {/* Search/Chat Trigger */}
      <div className="relative group">
        <div className="absolute inset-0 bg-indigo-500/20 rounded-[2rem] blur-2xl opacity-0 group-focus-within:opacity-100 transition-opacity pointer-events-none"></div>
        <div className="relative overflow-hidden rounded-[2rem] p-px bg-gradient-to-b from-slate-200 to-slate-100 focus-within:from-indigo-400 focus-within:to-violet-400 transition-all shadow-xl shadow-slate-200/50">
          <div className="bg-white rounded-[1.95rem] flex items-center p-2">
            <button 
              onClick={() => setIsOpen(!isOpen)}
              className="p-3 text-slate-400 hover:text-indigo-500 transition-colors"
            >
              <Sparkles className={`w-6 h-6 ${isThinking ? 'animate-pulse text-indigo-500' : ''}`} />
            </button>
            <form onSubmit={handleSubmit} className="flex-1 flex items-center">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onFocus={() => {
                  if (suggestions.length > 0) setShowSuggestions(true);
                }}
                placeholder="¿A dónde vas hoy? (ej: UTEC Minas martes)"
                className="flex-1 py-3 px-2 outline-none text-slate-800 placeholder:text-slate-400 font-medium"
              />
              <div className="flex items-center gap-1 pr-1">
                {isSuggesting && <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />}
                <button 
                  type="submit"
                  disabled={!input.trim() || isThinking}
                  className="bg-indigo-600 text-white p-3 rounded-2xl disabled:opacity-30 hover:bg-indigo-700 transition-all active:scale-95"
                >
                  {isThinking ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Autocomplete Suggestions */}
        <AnimatePresence>
          {showSuggestions && suggestions.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute top-[calc(100%+8px)] left-0 right-0 bg-white/95 backdrop-blur-xl rounded-[2rem] shadow-2xl border border-slate-100 overflow-hidden z-40"
            >
              <ul className="divide-y divide-slate-50">
                {suggestions.map((s, idx) => (
                  <li key={idx}>
                    <button
                      onClick={() => handleSelectSuggestion(s)}
                      className="w-full text-left px-5 py-4 hover:bg-indigo-50 transition-colors flex items-center gap-3 text-slate-600"
                    >
                      <MapPin className="w-4 h-4 text-slate-400" />
                      <span className="truncate text-sm font-medium">{s}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Chat Display Overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute top-[calc(100%+12px)] left-0 right-0 bg-white/95 backdrop-blur-xl rounded-[2rem] shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[400px]"
          >
            <div className="p-4 bg-slate-50/50 border-b border-slate-100 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Agente NapNav Activo</span>
              </div>
              <div className="flex items-center gap-2">
                {mission && (
                  <div className="flex items-center gap-1 text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-bold">
                    <CheckCircle2 className="w-3 h-3" />
                    Misión: {mission.destination}
                  </div>
                )}
                <button 
                  onClick={() => setIsOpen(false)}
                  className="text-slate-400 hover:text-slate-600 p-1"
                >
                  <AlertCircle className="w-4 h-4 rotate-45" />
                </button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[100px]">
              {messages.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-slate-400 text-sm">Empieza a planificar tu viaje conmigo.</p>
                </div>
              )}
              {messages.map((m, idx) => (
                <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${
                    m.role === 'user' 
                      ? 'bg-indigo-600 text-white rounded-tr-none' 
                      : 'bg-slate-100 text-slate-700 rounded-tl-none'
                  }`}>
                    {m.text}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            {isThinking && (
              <div className="p-4 flex items-center gap-2 text-indigo-500 text-xs font-medium italic bg-white border-t border-slate-100">
                <Loader2 className="w-3 h-3 animate-spin" />
                NapNav está coordinando tu llegada...
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
