"""Convierte las divisiones leídas de un PDF de fixture en los datos que usa la pantalla."""
import re, json
import fixture_pdf as F


def limpiar_division(t):
    t = t.replace("(", "").replace(")", "").replace(" - ", " · ").replace('"', "")
    pal = []
    for w in t.split(" "):
        if w in ("·", "I", "II", "A", "B", "C") or re.fullmatch(r"\d+", w): pal.append(w)
        else: pal.append(w.capitalize())
    return " ".join(pal)


def armar_datos(divs, archivo):
    F.unificar_clubes(divs)
    salida = []
    for d in divs:
        cal = {}
        for _, nombre in d["clubes"]:
            if nombre.lower() == "bye": continue
            cal[nombre] = [[c["fecha_n"], c["fecha"].isoformat(), c["cond"], c["rival"] or "", "; ".join(c["notas"])]
                           for c in F.calendario(d, nombre)]
        salida.append({"cat": d["categoria"], "div": limpiar_division(d["division"]), "b": d["equipo_b"],
                       "h": d["horario"], "pag": d["pagina"], "cal": cal,
                       "esp": [[e["nombre"].capitalize(), e["fecha"].isoformat()] for e in d["especiales"]],
                       "notas": d["notas"]})
    return {"archivo": archivo, "total": len(divs), "divs": salida}


def desde_paginas(paginas, archivo):
    divs = []
    for n, txt in enumerate(paginas, start=1):
        d = F._parse_pagina(txt, n)
        if d: divs.append(d)
    return armar_datos(divs, archivo)
