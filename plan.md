# Plan: Migrar a base de datos local con análisis incremental

## Stack
- **Base de datos**: SQLite vía `sql.js` (WASM, sin binarios nativos)
- **Runtime**: Node.js (lado servidor Astro)
- **Dependencia**: `npm install sql.js`

## Esquema de base de datos

```sql
-- Intervenciones del usuario (transcripciones)
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,                     -- transcripción del audio
  created_at TEXT DEFAULT (datetime('now')),
  analyzed INTEGER DEFAULT 0             -- 0 = pendiente, 1 = ya corregido
);

-- Correcciones generadas por el modelo
CREATE TABLE corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,           -- FK → messages.id
  original TEXT NOT NULL,                 -- fragmento original con error
  corrected TEXT,                         -- versión corregida
  tip TEXT,                               -- explicación / tip gramatical
  pattern_code TEXT NOT NULL,             -- clasificación del error
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

-- Patrones de corrección (catálogo)
CREATE TABLE patterns (
  code TEXT PRIMARY KEY,                  -- ej. VERB_TENSE
  label TEXT NOT NULL,                    -- ej. "Verb Tense"
  description TEXT                        -- ej. "Incorrect use of verb tenses"
);
```

## Patrones de clasificación (`pattern_code`)

| Código | Descripción |
|--------|-------------|
| VERB_TENSE | Tiempos verbales incorrectos |
| PREPOSITIONS | Uso incorrecto de preposiciones |
| AGE_EXPRESSION | Expresiones de edad/cantidad |
| CONNECTORS | Conectores y transiciones |
| REDUNDANCY | Redundancia o repetición |
| NATURAL_EXPRESSION | Expresión poco natural |
| VOCABULARY_CHOICE | Elección de vocabulario |
| COLLOCATIONS | Colocaciones incorrectas |
| COMPARATIVES_SUPERLATIVES | Comparativos y superlativos |
| COUNTABLE_UNCOUNTABLE | Contables/incontables |
| AUXILIARY_VERBS | Verbos auxiliares |
| WORD_ORDER | Orden de palabras |
| PRONOUNS | Pronombres |
| PLURALS | Plurales |
| ARTICLES | Artículos (a/an/the) |
| OTHER | Otros (fallback) |

## Flujo

### 1. Transcripción de audio (`processAudio`)
```
audio → Whisper → transcripción
  → INSERT INTO messages (text, analyzed=0)
  → responder al cliente
```

### 2. Generar correcciones (botón "Generar Correcciones")
```
  → SELECT id, text FROM messages WHERE analyzed=0
  → si no hay pendientes → mostrar "Todo al día"
  → enviar SOLO textos pendientes al modelo Gemma
    prompt: "Clasifica cada error con uno de estos pattern_code: VERB_TENSE, PREPOSITIONS..."
  → INSERT INTO corrections (message_id, original, corrected, tip, pattern_code)
  → UPDATE messages SET analyzed=1 WHERE id IN (...)
  → devolver correcciones nuevas al panel
```

### 3. Panel de presentación
```
  → SELECT pattern_code, array_agg(original), array_agg(corrected)
    FROM corrections
    GROUP BY pattern_code
    ORDER BY pattern_code
```
- **Una tarjeta por patrón** con título del patrón
- Cada tarjeta lista los ejemplos (original → corregido) acumulados
- Los nuevos ejemplos se agregan a la tarjeta existente del mismo patrón

### 4. Consulta inicial (al cargar el panel)
```
  → SELECT p.code, p.label, c.original, c.corrected, c.tip
    FROM corrections c
    JOIN patterns p ON p.code = c.pattern_code
    ORDER BY p.code, c.created_at DESC
```

## Ventajas respecto a archivos planos

| Aspecto | Archivos planos | Base de datos |
|---------|----------------|---------------|
| Análisis incremental | ❌ Siempre analiza todo | ✅ Solo lo nuevo |
| Deduplicación | ❌ Misma corrección repetida | ✅ Una tarjeta por patrón |
| Clasificación | ❌ Sin estructura | ✅ pattern_code |
| Consultas | ❌ grep manual | ✅ SQL |
| Persistencia | ✅ Simple | ✅ Simple (1 archivo) |

## Pasos de implementación

1. `npm install sql.js`
2. Crear `src/lib/database.ts`:
   - `initDB()` → crea tablas si no existen, inserta patrones por defecto
   - `insertMessage(text)` → inserta utterance no analizada
   - `getPendingMessages()` → SELECT * WHERE analyzed=0
   - `insertCorrection(messageId, original, corrected, tip, patternCode)`
   - `markAnalyzed(messageIds)` → UPDATE messages SET analyzed=1
   - `getCorrectionsByPattern()` → SELECT agrupado por pattern_code
3. Modificar `modelManager.ts`:
   - Importar y llamar `insertMessage()` en `processAudio`
4. Modificar `generate-corrections.ts`:
   - Leer pendientes con `getPendingMessages()`
   - Prompt al modelo pidiendo clasificación por pattern_code
   - Insertar correcciones con `insertCorrection()`
   - Marcar como analizados con `markAnalyzed()`
5. Modificar panel (`index.astro`):
   - Renderizar una tarjeta por pattern_code
   - Cada tarjeta lista ejemplos acumulados
6. Eliminar `UserSpeach.trace` (reemplazado)
7. Mantener `Tips.trace` como backup opcional
