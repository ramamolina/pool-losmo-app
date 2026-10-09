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
    try:
        res = engine.optimizar(datos, d.get("reglas"), d.get("params"))
    except NotImplementedError:
        return json.dumps({"error": "varios_autos", "autos": engine.autos_necesarios(datos)})
    if res is None:
        return json.dumps({"error": "sin_solucion"})
    res["resumen"] = versiones.bullets(res, d.get("base_id"))
    return json.dumps(res)
