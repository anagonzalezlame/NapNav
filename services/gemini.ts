import { GoogleGenAI, Type } from "@google/genai";
import { LocationInfo, Coordinates, AlarmIntensity } from "../types";

const getAi = () => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Error crítico: VITE_GEMINI_API_KEY no está definida en las variables de entorno.");
    throw new Error("Error de configuración para la persona usuaria: La clave de Gemini no está configurada.");
  }
  return new GoogleGenAI({ apiKey });
};

/**
 * Processes a natural language query to find a specific location.
 */
export const findLocation = async (query: string): Promise<LocationInfo> => {
  const response = await getAi().models.generateContent({
    model: 'gemini-3.1-flash-lite-preview',
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

  if (!response.text) {
    throw new Error("No se pudo resolver la ubicación");
  }

  return JSON.parse(response.text) as LocationInfo;
};

/**
 * Provides autocomplete suggestions based on user context.
 */
export const getPlaceSuggestions = async (query: string, userLocation: Coordinates | null): Promise<string[]> => {
  let contextInstruction = "";
  
  if (userLocation) {
    contextInstruction = `
      User Location: Lat ${userLocation.lat}, Lng ${userLocation.lng}.
      
      RANKING PRIORITY:
      1. HIGHEST PRIORITY: Places matching the query strictly within a 5km radius of the User Location.
      2. SECONDARY PRIORITY: Places matching the query within a 50km radius.
      3. Do NOT suggest places further than 50km unless the query explicitly includes a specific city name implying a long-distance search.
      
      Sort the results so the closest places appear first.
    `;
  } else {
    contextInstruction = "User location unknown. Provide general global suggestions.";
  }
  
  const response = await getAi().models.generateContent({
    model: 'gemini-3.1-flash-lite-preview',
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

  if (!response.text) return [];
  try {
    return JSON.parse(response.text) as string[];
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
  
  // 1. Audio Cache: Check if we already generated a message for this location and intensity
  if (audioCache[cacheKey]) {
    console.log(`[Cache Hit] Usando mensaje guardado para: ${cacheKey}`);
    return audioCache[cacheKey];
  }

  // 2. Optimización de Prompt: Más corto y directo para ahorrar tokens y tiempo
  const prompt = `Genera un mensaje corto (1 oración) para TTS en Español Rioplatense al llegar a "${locationName}". Tono: ${intensity} (soft=amable, normal=directo, intense=urgente/mayúsculas). Solo el texto.`;

  const maxRetries = 2;
  let attempt = 0;

  // 3. Retry Strategy con Exponential Backoff
  while (attempt <= maxRetries) {
    try {
      const response = await getAi().models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: prompt,
      });

      const result = response.text?.trim() || `¡Llegaste a ${locationName}!`;
      
      // Guardar en caché para futuras alarmas en el mismo lugar
      audioCache[cacheKey] = result;
      return result;
      
    } catch (error: any) {
      attempt++;
      
      // 4. Verificación de Cuota: Log detallado para QA
      const statusCode = error?.status || error?.response?.status || 'UNKNOWN';
      const errorMessage = error?.message || 'Sin mensaje de error';
      console.error(`[QA Log] Error Gemini API (Intento ${attempt}/${maxRetries + 1}): Código ${statusCode} - ${errorMessage}`);

      const isRetryable = 
        statusCode === 503 || 
        statusCode === 429 || 
        errorMessage.includes('503') || 
        errorMessage.includes('429') || 
        errorMessage.includes('UNAVAILABLE') || 
        errorMessage.includes('overloaded');

      if (isRetryable && attempt <= maxRetries) {
        const waitTime = Math.pow(2, attempt) * 500; // 1000ms, 2000ms
        console.log(`[Retry] Servidor saturado. Reintentando en ${waitTime}ms...`);
        await delay(waitTime);
      } else if (isRetryable) {
        console.warn("[Fallback] Servidor saturado tras reintentos. Usando alerta básica.");
        return "FALLBACK_BEEP";
      } else {
        // Si es otro tipo de error (ej. 400 Bad Request), no reintentamos y devolvemos texto por defecto
        return `¡Llegaste a ${locationName}!`;
      }
    }
  }
  
  return "FALLBACK_BEEP";
};