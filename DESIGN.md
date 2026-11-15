# Herbalorium · sistema de diseño y tono

Guía para que todo lo que se agregue a la app se vea, se lea y funcione igual que lo que ya existe.
Se consulta **antes** de escribir un texto, sumar una pantalla o tocar estilos. Si algo nuevo no encaja en estas reglas, se discute con Nico y se actualiza este archivo, no se improvisa.

---

## 1. Qué es Herbalorium

Un herbario compartido entre amigos con estética de **florilegio antiguo**: láminas de papel, tinta verde bosque, filetes dorados, sellos de lacre y grabados. La app invita a salir a mirar plantas, registrarlas y charlar sobre ellas. Nada compite ni apura: el ritmo es el de un cuaderno de campo.

Tres ideas guían cada decisión:

1. **Objeto antes que pantalla.** Todo parece papel, tinta o lacre. Nada de sombras flotantes modernas, gradientes llamativos ni emojis en la interfaz (solo en los textos que se comparten fuera de la app).
2. **Claro antes que bonito.** La estética nunca tapa lo que hay que hacer: cada pantalla tiene una acción principal evidente y textos que se entienden a la primera.
3. **Entre todos.** El herbario es de un grupo. Se celebra lo que suman los demás y nunca se arma una competencia.

---

## 2. Tono y palabras

### Voz

- **Español neutro, con tuteo** («toca», «elige», «puedes»). Tiene que sonar natural en España y en Latinoamérica. Nada de voseo ni de modismos de un solo país.
- **Cercano y cuidado**: como alguien que sabe de plantas y te lo cuenta con ganas, sin solemnidad ni chistes forzados.
- **Frases completas y bien unidas.** Sin muletillas de chat («dale», «listo:», «ojo:», «genial»), sin jerga técnica (si hace falta un término, se explica en tres palabras).
- **La app no habla en primera persona.** No dice «no encontré», «te propongo» ni «te aviso yo»: dice «no se encontró», «el herbario te propone», «te llega un aviso». Cuando el grupo hace algo juntos se usa la primera del plural («llegamos juntos a la meta»).
- **Positivo y concreto.** Los errores dicen qué pasó y qué hacer («No se pudo guardar. Revisa tu conexión y vuelve a intentarlo»). Nunca se muestra un mensaje técnico en inglés (`Failed to fetch`, códigos, nombres de tablas) a quien no es el dueño.

### Formas fijas

| Tipo de texto | Forma | Ejemplo |
|---|---|---|
| Botón | Infinitivo, 1 a 3 palabras | «Compartir invitación», «Copiar código», «Reintentar» |
| Instrucción | Imperativo con tú | «Toca la pluma para abrir la tertulia» |
| Título de pantalla | Sustantivo, igual al del menú | Herbario, Calendario, Progreso, Ajustes |
| Título de sección | Sustantivo en castellano | «Historia y origen», «Usos medicinales» |
| Aviso breve (toast) | Una frase, hasta unos 80 caracteres, con punto final si es oración | «La lámina se guardó en el herbario.» |
| Pregunta de confirmación | Título como pregunta o acción, texto que explica la consecuencia, botones con el verbo | «¿Eliminar la lámina?» · «Eliminar» / «Cancelar» |
| Lista vacía | Qué pasa + qué hacer | «Las páginas están en blanco. Sal a pasear y toca el sello verde para asentar tu primera lámina.» |

Largo máximo orientativo: botón 22 caracteres; título 30; ayuda debajo de un campo, una línea; párrafo de presentación, tres líneas en el teléfono.

### Glosario: un solo nombre para cada cosa

| Se dice | No se dice | Qué es |
|---|---|---|
| **lámina** | ficha, tarjeta, registro | La página de una planta en el herbario |
| **asentar** (una lámina) | cargar, subir, crear | Agregar una planta nueva al herbario |
| **hallazgo** | avistamiento, registro | Cada vez que alguien encontró una planta |
| **hallada / cultivada** | silvestre / de casa | Si se encontró al aire libre o vive en una casa |
| **tertulia** | comentarios, chat, notas | La charla de cada lámina |
| **medallón** | avatar, foto de perfil | El círculo con la inicial de cada persona |
| **sello Nova** | nuevo, badge | La marca dorada de las láminas que todavía no abriste |
| **misión** | reto, desafío | La planta que te propone el herbario para salir a buscar |
| **expedición** | evento, desafío grupal | La meta en común de todo el herbario |
| **insignia / logro** | trofeo, premio | Lo que se desbloquea en Progreso |
| **herbario** | colección, cuenta | El libro compartido (y la app en general) |
| **dueño del herbario** | administrador, admin | Quien creó el herbario |
| **teléfono** | móvil, celular | El dispositivo |
| **correo** | mail, email | El correo electrónico (en el campo para entrar se acepta «correo electrónico») |
| **aviso** | notificación, push | Lo que llega al teléfono o por correo |
| **enlace** | link, URL | La dirección que se comparte |
| **subir** (una foto) | cargar | Agregar una imagen |
| **eliminar** | borrar, arrancar | Quitar algo para siempre (para fotos y mensajes, «borrar» está bien) |
| **al aire libre** | afuera | Donde se encontró una planta hallada |
| **aquí / allí** | acá / allá | — |
| **ahora** | recién | Para lo que acaba de pasar |

Palabras en otro idioma: se usan solo las que la gente ya conoce (app, IA, prompt). El latín queda para la marca («Herbarium vivum») y para frases sueltas con su traducción al lado («Herbarium numquam finitur. El herbario nunca se termina»). Los títulos y secciones van siempre en castellano.

### Nada de lo que no está lanzado se nombra

Ningún texto visible para todos (novedades y sus recorridos, tutorial, avisos, correos, ayudas, insignias, Ajustes) menciona una función que todavía está en `"no"` o `"prueba"`. Antes de publicar un texto se buscan esos nombres en `app.js`, `supabase/functions/notify/index.ts` y lo programado en la base.

---

## 3. Lenguaje visual

### Color

Siempre a través de las variables de `:root` en `style.css` (modo claro) y `:root[data-theme="dark"]` (modo oscuro). **No se agregan colores sueltos en hexadecimal**: si hace falta uno nuevo, se crea una variable con nombre y su par oscuro.

| Variable | Uso |
|---|---|
| `--parchment`, `--parchment-2`, `--parchment-3` | Fondos de papel: página, cajas, cajas hundidas |
| `--ink`, `--ink-soft`, `--ink-faint` | Texto principal, secundario y desactivado |
| `--leaf`, `--seal`, `--deep-leaf` | Verde de acción: botón principal, sellos, interruptores |
| `--gold`, `--gold-soft`, `--gold-wash` | Filetes, números destacados, sello Nova, etiquetas |
| `--wash`, `--hl` | Aguada verde para notas y resaltados |
| `--line` | Filetes y bordes (con transparencia: `rgb(var(--line) / .2)`) |
| `--danger` | Acciones que eliminan |
| `--u-comer`, `--u-medicina`, `--u-toxica`, `--u-otro` | Usos de la planta (no se reutilizan para otra cosa) |

Colores con significado fijo: **terracota `#b4532e`** = hallada (brújula); **azul tinta `#2f5276`** = cultivada (maceta); **dorado** = nuevo o destacado. Los colores de los medallones (`AV_COLORS`) son diez tonos apagados distintos de esos, y no se usan para nada más.

### Tipografía

- **Cinzel** (mayúsculas grabadas): títulos de pantalla, títulos de sección, etiquetas, botones y el menú. Siempre en mayúsculas con espaciado.
- **EB Garamond**: todo el texto para leer. Cursiva para nombres científicos, ayudas, fechas y citas.
- **Cinzel Decorative**: solo la inicial de los medallones y la capitular de la lámina.

Escala (variables en `tools/diseno.css`, se pasan a `style.css` al lanzar):

| Variable | Tamaño | Uso |
|---|---|---|
| `--fs-xl` | 30 px | Título de pantalla |
| `--fs-l` | 19 px | Entrada de una sección, texto de la lámina |
| `--fs-m` | 17 px | Texto corrido |
| `--fs-s` | 15,5 px | Texto secundario, tablas |
| `--fs-xs` | 14 px | Notas al pie, fechas, ayudas |
| `--caps-l` | 13 px | Botones |
| `--caps-m` | 12 px | Títulos de sección |
| `--caps-s` | 10,5 px | Etiquetas en mayúsculas: **nada en Cinzel por debajo de este tamaño**, salvo el texto dentro de un sello |

### Espacio

Múltiplos de 4: `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 24 · `--sp-6` 32 · `--sp-7` 40.
Márgenes laterales de la página: 24 px. Entre secciones de una pantalla: 40 px (lo da el `h3` ornamentado). Dentro de una caja: 16 a 20 px.

### Formas

- **Botones y cajas: rectos**, con doble filete (borde + línea interior), como un marco de grabado.
- **Píldoras** (`border-radius: 99px`): chips de filtro, etiquetas, el selector Láminas/Índice.
- **Círculos**: sellos, medallones, íconos de uso.
- **Arco**: la foto de cada lámina, como una ventana de iglesia.
- Nada de esquinas medio redondeadas (6–10 px) en elementos nuevos.

### Botones

| Clase | Cuándo |
|---|---|
| `.btn.primary` | La acción principal de la pantalla. **Una por pantalla.** |
| `.btn` | Acción secundaria con la misma importancia visual que la principal |
| `.btn.ghost` | Acción alternativa o de salida («Ahora no», «Cancelar») |
| `.btn.ghost.danger` | Eliminar algo |
| `.linkish` | Acción menor dentro de un texto («Ver todas las categorías») |

Alto mínimo 48 px, texto en una sola línea. Todo lo que se toca mide al menos 40 × 40 px.

### Emblema

Medallón de doble anillo con una planta grabada: tallo que se afina, seis hojas alternas con nervadura clara, un pimpollo dorado arriba y dos ramas de laurel que abrazan la base, unidas por un lazo dorado. Se dibuja con `currentColor` (verde en claro, dorado en oscuro) y la nervadura toma el color del fondo (`--emb-vein`). Fuente: `tools/emblema.py` → `tools/emblema.svg`. Íconos de la app (pantalla de inicio): `tools/iconos/`.

### Íconos y sellos

Íconos de línea con aire de grabado (sprite de `index.html`, `#f-*` e `#i-*`). Se agregan al sprite con el mismo trazo; no se mezclan íconos de otras familias.
Sellos en las esquinas de la foto: arriba a la izquierda, quién la asentó (medallón con inicial); arriba a la derecha, hallada o cultivada; abajo a la derecha, Nova. Los sellos chicos se tocan y explican qué son.

### Movimiento

Solo cuando pasa algo (asentar, cumplir, abrir una carta). Corto (menos de 0,4 s en lo cotidiano), suave y siempre respetando «reducir movimiento». Las pantallas entran con un fundido, sin desplazarse.

### Modo oscuro

Cada color nuevo se define también para el modo oscuro. Lo que imita papel impreso (la carta de presentación, el mail) se ve siempre en claro.

---

## 4. Estructura

- **Menú de abajo**: Herbario · Calendario · (sello verde para asentar) · Progreso · Ajustes. No se agregan más pestañas.
- **Ventanas que suben desde abajo** (`.modal`): para todo lo que se abre encima de una pantalla. Siempre con ✕ arriba a la derecha y el botón «atrás» del teléfono las cierra.
- **Lo que solo ve el dueño** va en Ajustes, en las secciones «Administración» y «Pruebas · solo la ves tú», siempre protegido por `amOwner` (y `isDevBase()` para Pruebas).

---

## 5. Cómo se trabaja

1. Lo nuevo sale primero en «prueba» (solo Nico) detrás de `FEATURES`. Las correcciones van directo para todos.
2. **Variante en revisión** (`diseno: "prueba"`): mientras Nico revisa este sistema, su teléfono carga `app-ds.js` y `style-ds.css`, que se generan con `python3 tools/variante.py` a partir de `app.js` y `style.css`:
   - `tools/neutro.py`: textos en español neutro (frases con contexto y palabras sueltas).
   - `tools/diseno.py` y `tools/diseno.css`: cambios de marcado y estilos.
   - **Después de cada cambio en `app.js` o `style.css` hay que volver a correr el script**, y avisar si dice que alguna frase ya no aplica.
3. Al lanzar la variante para todos: `python3 tools/variante.py --lanzar`, cambiar `diseno` a `"todos"` y después borrar la lógica de la variante (`IS_VARIANT`, el cargador de `index.html` y `herb.ds`). Pasos que no se hacen solos:
   - Desplegar `notify` con los textos en neutro (avisos y correos).
   - Pasar a neutro las pistas de las plantillas de expediciones en `supabase/schema.sql` (por ejemplo, «vereda», «baldíos») con una versión nueva de la base.
   - Emblema e íconos: pegar `tools/emblema.svg` en el sprite de `index.html` (reemplaza `#i-emblem`), copiar `tools/iconos/*.png` a `icons/` y `tools/iconos/icon.svg` a la raíz, y subir el `?v=` del manifiesto para que los teléfonos tomen el ícono nuevo.
   - Actualizar la guía para armar un herbario propio.
4. Antes de publicar cualquier texto: revisar el glosario, el tuteo y que no nombre nada sin lanzar.
