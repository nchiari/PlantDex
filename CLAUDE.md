# Herbalorium · notas para trabajar en el repo

- App en vanilla JS (`app.js`, `style.css`, `index.html`). Cada cambio sube el `?v=` de CSS y JS en `index.html`.
- Textos para la gente: castellano rioplatense, simple y sin palabras técnicas.
- **Novedades** (`NEWS` en `app.js`): se agregan **solo cuando Nico lo pide**, nunca por iniciativa propia, y **antes de publicarlas siempre se le muestra el texto para que lo apruebe**. Cada entrada nueva va primero y sube `v`. Cada persona la ve una sola vez (queda guardado en el celular y en su cuenta). Al lanzarlas, subir también `<meta name="news">` en `index.html` al mismo número: eso hace que las apps abiertas se recarguen solas al volver. Los cambios chicos no lo tocan.
- Cambios en la base: se agregan al final de `supabase/schema.sql` como una nueva versión (`-- vN`).
- **Versiones:** `ccr-3d9e321a-w52wl9` es la app real (herbalorium.pages.dev). `dev` es la versión de prueba (dev.herbalorium.pages.dev), solo para Nico. Los **cambios grandes** van primero a `dev`; pasan a la real únicamente cuando Nico dice "publicá" (merge de `dev` en la rama real). Los retoques chicos pueden ir directo a la real. Las dos usan la misma base de datos: lo que se carga en prueba es real.
