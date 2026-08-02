# Fixplan: Piper ocasionalmente solo lee la primera frase

## Síntoma

De forma ocasional, el mensaje del modelo se muestra **completo** en el chat (los chunks de texto llegan todos), pero Piper solo pronuncia la **primera frase**. El resto del contenido no se escucha.

## Arquitectura relevante (flujo del audio)

1. Cliente → `POST /api/chat-tts` con el texto del modelo.
2. `src/pages/api/chat-tts.ts`: `generateResponseStream()` genera texto por chunks → `splitSentences()` divide en frases → `writeSentence()` envía cada frase al stdin de Piper (JSON por línea).
3. `src/lib/piperStream.ts`: proceso Piper persistente (`--json-input --output_raw`). El stdout (PCM raw) se captura con `onPiperAudio()` y se envía al cliente como mensajes `{audio}` en NDJSON.
4. Cliente: `src/components/AudioRecorder.astro` → `playPcmChunk()` reproduce cada `{audio}` con Web Audio, encadenando `nextPlayTime`.

Como el texto llega completo y solo falla el audio, el problema está en el **servidor** (envío de `{audio}`) o en la **reproducción del cliente**; no en el texto generado.

## Hipótesis (ordenadas por probabilidad)

### H1 — `waitForDrain()` cierra el stream antes de tiempo (ALTA)
`chat-tts.ts` cierra la respuesta cuando hay `DRAIN_SILENCE_MS` (700ms) de silencio entre audios. Una vez `gotAudio = true`, el stream depende de que llegue audio **cada <700ms**.
- Si hay una pausa >700–900ms entre el audio de la frase 1 y la frase 2 (carga alta de CPU compartida con el LLM, frase muy larga, throttling del sistema), el stream se cierra y **solo llega el audio de la primera frase**.
- Es intermitente porque depende de picos de latencia de Piper en ese momento.
- **Evidencia esperable**: `audioChunksSent` (en logs) < número de frases escritas.

### H2 — Piper muere/se cuelga a mitad de la síntesis (MEDIA)
- `writeSentence()` hace **no-op silencioso** si `!isPiperRunning()` (piperStream.ts:53-56). Si Piper crashea tras la primera frase (error interno, EPIPE por stdin lleno, OOM), las frases siguientes se pierden **sin ningún error visible**.
- `piper.stderr` se descarta por completo (`piperStream.ts:44`), así que no se loguea la causa.
- **Evidencia esperable**: eventos `error`/`exit` de Piper entre frases, `isPiperRunning() === false` a mitad de un request.

### H3 — Concurrencia: dos requests comparten el mismo Piper (MEDIA-BAJA)
- `piperStream` es un singleton. Si hay dos requests activos a la vez (dos pestañas, o un request previo que aún drena), ambos escriben al **mismo stdin** y ambos escuchan el **mismo stdout** → audio intercalado/cruzado; el cliente puede reproducir solo una parte.
- **Evidencia esperable**: reproducción errática solo cuando hay superposición de requests.

### H4 — Piper no está listo justo tras el `spawn` (BAJA)
- `ensurePiperStarted()` resuelve inmediatamente tras `spawn()` sin esperar a que Piper cargue el modelo. Una escritura demasiado temprana podría perderse. (Síntoma más probable: *sin* audio; se lista para descartar.)

### H5 — Cliente: AudioContext suspendido / throttling (MEDIA — descartar)
- Si `AudioContext` está `suspended` (pestaña en background, política de autoplay, tiempo sin interactuar), los chunks se programan pero no suenan; al reanudar solo se oye lo que alcanzó a programarse.
- **Evidencia esperable**: `ctx.state !== 'running'` al momento de `playPcmChunk`, aunque el servidor haya enviado todos los `{audio}`.

## Pasos de investigación

1. **Instrumentar `src/pages/api/chat-tts.ts`**
   - Contar `sentencesWritten` y `audioChunksSent` por request.
   - Al cerrar, loguear la decisión de `waitForDrain` (valores de `sinceAudio`/`sinceWrite`) y la diferencia `sentencesWritten - audioChunksSent`.
   - Medir la distribución de gaps entre audios consecutivos.

2. **Instrumentar `src/lib/piperStream.ts`**
   - Dejar de descartar `stderr`; loguearlo con timestamp.
   - Loggear eventos `error` / `exit` / `close` de Piper.
   - Loggear cuando `writeSentence()` no-op (proceso caído) y el valor de retorno de `piper.stdin.write()` (backpressure).
   - Manejar `piper.stdin.on('drain')` para escribir respetando backpressure y evitar EPIPE.

3. **Harness de reproducción (determinista)**
   - Llamar `/api/chat-tts` con un texto fijo multi-frase N veces (p. ej. 30–50) y verificar que `audioChunksSent === sentencesWritten` en todas.
   - Si se detecta un caso fallido, volcar logs de stderr/exit del momento.

4. **Prueba de concurrencia**
   - Disparar 2 POST simultáneos y comprobar cruce/pérdida de audio.

5. **Verificación en cliente**
   - En `playPcmChunk()`, loguear `ctx.state` y `ctx.currentTime`; comparar contra la cantidad de `{audio}` recibidos para separar H1/H2 (servidor) de H5 (cliente).

## Correcciones candidatas (según hallazgo)

- **Si H1**:
  - Subir `DRAIN_SILENCE_MS` (p. ej. 1500–2000ms) y/o
  - Drenaje por conteo: cerrar solo cuando `audioChunksSent >= sentencesWritten` **y** haya silencio ≥ umbral. Reemplazar el chequeo de silencio "a ciegas" por "todas las frases ya habladas + margen de silencio".
  - No cerrar el stream mientras haya frases pendientes de sintetizar.

- **Si H2**:
  - Reintentar las escrituras perdidas o reiniciar Piper al detectar muerte a mitad del request.
  - Propagar el error al cliente en lugar de cerrar en silencio (enviar `{error}` con `done`).
  - No descartar `stderr`.

- **Si H3**: serializar los requests con una cola/mutex o un pool de procesos Piper (un proceso por request activo).

- **Si H4**: esperar a que Piper esté estable (p. ej. pequeño delay o detección de arranque) antes de la primera escritura.

- **Si H5**: asegurar `initAudioCtx()` en cada gesto del usuario y verificar `state === 'running'` antes de programar; si no, reintentar la reanudación.

## Criterio de éxito

- N iteraciones consecutivas (p. ej. 30) con texto multi-frase donde `audioChunksSent === sentencesWritten` y la reproducción completa sea audible.
- Sin logs de frases perdidas ni de gaps que superen el umbral.
- Sin errores de Piper en stderr durante la prueba.
