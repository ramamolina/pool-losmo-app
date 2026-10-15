"""Motor de optimización del pool (etapa 1, sin pantallas).

Cada restricción tiene interruptor en `reglas`. Se minimiza primero la
diferencia de km entre el conductor que más y el que menos hace, y después
el máximo de km (para desempatar).
"""
import json, math, datetime as dt
import numpy as np
from scipy.optimize import milp, LinearConstraint, Bounds

REGLAS_BASE = {
    "disponibilidad": True,         # respeta las fechas no disponibles
    "sin_fines_consecutivos": True, # nadie maneja dos fines de semana calendario seguidos
    "viajes_parejos": True,         # diferencia máxima de viajes entre conductores
    "max_dif_viajes": 1,
    "compensar_viaje_extra": True,  # quien hace más viajes que el mínimo tiene mayoría de local
    "viaje_extra_a": None,          # id de conductor al que se le fija el viaje extra (o None: elige el motor)
    "minimizar_cambios_vs": None,   # lista de choferes (uno por partido) de la versión anterior: cambiar lo mínimo
    "tolerancia_km": 0,             # cuánto se acepta empeorar la diferencia de carga para cambiar menos fechas
    "autos_extra": 0,               # autos que el motor puede sumar sobre el mínimo que alcanza en cada fecha
    "costo_auto_extra_km": 0,       # cuánto "cuesta" (en km de diferencia) cada auto que se suma
}

# Parámetros de la temporada (se cargan en la pantalla de parámetros de la app)
PARAMS_BASE = {
    "estacionamiento_en_km": False,  # True: el estacionamiento se convierte a km y cuenta en la optimización
                                     # False: se reparte entre los choferes (reembolso) y no cuenta como km
    "estacionamiento_pesos": 15000,  # costo del estacionamiento del visitante
    "nafta_pesos_litro": 2500,       # precio del litro de nafta/diesel
    "km_por_litro": 10,              # autonomía estándar
    "dia_pool_km": 0,                # km equivalentes de un día entero de pool
    "extra_visitante_km": 0,         # peso extra de visitante, además del estacionamiento
    "dia_padre_madre_km": None,      # None: igual al peso de visitante (estacionamiento + extra)
    "fechas_especiales": [],         # Día del Padre / de la Madre (lista de fechas ISO)
}

def km_estacionamiento(p):
    return p["estacionamiento_pesos"] / p["nafta_pesos_litro"] * p["km_por_litro"]

def cargas(datos, params):
    """Carga (en km equivalentes) de hacer el pool de cada partido."""
    p = {**PARAMS_BASE, **(params or {})}
    park = km_estacionamiento(p) if p["estacionamiento_en_km"] else 0.0
    peso_v = park + p["extra_visitante_km"]
    dpm = peso_v if p["dia_padre_madre_km"] is None else p["dia_padre_madre_km"]
    esp = {dt.date.fromisoformat(x) for x in p["fechas_especiales"]}
    out = []
    for m in datos["partidos"]:
        w = m["km_iv"] + p["dia_pool_km"]
        if m["cond"] == "V":
            w += peso_v
        elif m["fecha"] in esp:
            w += dpm
        out.append(w)
    return out

def cargar(path):
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    for p in d["partidos"]:
        p["fecha"] = dt.date.fromisoformat(p["fecha"])
    for c in d["conductores"]:
        c["no_disponible"] = {dt.date.fromisoformat(x) for x in c["no_disponible"]}
        if "asientos" not in c:  # compatibilidad con archivos viejos
            c["asientos"] = c["pasajeros"] + 1
    return d

def autos_necesarios(datos):
    """Autos mínimos por fecha según capacidad (asientos totales; pasajeros = asientos - 1) y jugadores a transportar,
    con todos los conductores disponibles."""
    return max(_autos_min([c["asientos"] - 1 for c in datos["conductores"]], datos["plantel"]["a_transportar"]) or 1, 1)

def _autos_min(caps, n):
    """Mínimo de autos (usando primero los más grandes) para llevar n chicos; None si no alcanzan."""
    autos, resto = 0, n
    for cap in sorted(caps, reverse=True):
        if resto <= 0:
            break
        autos += 1
        resto -= cap
    return autos if resto <= 0 else None

def autos_por_fecha(datos, reglas=None):
    """Por fecha: autos mínimos con los conductores que pueden ese día (None si no alcanzan)."""
    r = {**REGLAS_BASE, **(reglas or {})}
    n = datos["plantel"]["a_transportar"]
    out = []
    for p in datos["partidos"]:
        caps = [c["asientos"] - 1 for c in datos["conductores"]
                if not (r["disponibilidad"] and p["fecha"] in c["no_disponible"])]
        out.append(_autos_min(caps, n))
    return out

def optimizar(datos, reglas=None, params=None):
    """Un conductor o más por fecha: cada auto que sale lleva sus asientos - 1 chicos y hace el viaje completo.
    La cantidad de autos de cada fecha la decide el motor entre el mínimo que alcanza y el mínimo + `autos_extra`."""
    r = {**REGLAS_BASE, **(reglas or {})}
    P, C = datos["partidos"], datos["conductores"]
    nP, nC = len(P), len(C)
    kids = datos["plantel"]["a_transportar"]
    caps = [c["asientos"] - 1 for c in C]
    km = cargas(datos, params)
    loc = [1 if p["cond"] == "L" else 0 for p in P]
    extra = int(r["autos_extra"] or 0)
    lam = float(r["costo_auto_extra_km"] or 0)
    minimos = autos_por_fecha(datos, r)
    if any(m is None for m in minimos):
        return None
    disp = [[not (r["disponibilidad"] and P[m]["fecha"] in C[c]["no_disponible"]) for c in range(nC)] for m in range(nP)]
    maxa = [min(minimos[m] + extra, sum(disp[m]), kids) for m in range(nP)]

    # variables: x[m,c] (nP*nC) | Kmax | Kmin | nmin | y[c] (nC)
    ix = lambda m, c: m * nC + c
    iKmax, iKmin, iN = nP * nC, nP * nC + 1, nP * nC + 2
    iy = lambda c: nP * nC + 3 + c
    nv = nP * nC + 3 + nC
    integrality = np.zeros(nv); integrality[:nP * nC] = 1; integrality[iN:] = 1
    lb, ub = np.zeros(nv), np.ones(nv)
    ub[iKmax] = ub[iKmin] = 1e6
    ub[iN] = 2 * nP

    rows, lo, hi = [], [], []
    def add(coefs, l, h):
        v = np.zeros(nv)
        for i, a in coefs: v[i] += a
        rows.append(v); lo.append(l); hi.append(h)

    for m in range(nP):  # autos de la fecha: alcanzan los asientos y no más que el máximo permitido
        add([(ix(m, c), caps[c]) for c in range(nC)], kids, np.inf)
        add([(ix(m, c), 1) for c in range(nC)], 1, maxa[m])
        for c in range(nC):
            if not disp[m][c]:
                ub[ix(m, c)] = 0
    if r["sin_fines_consecutivos"]:
        for m in range(nP - 1):
            if (P[m + 1]["fecha"] - P[m]["fecha"]).days == 7:
                for c in range(nC):
                    add([(ix(m, c), 1), (ix(m + 1, c), 1)], 0, 1)
    for c in range(nC):  # Kmin <= km_c <= Kmax
        kc = [(ix(m, c), km[m]) for m in range(nP)]
        add(kc + [(iKmax, -1)], -np.inf, 0)
        add(kc + [(iKmin, -1)], 0, np.inf)
    ntot = lambda c: [(ix(m, c), 1) for m in range(nP)]
    for c in range(nC):  # nmin <= viajes de cada conductor (queda en el mínimo real porque conviene)
        add(ntot(c) + [(iN, -1)], 0, np.inf)
    if r["viajes_parejos"]:
        for c in range(nC):
            for e in range(nC):
                if c != e:
                    add(ntot(c) + [(ix(m, e), -1) for m in range(nP)], -np.inf, r["max_dif_viajes"])
    if r["compensar_viaje_extra"]:
        big = sum(maxa) + 1
        D = r["max_dif_viajes"] if r["viajes_parejos"] else sum(maxa)
        for c in range(nC):
            # y=1 si hace más viajes que el mínimo:  n_c - nmin <= D*y
            add(ntot(c) + [(iN, -1), (iy(c), -D)], -np.inf, 0)
            # y=1  =>  2*L_c - n_c >= 1  (mayoría de local)
            add([(ix(m, c), 2 * loc[m] - 1) for m in range(nP)] + [(iy(c), -big)], 1 - big, np.inf)
    if r["viaje_extra_a"]:
        c = [k["id"] for k in C].index(r["viaje_extra_a"])
        add(ntot(c) + [(iN, -1)], 1, np.inf)

    A = np.array(rows); cons_lo, cons_hi = np.array(lo), np.array(hi)
    cobj = np.zeros(nv); cobj[iKmax], cobj[iKmin] = 1, -1
    for m in range(nP):          # cada auto de más cuesta lam km equivalentes de diferencia
        for c in range(nC):
            cobj[ix(m, c)] += lam
    res = milp(cobj, constraints=LinearConstraint(A, cons_lo, cons_hi),
               integrality=integrality, bounds=Bounds(lb, ub))
    if res.status != 0:
        return None
    dif = res.fun
    # etapa 2: con ese costo (más la tolerancia), bajar el máximo de carga o,
    # si se pidió, cambiar lo mínimo respecto de la versión anterior
    ids = [k["id"] for k in C]
    cobj2 = np.zeros(nv)
    prev = r.get("minimizar_cambios_vs")
    if prev:
        for m in range(nP):
            for pid in str(prev[m]).split(" + "):
                if pid in ids:
                    cobj2[ix(m, ids.index(pid))] -= 1   # maximizar coincidencias = minimizar cambios
    else:
        cobj2[iKmax] = 1
    tol = r.get("tolerancia_km", 0) or 0
    A2 = np.vstack([A, cobj]); lo2 = np.append(cons_lo, -np.inf); hi2 = np.append(cons_hi, dif + tol + 1e-6)
    res2 = milp(cobj2, constraints=LinearConstraint(A2, lo2, hi2),
                integrality=integrality, bounds=Bounds(lb, ub))
    x = np.round(res2.x[:nP * nC]).astype(int).reshape(nP, nC)
    asign = [[C[c]["id"] for c in range(nC) if x[m, c]] for m in range(nP)]
    return resumen(datos, asign, r, params, minimos)

def resumen(datos, asign, reglas=None, params=None, minimos=None):
    P, C = datos["partidos"], datos["conductores"]
    w = cargas(datos, params)
    out = {c["id"]: {"viajes": 0, "locales": 0, "visitante": 0, "km": 0.0, "carga_km": 0.0} for c in C}
    asign = [[a] if isinstance(a, str) else list(a) for a in asign]
    for p, wm, grupo in zip(P, w, asign):
        for a in grupo:
            o = out[a]; o["viajes"] += 1
            o["km"] = round(o["km"] + p["km_iv"], 1); o["carga_km"] = round(o["carga_km"] + wm, 1)
            o["locales" if p["cond"] == "L" else "visitante"] += 1
    cs = [o["carga_km"] for o in out.values()]
    p = {**PARAMS_BASE, **(params or {})}
    liquidacion = None
    if not p["estacionamiento_en_km"]:
        # cada fecha de visitante, el costo se divide entre todos los choferes; quien manejó lo adelantó
        costo = p["estacionamiento_pesos"]
        n = len(C)
        saldo = {c["id"]: 0.0 for c in C}
        for pa, grupo in zip(P, asign):
            if pa["cond"] == "V":
                for k in saldo: saldo[k] -= costo * len(grupo) / n
                for a in grupo: saldo[a] += costo
        liquidacion = {k: round(v) for k, v in saldo.items()}  # + recibe, - paga
    return {"liquidacion_estacionamiento": liquidacion, "asignacion": list(zip([p["fecha"].isoformat() for p in P], [" + ".join(g) for g in asign])),
            "autos": [len(g) for g in asign], "autos_minimos": minimos,
            "por_conductor": out, "dif_km": round(max(cs) - min(cs), 1),
            "reglas": reglas, "params": params}
