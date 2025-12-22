# NapNav: La app para no pasarte de parada en el bondi 🚌💤

NapNav es una aplicación web progresiva (PWA) diseñada para que puedas dormir tranquilo en el transporte público. Utiliza geolocalización en tiempo real para despertarte exactamente antes de llegar a tu destino, sin depender de horarios estimados, sino de tu ubicación real.

## 🚀 Tecnologías

Este proyecto ha sido construido utilizando tecnologías web modernas:

*   **React 19**: Para una interfaz de usuario fluida y reactiva.
*   **Leaflet & React-Leaflet**: Para la visualización de mapas y radios de geolocalización.
*   **Gemini AI (@google/genai)**: Potencia la búsqueda de lugares (incluso con nombres coloquiales) y genera los guiones de las alarmas con personalidad.
*   **Tailwind CSS**: Para un diseño limpio, moderno y *mobile-first*.
*   **Web APIs**: Uso intensivo de Geolocation API, Web Speech API (TTS), Vibration API y Screen Wake Lock API.

## ✨ Características

*   **Búsqueda Semántica**: Gracias a Gemini, podés buscar "Casa de la abuela en Pocitos" y entenderá a dónde querés ir si tenés la dirección aproximada.
*   **Alarmas de Ubicación**: La alarma se dispara al entrar en un radio configurable (ej. 500m antes).
*   **Intensidad Configurable**:
    *   *Suave*: Un aviso amable.
    *   *Normal*: Un aviso informativo estándar.
    *   *Intenso*: Gritos y vibración fuerte para los de sueño pesado (estilo Rioplatense).
*   **Modo Offline (PWA)**: Se puede instalar en la pantalla de inicio y se siente como una app nativa.

---

*Desarrollada con la ayuda de Google AI Studio.*
