# 🌿 Herbalorium

Un herbario personal sin límite, con estética de florilegio antiguo. Sacás una foto, la IA te dice qué es, si se come o es tóxica, sus usos y su historia, y queda guardada en tu catálogo en la nube.

Todo funciona **gratis**: Cloudflare Pages (hosting), Supabase (base de datos y fotos, una por persona) y tu chat de IA, ChatGPT o Claude (identificación).

---

## Cómo empezar a usarla

Cada persona usa **su propia nube gratuita (Supabase)**: nadie comparte datos ni cupos.

1. Abrí `https://herbalorium.pages.dev/` en el celular.
2. La primera vez aparece el asistente **Primeros pasos**, que guía todo:
   - crear un proyecto gratis en [supabase.com](https://supabase.com),
   - copiar y correr el código SQL (botón incluido),
   - autorizar la dirección de la web en *Authentication → URL Configuration*,
   - pegar la *Project URL* y la *publishable key*.
   La app prueba la conexión antes de seguir.
3. Entrá con tu email (te llega un link) y, ya adentro, desactivá en Supabase *Allow new users to sign up*.
4. Desde el menú del navegador: **Agregar a pantalla de inicio**.

---

## Cómo se usa
- **✚ Nueva lámina**: sacás 1 a 4 fotos y elegís cómo identificarla:
  - **Con mi chat**: copiás un prompt, lo pegás en ChatGPT o Claude con las fotos, y pegás la respuesta. Usa tus suscripciones, sin API.
  - **A mano**.
- Cada planta es una lámina ordenada alfabéticamente, con tipos, estado de conservación (UICN) y si es comestible o tóxica.
- **Kalendarium**: qué florece y qué fruto se puede recolectar cada mes, empezando por el mes actual.
- **Progressus**: estadísticas y **63 logros** en 14 categorías, con aviso al desbloquear cada uno.
- En Ajustes: tema **claro, oscuro o automático**, filtro de grabado en las fotos y láminas antiguas.
- **Enlace de configuración** (Ajustes): abrilo en otro celular o navegador y la app queda conectada a tu herbario; solo pide el email.
- En ⚙ podés exportar un backup en JSON.

## Privacidad
- Las fotos están en un bucket privado y la base tiene Row Level Security: solo entran los usuarios que des de alta en tu Supabase. Todos ven el herbario completo, pero cada uno edita y borra solo lo suyo.
- Los datos de conexión con la base solo se muestran en Ajustes al dueño del herbario (el primer usuario). La seguridad real la da RLS, no ocultar la clave.
- Las claves quedan guardadas en el navegador de cada dispositivo y no se suben al repo.

> ⚠ La identificación por foto puede fallar. Nunca comas una planta silvestre sin confirmarlo con alguien que sepa.
