# 🌿 PlantDex

Un herbario personal sin límite, con estética de florilegio antiguo. Sacás una foto, la IA te dice qué es, si se come, si es peligrosa para Rufi, sus usos y su historia, y queda guardada en tu catálogo en la nube.

Todo funciona **gratis**: GitHub Pages (hosting), Supabase (base de datos y fotos) y Google Gemini (identificación).

---

## Puesta en marcha (unos 15 minutos, una sola vez)

### 1. Publicar la web (GitHub Pages)
1. En GitHub, en el repo `plantdex`: **Settings → Pages**.
2. En *Source* elegí **Deploy from a branch**, la rama `main` y la carpeta `/ (root)`. Guardá.
3. En un minuto queda en `https://nchiari.github.io/plantdex/`.

### 2. Crear tu nube (Supabase)
1. Entrá a <https://supabase.com>, creá una cuenta y un proyecto nuevo (plan Free, región Europa).
2. Andá a **SQL Editor → New query**, pegá todo el contenido de [`supabase/schema.sql`](supabase/schema.sql) y apretá **Run**.
3. Andá a **Authentication → URL Configuration** y en *Site URL* poné `https://nchiari.github.io/plantdex/` (sumala también en *Redirect URLs*).
4. Opcional, pero recomendado: en **Authentication → Sign In / Providers → Email**, después de registrarte, desactivá *Allow new users to sign up* para que nadie más pueda crearse una cuenta.
5. En **Project Settings → API** copiá la **Project URL** y la **anon / publishable key**.

### 3. Sacar la API key de Gemini (gratis, opcional)
1. Entrá a <https://aistudio.google.com/apikey> con tu cuenta de Google.
2. **Create API key** y copiala. No pide tarjeta.

### 4. Configurar la app
1. Abrí la web en el celular, tocá ⚙ y pegá las tres cosas.
2. Poné tu email, abrí el link mágico que te llega, y listo.
3. Desde el menú del navegador, **Agregar a pantalla de inicio** para usarla como si fuera una app.

---

## Cómo se usa
- **✚ Nueva lámina**: sacás 1 a 4 fotos y elegís cómo identificarla:
  - **Automático**: Gemini completa la ficha (necesita la API key gratis).
  - **Con mi chat**: copiás un prompt, lo pegás en ChatGPT o Claude con las fotos, y pegás la respuesta. Usa tus suscripciones, sin API.
  - **A mano**.
- Cada planta es una *Tabula* numerada en romano, con tipos, rareza ✦, y qué tan segura es para vos y para Rufi.
- **Kalendarium**: qué florece y qué fruto se puede recolectar cada mes, empezando por el mes actual.
- **Progressus**: estadísticas, familias más vistas e insignias.
- En Ajustes podés activar o desactivar el filtro de grabado en las fotos.
- En ⚙ podés exportar un backup en JSON.

## Privacidad
- Las fotos están en un bucket privado y la base tiene Row Level Security: solo tu usuario las ve.
- Las claves quedan guardadas en el navegador de cada dispositivo y no se suben al repo.

> ⚠ La identificación por foto puede fallar. Nunca comas una planta silvestre ni dejes que Rufi la coma sin confirmarlo con alguien que sepa.
