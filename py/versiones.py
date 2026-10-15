"""Versiones de una optimización: guardar, resumir en viñetas, comparar y costear interruptores."""
import json, os, datetime as dt
import engine

def _f(x):
    return f"{x:.1f}".replace(".", ",")

def bullets(res, base_id=None):
    r, p = res["reglas"], {**engine.PARAMS_BASE, **(res.get("params") or {})}
    if r is None:
        return ["Versión cargada a mano (no salió del motor)",
                f"Diferencia de carga entre el que más y el que menos: {_f(res['dif_km'])} km"]
    b = []
    if r["disponibilidad"]: b.append("Respeta las fechas no disponibles de cada conductor")
    if r["sin_fines_consecutivos"]: b.append("Nadie maneja dos fines de semana calendario seguidos")
    if r["viajes_parejos"]: b.append(f"Viajes parejos (diferencia máxima {r['max_dif_viajes']})")
    if r["compensar_viaje_extra"]: b.append("Quien hace un viaje extra tiene mayoría de local")
    if r.get("autos_extra"):
        b.append(f"El motor puede sumar hasta {r['autos_extra']} auto(s) sobre el mínimo en cada fecha (costo {_f(r.get('costo_auto_extra_km') or 0)} km por auto extra)")
    if r["viaje_extra_a"]: b.append(f"Viaje extra fijado a {r['viaje_extra_a']}")
    if p["estacionamiento_en_km"]:
        b.append(f"Estacionamiento convertido a {_f(engine.km_estacionamiento(p))} km por partido de visitante")
    else:
        b.append("Estacionamiento repartido entre los choferes (no cuenta como km)")
    if p["dia_pool_km"]: b.append(f"Cada día de pool vale {_f(p['dia_pool_km'])} km")
    if p["extra_visitante_km"]: b.append(f"Peso extra de visitante: {_f(p['extra_visitante_km'])} km")
    if r.get("minimizar_cambios_vs"):
        b.append(f"Cambia lo mínimo respecto de {base_id or 'la versión anterior'} (tolerancia {_f(r.get('tolerancia_km') or 0)} km)")
    b.append(f"Diferencia de carga entre el que más y el que menos: {_f(res['dif_km'])} km")
    return b

def cargar_historial(path):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return {"versiones": []}

def guardar(path, res, nota="", base_id=None, nombre=None):
    h = cargar_historial(path)
    vid = nombre or f"V{len(h['versiones']) + 1}"
    if any(v["id"] == vid for v in h["versiones"]):
        raise ValueError(f"Ya existe la versión {vid}")
    h["versiones"].append({
        "id": vid, "creada": dt.datetime.now().isoformat(timespec="seconds"), "nota": nota,
        "base": base_id, "resumen": bullets(res, base_id),
        "asignacion": dict(res["asignacion"]), "por_conductor": res["por_conductor"],
        "dif_km": res["dif_km"], "reglas": res["reglas"], "params": res["params"],
        "liquidacion_estacionamiento": res.get("liquidacion_estacionamiento"),
    })
    with open(path, "w", encoding="utf-8") as f:
        json.dump(h, f, ensure_ascii=False, indent=1)
    return vid

def obtener(h, vid):
    return next(v for v in h["versiones"] if v["id"] == vid)

def comparar(h, a, b, datos=None):
    va, vb = obtener(h, a), obtener(h, b)
    rivales = {}
    if datos:
        for p in datos["partidos"]:
            rivales[p["fecha"].isoformat()] = p["rival"]
    cambios = [{"fecha": f, "rival": rivales.get(f, ""), a: va["asignacion"][f], b: vb["asignacion"][f]}
               for f in va["asignacion"] if va["asignacion"][f] != vb["asignacion"][f]]
    deltas = {c: {"viajes": vb["por_conductor"][c]["viajes"] - va["por_conductor"][c]["viajes"],
                  "km": round(vb["por_conductor"][c]["km"] - va["por_conductor"][c]["km"], 1),
                  "carga_km": round(vb["por_conductor"][c]["carga_km"] - va["por_conductor"][c]["carga_km"], 1)}
              for c in va["por_conductor"]}
    return {"cambios": cambios, "n_cambios": len(cambios),
            "dif_km": {a: va["dif_km"], b: vb["dif_km"]}, "por_conductor": deltas}

INTERRUPTORES = {
    "sin_fines_consecutivos": "Sin fines de semana consecutivos",
    "viajes_parejos": "Viajes parejos",
    "compensar_viaje_extra": "Compensar al del viaje extra (mayoría de local)",
    "viaje_extra_a": "Viaje extra fijado a un conductor",
}

def costos_interruptores(datos, reglas=None, params=None):
    """Cuánto cuesta cada interruptor activado: cuánto empeora la diferencia de carga (en km)
    respecto de correr sin él. Positivo = esa regla cuesta ese tanto de desparejo."""
    r = {**engine.REGLAS_BASE, **(reglas or {}), "minimizar_cambios_vs": None}
    base = engine.optimizar(datos, r, params)
    out = []
    for k, nombre in INTERRUPTORES.items():
        if not r[k]:
            continue
        sin = engine.optimizar(datos, {**r, k: False if k != "viaje_extra_a" else None}, params)
        out.append({"interruptor": nombre, "con_km": base["dif_km"], "sin_km": sin["dif_km"],
                    "costo_km": round(base["dif_km"] - sin["dif_km"], 1)})
    return out
