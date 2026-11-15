"""Textos de Herbalorium en español neutro (tuteo), para que se lean bien en España y en Latinoamérica.
PHRASES: reemplazos exactos con contexto (van primero). WORDS: palabras sueltas del voseo y regionalismos.
Ver DESIGN.md («Tono y palabras») antes de sumar entradas."""

WORDS = {
  # pronombres y ser
  "vos": "tú", "sos": "eres",
  # imperativos
  "tocá": "toca", "copiá": "copia", "pegá": "pega", "elegí": "elige", "abrí": "abre", "probá": "prueba", "ingresá": "escribe",
  "corré": "ejecuta", "marcá": "marca", "revisá": "revisa", "compartí": "comparte", "armá": "arma", "creá": "crea", "dejá": "deja",
  "llamá": "llama", "escribí": "escribe", "activá": "activa", "borrá": "borra", "contá": "cuenta", "seguí": "sigue", "instalá": "instala",
  "identificá": "identifica", "hablá": "habla", "poné": "pon", "aclará": "aclara", "incluí": "incluye", "empezá": "empieza", "terminá": "termina",
  "usá": "usa", "fotografiá": "fotografía", "descubrí": "descubre", "cargá": "sube", "entrá": "entra", "prepará": "prepara", "andá": "ve",
  "autorizá": "autoriza", "conectá": "conecta", "respondé": "responde", "mirá": "mira", "alterná": "alterna", "buscá": "busca", "sacá": "saca",
  "volvé": "vuelve", "recargá": "recarga", "aceptá": "acepta", "agregá": "agrega", "salí": "sal", "enviá": "envía", "adjuntá": "adjunta",
  "mantené": "mantén", "sumá": "agrega", "asentá": "asienta", "pedí": "pide", "arrancá": "empieza", "confirmá": "confirma", "bajá": "baja",
  "esperá": "espera", "guardá": "guarda", "cerrá": "cierra", "cambiá": "cambia", "completá": "completa", "subí": "sube", "decí": "di",
  "hacé": "haz", "tené": "ten", "fijate": "fíjate", "acordate": "acuérdate", "sumate": "súmate", "animate": "anímate", "mostrá": "muestra",
  "elegilo": "elígelo", "elegila": "elígela", "intentá": "intenta", "reintentá": "reintenta", "volvé": "vuelve", "tomá": "toma", "anotá": "anota",
  "suscribite": "suscríbete", "registrate": "regístrate", "iniciá": "inicia", "pasá": "pasa", "esperalo": "espéralo", "seleccioná": "selecciona",
  "habilitá": "habilita", "desactivá": "desactiva", "permití": "permite", "presioná": "presiona", "deslizá": "desliza", "ubicá": "ubica",
  # con pronombre pegado
  "pegalo": "pégalo", "pegala": "pégala", "tocalo": "tócalo", "tocala": "tócala", "tocalos": "tócalos", "copialo": "cópialo", "sumale": "agrégale",
  "dejalo": "déjalo", "cambialas": "cámbialas", "pedile": "pídele", "sacale": "sácale", "pasale": "pásale", "instalala": "instálala",
  "hacelo": "hazlo", "hablalo": "háblalo", "explicalo": "explícalo", "escribilo": "escríbelo", "decime": "dime", "decilo": "dilo",
  "confirmalo": "confírmalo", "borrala": "bórrala", "asentala": "asiéntala", "activalas": "actívalas", "abrilo": "ábrelo", "abrila": "ábrela",
  "respondele": "respóndele", "mostrame": "muéstrame", "mirala": "mírala", "mandale": "mándale", "contestame": "contéstame", "usalo": "úsalo",
  "probalo": "pruébalo", "guardalo": "guárdalo", "elegí": "elige",
  # presente (vos → tú)
  "podés": "puedes", "tenés": "tienes", "querés": "quieres", "elegís": "eliges", "cambiás": "cambias", "cargás": "subes", "aceptás": "aceptas",
  "sabés": "sabes", "escribís": "escribes", "volvés": "vuelves", "asentás": "asientas", "abrís": "abres", "acabás": "acabas", "salís": "sales",
  "usás": "usas", "hacés": "haces", "preferís": "prefieres", "entrás": "entras", "necesitás": "necesitas", "encontrás": "encuentras",
  "subís": "subes", "pegás": "pegas", "creés": "crees", "borrás": "borras", "vivís": "vives", "tocás": "tocas", "pasás": "pasas",
  "completás": "completas", "marcás": "marcas", "ves": "ves", "llegás": "llegas", "seguís": "sigues", "decís": "dices", "pedís": "pides",
  "buscás": "buscas", "sumás": "agregas", "arrancás": "empiezas", "mirás": "miras", "elegiste": "elegiste", "invitás": "invitas",
  "compartís": "compartes", "recibís": "recibes", "activás": "activas", "querrás": "querrás", "dejás": "dejas", "guardás": "guardas",
  "venís": "vienes", "estés": "estés", "tomás": "tomas", "sacás": "sacas", "agregás": "agregas", "copiás": "copias", "conocés": "conoces",
  "registrás": "registras", "esperás": "esperas", "olvidás": "olvidas", "llevás": "llevas", "ponés": "pones", "respondés": "respondes",
  "dudás": "dudas", "confiá": "confía", "preguntá": "pregunta", "llamás": "llamas", "empezás": "empiezas", "explorás": "exploras",
  "quedás": "quedas", "destildá": "desmarca", "recorrés": "recorres", "cumplí": "cumple",
  # regionalismos
  "acá": "aquí", "allá": "allí", "móvil": "teléfono", "móviles": "teléfonos", "recién": "hace un momento", "afuera": "al aire libre", "adentro": "dentro",
}

PHRASES = [
  # contexto que una palabra sola no resuelve
  ("solo para vos", "solo para ti"),
  ("<h3>Vos</h3>", "<h3>Tu perfil</h3>"),
  ('return m < 1 ? "recién"', 'return m < 1 ? "ahora"'),
  ("como si recién entraras", "como si entraras por primera vez"),
  ("aparece recién desde ese momento", "aparece solo desde ese momento"),
  ("Arrancar la lámina", "Eliminar la lámina"),
  ("Arrancala y después", "Ponla en marcha y después"),
  ("Mantené apretado", "Mantén pulsado"),
  ("este link", "este enlace"), ("el link", "el enlace"), ('"Link copiado"', '"Enlace copiado"'),
  # botones: un solo nombre por acción
  ("Desactivar en este móvil", "Desactivar avisos"), ("Activar en este móvil", "Activar avisos"),
  (">Volver a intentar<", ">Reintentar<"), (">Exportar backup<", ">Descargar una copia<"),
  # cargar → asentar (láminas) o subir (fotos); y otras formas regionales
  ('toast("Ya estás cargando una planta.")', 'toast("Ya estás asentando una planta.")'),
  ("en las láminas que cargues", "en las láminas que asientes"), ("en las láminas que cargás", "en las láminas que asientas"),
  ("quien la cargó", "quien la asentó"), ("Cada uno edita solo lo que cargó", "Cada persona edita solo lo que asentó"),
  ("todavía no cargó ninguna lámina", "todavía no asentó ninguna lámina"),
  ("Si volvés a cargar una planta", "Si vuelves a asentar una planta"), ("cuando volvés a cargar una planta", "cuando vuelves a asentar una planta"),
  ("se descarta lo que estabas cargando", "se descarta lo que estabas asentando"),
  ("Las láminas cargadas a mano", "Las láminas asentadas a mano"), ("Todavía no hay meses cargados.", "Todavía no hay meses registrados."),
  ("Una planta cerca tuyo", "Una planta cerca de ti"), ("una planta que alguien vio cerca tuyo", "una planta que alguien vio cerca de ti"),
  ("Ojo: en el plan gratis", "En el plan gratis"),
  ("La conexión anda, pero", "La conexión funciona, pero"), ("algunas partes pueden no andar", "algunas partes pueden no funcionar"),
  ("Claude o Gemini alcanzan. Lo único:", "Claude o Gemini bastan. Eso sí:"), ("Alcanza con la versión gratis", "Basta con la versión gratis"),
  ("si la encontraron afuera (campo, calle, parque)", "si la encontraron al aire libre (campo, calle, parque)"),
  ("si la planta se encontró afuera o vive", "si la planta se encontró al aire libre o vive"),
  ("Se encontró afuera, en el campo", "Se encontró al aire libre, en el campo"),
  ("si la encontraron afuera o vive", "si la encontraron al aire libre o vive"),
  ("y ya estás adentro:", "y ya participas:"),
  ("te las muestra de una", "te las muestra todas juntas"),
  ("a la vuelta de casa", "cerca de casa"),
  ("Herbario configurado. Ingresá con tu email.", "Herbario configurado. Entra con tu correo."),
  # la app no habla en primera persona
  ("No encontré la ficha en la respuesta", "La respuesta no trae la ficha"),
  ("pero no encontré plantas registradas cerca", "pero no hay plantas registradas cerca"),
  ("No pude buscar lugares.", "No se pudieron buscar lugares."), ("No encontré ese lugar.", "No se encontró ese lugar."),
  ("No encontré una descripción.", "No hay una descripción disponible."), ("No pude traer la descripción ahora.", "No se pudo traer la descripción ahora."),
  ("Marcá tu zona y te propongo plantas que se vieron cerca para salir a buscar.", "Marca tu zona para recibir plantas que se vieron cerca y salir a buscarlas."),
  ("marcá Mail", "marca Correo"),
  ("mantené apretado el cuadro de mensaje", "mantén pulsado el cuadro de mensaje"),
  ("o por mail", "o por correo"), ("Por mail llega", "Por correo llega"), (">Mail<", ">Correo<"), (" y por mail", " y por correo"), ('" por mail"', '" por correo"'),
]
