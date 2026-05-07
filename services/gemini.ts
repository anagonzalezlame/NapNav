import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { LocationInfo, Coordinates, AlarmIntensity, AgentMission } from "../types";

const getAi = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("GEMINI_API_KEY no detectada. NapNav funcionará en modo degradado.");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

// --- Mock Implementations for Function Calling ---
const get_calendar_events = async () => {
  // Mock data for "Grupo Rhea" in UTEC
  return [
    { event: "Entrega Final Rhea", date: "Martes", time: "18:00", location: "UTEC Minas" },
    { event: "Examen de Algoritmos", date: "Miércoles", time: "10:00", location: "UTEC Minas" }
  ];
};

const check_weather = async (city: string) => {
  if (city.toLowerCase().includes("minas")) return "Lluvioso, posibles retrasos de 10-15 minutos.";
  return "Despejado.";
};

const calculate_eta = async (current: string, dest: string, mode: string) => {
  const baseMinutes = 45;
  const variance = Math.floor(Math.random() * 15);
  const totalMinutes = baseMinutes + variance;
  const now = new Date();
  const eta = new Date(now.getTime() + totalMinutes * 60000);
  return { 
    minutes: totalMinutes, 
    eta_time: eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    status: totalMinutes > 50 ? "delayed" : "on_time"
  };
};

const tools = [
  {
    functionDeclarations: [
      {
        name: "get_calendar_events",
        description: "Busca fechas de exámenes o entregas en el calendario de la persona usuaria para el grupo Rhea.",
      },
      {
        name: "check_weather",
        description: "Consulta el clima para prever retrasos por lluvia en una ciudad específica.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            city: { type: Type.STRING, description: "Ciudad para consultar el clima." },
          },
          required: ["city"],
        },
      },
      {
        name: "send_whatsapp_notification",
        description: "Solicita enviar una notificación al grupo de estudio si hay demoras.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            group: { type: Type.STRING, description: "Nombre del grupo (ej: Rhea)." },
            message: { type: Type.STRING, description: "Mensaje a enviar." },
          },
          required: ["group", "message"],
        },
      },
      {
        name: "calculate_eta",
        description: "Estima el tiempo de llegada dinámico basado en tráfico y clima.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            current_location: { type: Type.STRING },
            destination: { type: Type.STRING },
            transport_mode: { type: Type.STRING, description: "bus, car o walking" },
          },
          required: ["current_location", "destination", "transport_mode"],
        },
      },
    ],
  },
];

const functionHandlers: any = {
  get_calendar_events,
  check_weather,
  calculate_eta,
  send_whatsapp_notification: async (args: any) => {
    return { success: true, status: "pending_confirmation", message: `Notificación para ${args.group} preparada.` };
  }
};

export const chatWithAgent = async (message: string, history: any[] = []) => {
  const ai = getAi();
  if (!ai) throw new Error("AI no disponible");

  // Modern way: use ai.models.generateContent
  // History needs to be formatted for the SDK
  const formattedHistory = history.map(h => ({
    role: h.role === 'model' ? 'model' : 'user',
    parts: h.parts ? h.parts : [{ text: h.text }]
  }));

  const systemInstruction = `Eres NapNav, un Agente Autónomo de Movilidad empático y proactivo. 
    Tu misión es gestionar los viajes de la persona usuaria, previendo retrasos y coordinando con su calendario (especialmente para el grupo 'Rhea' en UTEC).
    Usa lenguaje inclusivo y no sexista (ej: 'persona usuaria', 'quienes integran el grupo').
    
    Cuando el usuario te diga algo como "Tengo que ir a la UTEC en Minas el martes para la entrega de Rhea", debes:
    1. Consultar el calendario para confirmar la hora.
    2. Verificar el clima.
    3. Estimar el ETA.
    4. Informar a la persona usuaria y, si el ETA > hora del evento + 5 min, sugerir avisar al grupo.
    
    Si una API falla, maneja la frustración con empatía.`;

  let contents = [...formattedHistory, { role: 'user', parts: [{ text: message }] }];

  try {
    let response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        tools: tools,
      }
    });

    // Handle tool calls loop (limited to 5)
    for (let i = 0; i < 5; i++) {
        const fCalls = response.functionCalls;
        if (!fCalls || fCalls.length === 0) break;

        const results = await Promise.all(fCalls.map(async (call) => {
            const handler = functionHandlers[call.name];
            if (handler) {
                const res = await handler(call.args);
                return {
                    functionResponse: {
                        name: call.name,
                        response: res
                    }
                };
            }
            return null;
        }));

        const filteredResults = results.filter(r => r !== null);
        if (filteredResults.length === 0) break;

        // Append the tool call response and original call to history
        contents.push({ role: 'model', parts: fCalls.map(f => ({ functionCall: f })) });
        contents.push({ role: 'user', parts: filteredResults as any });

        response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: contents,
            config: {
                systemInstruction: systemInstruction,
                tools: tools,
            }
        });
    }

    return {
      text: response.text || "No obtuve una respuesta clara.",
      history: contents // Not perfect but keeps the context for manual tracking if needed
    };

  } catch (error) {
    console.error("Gemini Agent Error:", error);
    throw error;
  }
};

export const extractMissionData = async (query: string): Promise<AgentMission> => {
  const ai = getAi();
  if (!ai) throw new Error("AI no disponible");
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Extrae los datos de misión de: "${query}".
    Devuelve JSON con: destination, date, context. Si no los hay, devuelve strings vacíos.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          destination: { type: Type.STRING },
          date: { type: Type.STRING },
          context: { type: Type.STRING },
        },
        required: ["destination", "date", "context"],
      }
    }
  });

  return JSON.parse(response.text || "{}") as AgentMission;
};

/**
 * Processes a natural language query to find a specific location.
 */
export const findLocation = async (query: string): Promise<LocationInfo> => {
  const ai = getAi();
  if (!ai) throw new Error("AI no disponible");
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Extrae la ubicación de la siguiente consulta: "${query}".
    Devuelve un objeto JSON con:
    - lat: Latitud (número)
    - lng: Longitud (número)
    - name: Nombre corto del lugar
    - address: Dirección legible en Montevideo, Uruguay.
    Si la ubicación es ambigua, asume que está en Montevideo.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          lat: { type: Type.NUMBER },
          lng: { type: Type.NUMBER },
          name: { type: Type.STRING },
          address: { type: Type.STRING },
        },
        required: ["lat", "lng", "name", "address"],
      },
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("No se pudo resolver la ubicación");
  }

  return JSON.parse(text) as LocationInfo;
};

/**
 * Provides autocomplete suggestions based on user context.
 */
export const getPlaceSuggestions = async (query: string, userLocation: Coordinates | null): Promise<string[]> => {
  const ai = getAi();
  if (!ai) return [];

  let contextInstruction = "";
  
  if (userLocation) {
    contextInstruction = `
      User Location: Lat ${userLocation.lat}, Lng ${userLocation.lng}.
      
      RANKING PRIORITY:
      1. HIGHEST PRIORITY: Places matching the query strictly within a 5km radius of the User Location.
      2. SECONDARY PRIORITY: Places matching the query within a 50km radius.
      
      Sort the results so the closest places appear first.
    `;
  } else {
    contextInstruction = "User location unknown. Provide general suggestions for Montevideo.";
  }
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `
      Act as a location search autocomplete engine for a local travel alarm app.
      Query: "${query}"
      ${contextInstruction}
      
      Return 5 distinct, relevant location names or addresses (in Spanish).
      Return ONLY a JSON array of strings.
    `,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: { type: Type.STRING }
      }
    }
  });

  const text = response.text;
  if (!text) return [];
  try {
    return JSON.parse(text) as string[];
  } catch (e) {
    return [];
  }
};

const audioCache: Record<string, string> = {};
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Generates a text script for the alarm based on intensity.
 */
export const generateAlarmAudio = async (locationName: string, intensity: AlarmIntensity = 'normal'): Promise<string> => {
  const cacheKey = `${locationName}_${intensity}`;
  
  if (audioCache[cacheKey]) {
    return audioCache[cacheKey];
  }

  const ai = getAi();
  if (!ai) return `¡Llegaste a ${locationName}!`;

  const prompt = `Genera un mensaje corto (1 oración) para TTS en Español Rioplatense al llegar a "${locationName}". Tono: ${intensity} (soft=amable, normal=directo, intense=urgente/mayúsculas). Solo el texto.`;

  const maxRetries = 2;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt
      });
      const result = response.text?.trim() || `¡Llegaste a ${locationName}!`;
      audioCache[cacheKey] = result;
      return result;
    } catch (error: any) {
      attempt++;
      const statusCode = error?.status || 'UNKNOWN';
      if (statusCode === 429 && attempt <= maxRetries) {
        await delay(Math.pow(2, attempt) * 500);
      } else {
        return `¡Llegaste a ${locationName}!`;
      }
    }
  }
  
  return "FALLBACK_BEEP";
};
