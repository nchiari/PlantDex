#!/usr/bin/env python3
"""Genera la variante en revisión de Herbalorium (app-ds.js y style-ds.css) a partir de app.js y style.css.

Mientras Nico la revisa, solo su teléfono carga la variante (interruptor «diseno» en FEATURES).
Después de tocar app.js o style.css, volver a correr:  python3 tools/variante.py
Al lanzarla para todos: correr con --lanzar (pisa app.js y style.css con la variante y borra los archivos -ds).
"""
import re, sys, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from neutro import WORDS, PHRASES  # textos en español neutro (tú)
from diseno import css_variant, APP_EDITS  # pulido visual

def neutral(src):
    missing = []
    for old, new in PHRASES:  # primero las frases exactas (contexto), después las palabras sueltas
        if old not in src: missing.append(old); continue
        src = src.replace(old, new)
    def rep(m):
        w = m.group(0); low = w[0].lower() + w[1:]
        if low not in WORDS: return w
        n = WORDS[low]
        return n[0].upper() + n[1:] if w[0].isupper() else n
    pat = re.compile(r"(?<![\w\-.#/$])(" + "|".join(sorted({re.escape(k) for k in WORDS} | {re.escape(k[0].upper() + k[1:]) for k in WORDS}, key=len, reverse=True)) + r")(?![\w\-/(])")
    src = pat.sub(rep, src)
    return src, missing

def main():
    app = open(os.path.join(ROOT, "app.js"), encoding="utf-8").read()
    css = open(os.path.join(ROOT, "style.css"), encoding="utf-8").read()
    for old, new in APP_EDITS:
        if old not in app: print("Cambio de diseño que ya no aplica:", old); continue
        app = app.replace(old, new)
    out, missing = neutral(app)
    out = out.replace("const IS_VARIANT = false;", "const IS_VARIANT = true;", 1)
    open(os.path.join(ROOT, "app-ds.js"), "w", encoding="utf-8").write(out)
    open(os.path.join(ROOT, "style-ds.css"), "w", encoding="utf-8").write(css_variant(css))
    if missing: print("Frases que ya no están en app.js (revisar neutro.py):", *missing, sep="\n  - ")
    print("Listo: app-ds.js y style-ds.css")
    if "--lanzar" in sys.argv:
        os.replace(os.path.join(ROOT, "app-ds.js"), os.path.join(ROOT, "app.js"))
        os.replace(os.path.join(ROOT, "style-ds.css"), os.path.join(ROOT, "style.css"))
        print("Variante lanzada: app.js y style.css reemplazados.")

if __name__ == "__main__": main()
