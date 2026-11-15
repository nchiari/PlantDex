"""Pulido visual de Herbalorium (variante en revisión). Ver DESIGN.md."""
import os
HERE = os.path.dirname(os.path.abspath(__file__))

# Cambios de marcado en app.js (además de los textos de neutro.py).
APP_EDITS = [
  # Títulos de pantalla en castellano, iguales al menú de abajo.
  ('<div class="entry-head"><h2>Herbarium</h2>', '<div class="entry-head"><h2>Herbario</h2>'),
  ('<h2>Kalendarium</h2>', '<h2>Calendario</h2>'),
  ('<h2>Progressus</h2>', '<h2>Progreso</h2>'),
  ("<button class=\"back\" onclick=\"location.hash='list'\">← Herbarium</button>", "<button class=\"back\" onclick=\"location.hash='list'\">← Herbario</button>"),
  # Secciones de la lámina: un solo nombre, en castellano.
  ('fold("Historia · origen"', 'fold("Historia y origen"'),
  ('fold("Kalendarium"', 'fold("Calendario"'),
  ('fold("Esculenta · comestibilidad"', 'fold("Comestibilidad"'),
  ('fold("Medicina · usos medicinales"', 'fold("Usos medicinales"'),
  ('fold("Usus · otros usos"', 'fold("Otros usos"'),
  ('fold("Curiosa"', 'fold("Curiosidad"'),
  ('fold("Notae · mis notas"', 'fold("Mis notas"'),
]

def css_variant(css):
    extra = open(os.path.join(HERE, "diseno.css"), encoding="utf-8").read()
    return css + "\n\n/* ===== Sistema de diseño (variante en revisión) ===== */\n" + extra
