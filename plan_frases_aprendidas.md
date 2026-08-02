# Plan: Marcar frases como aprendidas (eliminar del panel "Nuevas Expresiones")

## Objetivo

Permitir al usuario hacer clic en un **check** en cada expresión guardada dentro del panel **"Nuevas Expresiones"**. Al hacer clic, la frase se marca como aprendida y se **elimina del panel**.

## Estado actual

- El panel "Nuevas Expresiones" se renderiza en `src/pages/index.astro` (líneas 45-50).
- Las expresiones se cargan vía `GET /api/expressions` y se pintan como `.miniTarjeta` en `loadExpressions()` (líneas 234-254).
- Se agregan frases con `POST /api/expressions/add` (menú contextual, líneas 283-302).
- La función de BD **ya existe**: `deleteExpression(id)` en `src/lib/database.ts:102-106`.
- **Falta**: el endpoint de borrado en el API y el check en el frontend.

## Cambios propuestos

### 1. Backend: endpoint de borrado

Crear `src/pages/api/expressions/[id].ts` con un handler `DELETE`:

```ts
export const DELETE: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return new Response(JSON.stringify({ error: 'Invalid id' }), { status: 400 });
  }
  const { initDB, deleteExpression } = await import('../../../lib/database');
  await initDB();
  await deleteExpression(id);
  return new Response(JSON.stringify({ success: true }), { status: 200 });
};
```

- Ruta: `DELETE /api/expressions/1`.
- Reutiliza `deleteExpression(id)` ya implementado en `src/lib/database.ts:102`.
- `export const prerender = false;` (mismo patrón que los demás endpoints).

### 2. Frontend: check en cada tarjeta

En `loadExpressions()` (`src/pages/index.astro:245-248`), cambiar el render de cada expresión para incluir un check:

```js
expressionsList.innerHTML = data.expressions
  .map((e) => `
    <div class="miniTarjeta">
      <span class="miniTarjeta-text">${e.expression}</span>
      <button class="miniTarjeta-check" data-id="${e.id}" title="Marcar como aprendida">✔</button>
    </div>`)
  .join('');
```

Agregar un listener delegado sobre `#expressions-list` que capture los clics en `.miniTarjeta-check`:

```js
expressionsList.addEventListener('click', async (event) => {
  const btn = event.target.closest('.miniTarjeta-check');
  if (!btn) return;
  const id = btn.dataset.id;
  try {
    await fetch(`/api/expressions/${id}`, { method: 'DELETE' });
    await loadExpressions(); // recarga el panel sin la frase eliminada
  } catch (error) {
    console.error('Error deleting expression:', error);
  }
});
```

**Importante:** los datos ya incluyen `id` (la API `GET /api/expressions` lo devuelve, ver `src/lib/database.ts:90-100`), así que no hay que modificar el modelo de datos.

### 3. CSS

Ajustar `.miniTarjeta` (`src/pages/index.astro:710-721`) a un layout horizontal con el texto flexible y el check a la derecha:

```css
.miniTarjeta {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.miniTarjeta-text { flex: 1; }
.miniTarjeta-check {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border: 1px solid rgba(74, 222, 128, 0.5);
  border-radius: 50%;
  background: transparent;
  color: #4ade80;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.15s;
}
.miniTarjeta-check:hover {
  background: rgba(74, 222, 128, 0.15);
  transform: scale(1.1);
}
```

## Criterios de aceptación

1. Cada expresión guardada muestra un check circular a la derecha.
2. Al hacer clic en el check, la frase desaparece del panel sin recargar la página.
3. La frase eliminada se borra de la BD (`new_expressions`) y ya no aparece al recargar.
4. El mensaje "Aún no hay expresiones guardadas" aparece cuando se elimina la última frase.
5. Los errores (id inválido, fallo de BD) devuelven JSON con `error` y no rompen el resto del panel.

## Notas

- No hay prueba unitaria existente; se puede verificar manualmente con `astro dev --background` y el flujo: clic derecho en chat → Guardar → click en el check.
- La función `deleteExpression` ya existe, por lo que el cambio es de bajo riesgo.
