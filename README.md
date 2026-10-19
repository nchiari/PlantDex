# 🌿 PlantDex

Un herbario personal sin límite, con estética de florilegio antiguo. Sacás una foto, la IA te dice qué es, si se come o es tóxica, sus usos y su historia, y queda guardada en tu catálogo en la nube.

Todo funciona **gratis**: GitHub Pages (hosting), Supabase (base de datos y fotos, una por persona) y Google Gemini o tu chat de IA (identificación).

---

## Cómo empezar a usarla

Cada persona usa **su propia nube gratuita (Supabase)**: nadie comparte datos ni cupos.

1. Abrí `https://nchiari.github.io/PlantDex/` en el celular.
2. La primera vez aparece el asistente **Primeros pasos**, que guía todo:
   - crear un proyecto gratis en [supabase.com](https://supabase.com),
   - copiar y correr el código SQL (botón incluido),
   - autorizar la dirección de la web en *Authentication → URL Configuration*,
   - pegar la *Project URL* y la *publishable key*.
   La app prueba la conexión antes de seguir.
3. Entrá con tu email (te llega un link) y, ya adentro, desactivá en Supabase *Allow new users to sign up*.
4. Opcional: una clave gratis de [Gemini](https://aistudio.google.com/apikey) para la identificación automática. Sin ella, se identifica con ChatGPT o Claude copiando y pegando.
5. Desde el menú del navegador: **Agregar a pantalla de inicio**.

---

## Cómo se usa
- **✚ Nueva lámina**: sacás 1 a 4 fotos y elegís cómo identificarla:
  - **Automático**: Gemini completa la ficha (necesita la API key gratis).
  - **Con mi chat**: copiás un prompt, lo pegás en ChatGPT o Claude con las fotos, y pegás la respuesta. Usa tus suscripciones, sin API.
  - **A mano**.
- Cada planta es una lámina ordenada alfabéticamente, con tipos, estado de conservación (UICN) y si es comestible o tóxica.
- **Kalendarium**: qué florece y qué fruto se puede recolectar cada mes, empezando por el mes actual.
- **Progressus**: estadísticas, familias más vistas e insignias.
- En Ajustes podés activar o desactivar el filtro de grabado en las fotos.
- En ⚙ podés exportar un backup en JSON.

## Privacidad
- Las fotos están en un bucket privado y la base tiene Row Level Security: solo tu usuario las ve.
- Las claves quedan guardadas en el navegador de cada dispositivo y no se suben al repo.

> ⚠ La identificación por foto puede fallar. Nunca comas una planta silvestre sin confirmarlo con alguien que sepa.
