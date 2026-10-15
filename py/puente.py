"""Puente entre la pantalla y el motor: recibe un texto JSON, devuelve un texto JSON."""
import json, datetime as dt
import engine, versiones


def correr(texto):
    d = json.loads(texto)
    f = dt.date.fromisoformat
    datos = {
        "partidos": [{"fecha": f(p["fecha"]), "cond": p["cond"], "rival": p["rival"], "km_iv": float(p["km_iv"])}
                     for p in d["partidos"]],
        "conductores": [{"id": c["id"], "asientos": int(c["asientos"]),
                         "no_disponible": {f(x) for x in c["no_disponible"]}} for c in d["conductores"]],
        "plantel": {"a_transportar": int(d["a_transportar"])},
    }
    falta = [pa["fecha"].isoformat() for pa, m in zip(datos["partidos"], engine.autos_por_fecha(datos, d.get("reglas"))) if m is None]
    if falta:
        return json.dumps({"error": "sin_capacidad", "fechas": falta})
    res = engine.optimizar(datos, d.get("reglas"), d.get("params"))
    if res is None:
        return json.dumps({"error": "sin_solucion"})
    res["resumen"] = versiones.bullets(res, d.get("base_id"))
    return json.dumps(res)


def leer_fixture(texto):
    """Recibe {"archivo":..., "paginas":[texto de cada página]} y devuelve los datos del fixture."""
    import fixture_datos
    d = json.loads(texto)
    return json.dumps(fixture_datos.desde_paginas(d["paginas"], d["archivo"]), ensure_ascii=False)
