# Plan: Pronunciar tokens del modelo en streaming (sin esperar el texto completo)

## 1. Contexto actual

Flujo actual en `src/components/AudioRecorder.astro`:

1. El usuario graba audio → `POST /api/process-audio` → **Whisper** transcribe.
2. El cliente envía la transcripción a `POST /api/chat` → **Gemma** (vía `llama-server`, `src/lib/llamaServer.ts:completeStream`) devuelve tokens como NDJSON.
3. El cliente acumula TODOS los tokens en `fullResponse` y solo al terminar el stream llama `speakText(fullResponse)`.
4. `speakText` hace `POST /api/tts` → **Piper** sintetiza el WAV completo → `audio.play()`.

### Problema
El usuario espera **dos veces**: primero que el modelo termine de generar (~70 tokens en CPU, varios segundos) y luego que Piper sintetice el texto completo. No se pronuncia nada hasta el final.

### Aclaración de términos
- **Whisper** = reconocimiento de voz (audio → texto), `src/lib/modelManager.ts:transcribeAudio`.
- **Piper** = el que pronuncia (texto → audio), `src/pages/api/tts.ts`.
- Para "pronunciar tokens conforme llegan" el destino es **Piper**, no Whisper. El plan aplica a Piper.

## 2. Objetivo

Que el audio empiece a sonar con las **primeras oraciones** mientras el modelo sigue generando, en lugar de esperar el texto completo.

## 3. Granularidad recomendada

Pronunciar **token a token no tiene sentido** (un token suele ser parte de una palabra). La granularidad correcta es **oración / grupo de pensamiento**:

- Se acumulan tokens en un búfer.
- Al detectar fin de oración (`.`, `!`, `?`, `...`, salto de línea) se despacha esa oración a Piper.
- Piper habla esa oración mientras el modelo sigue generando las siguientes.
- Piper añade ~0.2 s de silencio entre oraciones (`--sentence_silence`), lo que produce pausas naturales.

## 4. Diseño v1 (mínimo viable)

El cliente es quien orquesta (ya recibe los tokens por NDJSON). El servidor se reutiliza casi sin cambios.

### Servidor

1. **`src/lib/sentenceSplitter.ts`** (nuevo)
   - `splitSentences(text: string): { sentences: string[]; remainder: string }`
   - Divide por `/([.!?…]+)(?=\s|$)/` o saltos de línea.
   - Regla conservadora: solo corta si el signo va seguido de espacio o fin (evita romper abreviaciones tipo `Mr.`).
   - Longitud máxima de búfer (~120 chars): si una oración es muy larga y no tiene puntuación, forzar corte para no bloquear la voz.
   - Devuelve el `remainder` para seguir acumulando.

2. **Reutilizar `POST /api/tts`** (no requiere cambios en v1)
   - Se llama **una vez por oración**, no por respuesta completa.
   - Cada llamada devuelve el WAV de esa oración.
   - Nota: `src/pages/api/tts.ts:buildWav` normaliza el pico al 80 % por oración; la variación de volumen entre frases es menor (riesgo bajo, se puede revisar en v2).

### Cliente (`src/components/AudioRecorder.astro`)

3. **Búfer de oraciones en el bucle NDJSON** (donde hoy se acumula `fullResponse`):
   - Por cada `parsed.chunk`, añadirlo al búfer y a `fullResponse` (el texto del mensaje sigue mostrándose completo, como ahora).
   - Llamar `splitSentences(buffer)`; enviar cada `sentence` a `queueSpeech(sentence)` y guardar el `remainder`.
   - Al recibir `{ done: true }`, hacer un último flush del `remainder` (si no está vacío).

4. **Cola de reproducción** (`queueSpeech`):
   - Encadenar los `fetch('/api/tts')` en una **promise chain** (serializar) para no lanzar varios procesos Piper concurrentes en CPU.
   - Mantener `audioQueue: string[]` (URLs de objetos) + flag `isPlaying`.
   - `playNext()`: si no está sonando y hay audio en cola, crea `new Audio(url)` y reproduce; al `ended` pasa al siguiente.
   - La primera oración suena apenas Piper la sintetiza, sin esperar al resto del modelo.

5. **UI/estado**:
   - `status = 'Speaking...'` al empezar la cola.
   - Volver a `'Click to start recording'` solo cuando la **última** oración termina (`queue empty && !isPlaying`).
   - Si el usuario inicia una nueva grabación mientras suena audio, detener la cola y la reproducción (limpiar `audioQueue`, pausar `audio`).
   - Mantener el caché `audioCache` existente, con la oración como clave.

## 5. Diseño v2 (mejora de latencia, opcional)

Proceso Piper persistente en vez de reiniciar por oración.

- **Validado:** `piper.exe --json-input --output_raw` procesa cada línea JSON en cuanto llega, sin esperar EOF (cada oración produce su audio inmediatamente).
- **Servidor:** módulo `src/lib/piperStream.ts` que mantiene un único proceso Piper, con un `synthesize(sentence) => Promise<Buffer>` que escribe `{"text":"..."}\n` a stdin y acumula el PCM de salida.
  - Dificultad: delimitar el audio de una oración vs. la siguiente en stdout. Opciones:
    - Detectar silencio en el PCM (`--sentence_silence` añade silencio al final de cada oración) por análisis de amplitud.
    - O no delimitar: enviar PCM continuo al cliente y reproducirlo concatenado con Web Audio API (el silencio entre oraciones suena natural).
- **Endpoint SSE `POST /api/tts/stream`:** mantiene la conexión, recibe oraciones del cliente (o mejor aún, orquesta el stream del modelo en el servidor) y transmite PCM/WAV por trozos.
- **Cliente:** reproducir con `AudioContext` (cola de `AudioBuffer`) en vez de `<audio>` para latencia mínima; `buildWav` se reemplaza por alimentar directamente PCM normalizado.

## 6. Casos borde

| Caso | Manejo |
|------|--------|
| Abreviaciones (`Mr.`, `U.S.`) | El divisor exige espacio/EOF después del signo; poco frecuente en texto conversacional. |
| Oración sin puntuación al final | Flush al llegar `done`, o corte por longitud máxima (~120 chars). |
| Oración extremadamente larga | Corte forzado por longitud para que la voz no se bloquee. |
| Resto vacío | No enviar a TTS oraciones en blanco. |
| Cancelación / nueva grabación | Parar cola y audio actual. |
| Fallo de Piper en una oración | `catch` por oración: seguir con la siguiente, sin romper el stream. |

## 7. Validación

1. `npx astro dev` (ver `AGENTS.md`: usar `astro dev --background`).
2. Hablar una frase y verificar:
   - El texto del mensaje se completa token a token (como ahora).
   - El audio empieza con la **primera oración**, antes de que termine de escribirse la respuesta.
3. Medir y comparar el tiempo hasta el primer audio (antes: fin del modelo + síntesis completa; después: primera oración lista).
4. Probar 2–3 turnos consecutivos y una cancelación a mitad de la pronunciación.

## 8. Archivos afectados

| Archivo | Cambio |
|---------|--------|
| `src/lib/sentenceSplitter.ts` | Nuevo: divisor de oraciones con `remainder`. |
| `src/components/AudioRecorder.astro` | Búfer de oraciones, `queueSpeech`, cola de reproducción, flush final. |
| `src/pages/api/tts.ts` | Sin cambios en v1 (reutilizado por oración). |
| `src/lib/piperStream.ts` (v2) | Nuevo: proceso Piper persistente con `--json-input`. |
| `src/pages/api/tts/stream.ts` (v2) | Nuevo: endpoint SSE de síntesis continua. |
