# Herbalorium · notas para trabajar en el repo

- App en vanilla JS (`app.js`, `style.css`, `index.html`). Cada cambio sube el `?v=` de CSS y JS en `index.html`.
- Textos para la gente: castellano rioplatense, simple y sin palabras técnicas.
- **Novedades** (`NEWS` en `app.js`): se agregan **solo cuando Nico lo pide**, nunca por iniciativa propia, y **antes de publicarlas siempre se le muestra el texto para que lo apruebe**. Cada entrada nueva va primero y sube `v`. Cada persona la ve una sola vez (queda guardado en el celular y en su cuenta). Al lanzarlas, subir también `<meta name="news">` en `index.html` al mismo número: eso hace que las apps abiertas se recarguen solas al volver. Los cambios chicos no lo tocan.
- Cambios en la base: se agregan al final de `supabase/schema.sql` como una nueva versión (`-- vN`).
- **Funciones nuevas grandes:** salen en la web real pero ocultas detrás de un interruptor (`FEATURES` en `app.js`): `"prueba"` = solo las ve el dueño del herbario (Nico); `"todos"` = las ve todo el mundo. Se pasan a `"todos"` **solo cuando Nico lo dice**. No se arma otra web ni otra rama para probar. Los retoques chicos van directo.
