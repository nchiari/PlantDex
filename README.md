# 🌿 PlantDex

Una Pokédex de plantas sin límite. Sacás una foto, la IA te dice qué es, si se come, si es peligrosa para Rufi, sus usos y su historia, y queda guardada en tu catálogo en la nube.

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

### 3. Sacar la API key de Gemini (gratis)
1. Entrá a <https://aistudio.google.com/apikey> con tu cuenta de Google.
2. **Create API key** y copiala. No pide tarjeta.

### 4. Configurar la app
1. Abrí la web en el celular, tocá ⚙ y pegá las tres cosas.
2. Poné tu email, abrí el link mágico que te llega, y listo.
3. Desde el menú del navegador, **Agregar a pantalla de inicio** para usarla como si fuera una app.

---

## Cómo se usa
- **＋ (la Pokébola)**: sacás 1 a 4 fotos (planta entera, hoja, flor o fruto) → *Identificar con IA* → revisás la ficha → *Registrar*.
- Cada planta recibe su número (#001, #002…), tipos estilo Pokémon, rareza ★ y un semáforo para vos y para Rufi.
- **Progreso**: estadísticas y medallas.
- En ⚙ podés exportar un backup en JSON.

## Privacidad
- Las fotos están en un bucket privado y la base tiene Row Level Security: solo tu usuario las ve.
- Las claves quedan guardadas en el navegador de cada dispositivo y no se suben al repo.

> ⚠ La identificación por foto puede fallar. Nunca comas una planta silvestre ni dejes que Rufi la coma sin confirmarlo con alguien que sepa.
