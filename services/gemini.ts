import { GoogleGenAI, Type } from "@google/genai";
import { LocationInfo, Coordinates, AlarmIntensity } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Processes a natural language query to find a specific location.
 */
export const findLocation = async (query: string): Promise<LocationInfo> => {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Act as a geocoding expert. The user is searching for a location in a casual way.
    
    User Query: "${query}"
    
    1. Identify the intended location.
    2. Return estimated Latitude and Longitude.
    3. Return a clean Name and a short Address (in Spanish).
    
    Return ONLY JSON.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          lat: { type: Type.NUMBER, description: "Latitude" },
          lng: { type: Type.NUMBER, description: "Longitude" },
          name: { type: Type.STRING, description: "Place Name" },
          address: { type: Type.STRING, description: "Address in Spanish" },
        },
        required: ["lat", "lng", "name"],
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
 * Prioritizes close locations (within 5km), then nearby (within 50km).
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

  if (!response.text) return [];
  try {
    return JSON.parse(response.text) as string[];
  } catch (e) {
    return [];
  }
};

/**
 * Generates a text script for the alarm based on intensity.
 * This script will be spoken by the Web Speech API.
 */
export const generateAlarmScript = async (locationName: string, intensity: AlarmIntensity = 'normal'): Promise<string> => {
  // Aquí Gemini puede ser creativo. 
  // Si es 'intense' puede devolver: "¡DESPIERTA! ¡ESTAMOS LLEGANDO A PASO DE LA ARENA! ¡DALE QUE TE PASÁS!"
  // Si es 'soft' puede devolver: "Disculpa, estamos cerca de tu destino en Paso de la Arena."
  
  const prompt = `
    Actúa como un asistente de viaje. Genera un mensaje corto para ser leído en voz alta (TTS) en Español Rioplatense cuando el usuario llega a "${locationName}".
    
    Intensidad: ${intensity}

    Instrucciones de tono:
    - 'soft': Muy amable, tranquilo, gentil. Ejemplo: "Disculpa, ya estamos llegando a tu destino. Prepárate con calma."
    - 'normal': Informativo, claro, directo. Ejemplo: "Llegando a ${locationName}. Por favor prepárate para bajar."
    - 'intense': ¡Urgente! ¡Alarmante! ¡Enérgico! Usa mayúsculas y signos de exclamación para enfatizar. Ejemplo: "¡DESPIERTA! ¡ESTAMOS EN ${locationName}! ¡DALE QUE TE PASÁS!"

    Solo devuelve el texto plano para el TTS. Sin comillas ni explicaciones extra.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
  });

  return response.text?.trim() || `¡Llegaste a ${locationName}!`;
};