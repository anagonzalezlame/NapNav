import React, { useState, useRef, useEffect } from 'react';
import { useAgent } from '../contexts/AgentContext';
import { chatWithAgent, extractMissionData, findLocation } from '../services/gemini';
import { Search, Send, Loader2, Sparkles, AlertCircle, CheckCircle2 } from 'lucide-react';
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
  const chatEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isThinking) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setIsThinking(true);

    try {
      // 1. Process with Gemini Agent (Function Calling)
      const result = await chatWithAgent(userMessage, messages.map(m => ({ 
        role: m.role, 
        parts: [{ text: m.text }] 
      })));

      setMessages(prev => [...prev, { role: 'model', text: result.text }]);

      // 2. Proactively try to extract mission data if not yet complete
      if (!mission || !mission.destination) {
        const extracted = await extractMissionData(userMessage);
        if (extracted.destination) {
          setMission(extracted);
          // Try to geocode the destination
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
                onFocus={() => setIsOpen(true)}
                placeholder="¿A dónde vas hoy? (ej: UTEC Minas martes)"
                className="flex-1 py-3 px-2 outline-none text-slate-800 placeholder:text-slate-400 font-medium"
              />
              <button 
                type="submit"
                disabled={!input.trim() || isThinking}
                className="bg-indigo-600 text-white p-3 rounded-2xl disabled:opacity-30 hover:bg-indigo-700 transition-all active:scale-95"
              >
                {isThinking ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              </button>
            </form>
          </div>
        </div>
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
            <div className="p-4 bg-slate-50/50 border-b border-slate-100 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Agente NapNav Activo</span>
              </div>
              {mission && (
                <div className="flex items-center gap-1 text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-bold">
                  <CheckCircle2 className="w-3 h-3" />
                  Misión: {mission.destination}
                </div>
              )}
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
              <div className="p-4 flex items-center gap-2 text-indigo-500 text-xs font-medium italic">
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
