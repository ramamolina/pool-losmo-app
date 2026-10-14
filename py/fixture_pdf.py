"""Lectura del fixture de la URBA (PDF con muchas divisiones, una por página).

Devuelve una lista de divisiones; cada una trae sus clubes, sus fechas, los partidos
de cada fecha y las notas al pie. Después `buscar` arma el calendario del club que
se sigue y `candidatos` dice en qué divisiones aparece (para la pantalla de confirmación).
"""
import re, subprocess, datetime as dt, unicodedata

MESES = {"enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7, "agosto": 8,
         "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12}
FECHA_RE = r"([a-záéíóú]+) (\d{1,2}), (\d{4})"

def _fecha(txt):
    m = re.fullmatch(FECHA_RE, txt.strip().lower())
    if not m or m.group(1) not in MESES:
        return None
    return dt.date(int(m.group(3)), MESES[m.group(1)], int(m.group(2)))

def _sin_acentos(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower().strip()

def separar_equipo(nombre):
    """'Los Molinos A' -> ('Los Molinos', 'A'). Sin letra final -> (nombre, '')."""
    m = re.fullmatch(r"(.+?)\s+([A-Z])", nombre.strip())
    return (m.group(1), m.group(2)) if m else (nombre.strip(), "")

def texto_paginas(pdf_path):
    out = subprocess.run(["pdftotext", "-layout", pdf_path, "-"], capture_output=True, text=True, check=True).stdout
    return out.split("\f")

def _parse_pagina(txt, n_pag):
    lines = txt.splitlines()
    title = next((l.strip() for l in lines if re.search(r"DIVISI[ÓO]N MENORES DE", l)), None)
    if not title:
        return None
    m = re.search(r"MENORES DE (\d+)\s*-?\s*(.*?)\s*(Eq B)?\s*(\d)º Rueda (\d{4})", title)
    div = {"pagina": n_pag, "categoria": int(m.group(1)), "division": m.group(2).strip(),
           "equipo_b": bool(m.group(3)), "rueda": int(m.group(4)), "anio": int(m.group(5)),
           "titulo": title, "clubes": [], "fechas": {}, "especiales": [], "horario": None,
           "partidos": {}, "marcas": {}, "notas": [], "notas_num": {}}
    h = re.search(r"Horario de los partidos (\d{1,2}:\d{2})", txt)
    div["horario"] = h.group(1) if h else None

    # --- tabla de clubes y fechas (arriba) ---
    i = 0
    while i < len(lines) and not re.search(r"^\s*Nº\s+CLUB", lines[i]):
        i += 1
    i += 1
    ultimo_label = None
    while i < len(lines) and lines[i].strip() and "Horario de los partidos" not in lines[i]:
        l = lines[i]
        cols = re.split(r"\s{2,}", l.strip())
        mm = re.match(r"^(\d+)\s+(.+)$", cols[0])
        if mm:
            div["clubes"].append((int(mm.group(1)), mm.group(2).strip()))
            resto = cols[1:]
        else:
            resto = cols
        # resto: [n_fecha, fecha, (extra)] o [extra]
        k = 0
        if resto and re.fullmatch(r"\d+", resto[0]) and len(resto) > 1 and _fecha(resto[1]):
            div["fechas"][int(resto[0])] = _fecha(resto[1]); k = 2
        elif resto and re.fullmatch(r"\d+", resto[0]) and len(resto) > 1 and resto[1].strip().upper() == "NO SE JUEGA":
            div["fechas"][int(resto[0])] = None; k = 2
        for extra in resto[k:]:
            f = _fecha(extra)
            if f and ultimo_label is not None:
                div["especiales"].append({"nombre": ultimo_label, "fecha": f}); ultimo_label = None
            elif not f:
                ultimo_label = extra.strip()
        i += 1

    # --- bloques FECHA n (grilla de partidos) ---
    cur = []
    for l in lines[i:]:
        s = l.strip()
        if not s:
            continue
        mf = re.fullmatch(r"FECHA (\d+)(?:\s+FECHA (\d+))?", s)
        if mf:
            cur = [int(x) for x in mf.groups() if x]
            for n in cur:
                div["partidos"].setdefault(n, [])
            continue
        if _fecha(s.split("  ")[0]) and cur:
            continue                                            # línea con la fecha de cada bloque
        if re.fullmatch(r"Club Local\s+Club Visitante(\s+Club Local\s+Club Visitante)?", s) or "UNION DE RUGBY" in s \
                or "Horario de los partidos" in s:
            continue
        if s.upper() == "NO SE JUEGA":
            continue
        mn = re.match(r"^\((\d+)\)\s+(El |La |Los |Las |[A-Z][a-z]+ )?.*\b(juega|se juega|jugar|horario|hs)\b", s)
        if mn and not re.search(r"\s{2,}", s):
            div["notas_num"][int(re.match(r"^\((\d+)\)", s).group(1))] = re.sub(r"^\(\d+\)\s*", "", s)
            continue
        if cur:
            cols = re.split(r"\s{2,}", s)
            if len(cols) in (2, 4) and all(not re.search(r"\bse juega\b", c) for c in cols):
                for idx, n in enumerate(cur):
                    if 2 * idx + 1 < len(cols):
                        pair, ids = [], []
                        for c in (cols[2 * idx], cols[2 * idx + 1]):
                            mk = re.match(r"^\((\d+)\)\s*(.+)$", c)
                            if mk:
                                ids.append(int(mk.group(1))); c = mk.group(2)
                            pair.append(c)
                        div["partidos"][n].append(tuple(pair))
                        if ids:
                            div["marcas"][(n, pair[0], pair[1])] = ids
                continue
        div["notas"].append(s)
    return div

def leer_fixture(pdf_path):
    divs = []
    for n, txt in enumerate(texto_paginas(pdf_path), start=1):
        d = _parse_pagina(txt, n)
        if d:
            divs.append(d)
    return divs

def validar_division(d):
    """Devuelve la lista de problemas de coherencia de una división (vacía = todo bien)."""
    pro = []
    nombres = [c for _, c in d["clubes"]]
    N = len(nombres)
    reales = {c for c in nombres if c.lower() != "bye"}
    jugadas = {n for n, f in d["fechas"].items() if f is not None}
    con_partidos = {n for n, ps in d["partidos"].items() if ps and d["fechas"].get(n) is not None}
    if con_partidos != jugadas:
        pro.append(f"fechas con partidos {sorted(con_partidos)} distintas de fechas con día {sorted(jugadas)}")
    vistos = set()
    for n, ps in d["partidos"].items():
        if d["fechas"].get(n) is None:
            continue                                   # fecha que "no se juega": no se valida
        esperados = N // 2
        if ps and len(ps) != esperados:
            pro.append(f"fecha {n}: {len(ps)} partidos (se esperaban {esperados})")
        jug = [x for p in ps for x in p if x.lower() != "bye"]
        if len(set(jug)) != len(jug):
            pro.append(f"fecha {n}: un club juega dos veces")
        for loc, vis in ps:
            if loc not in nombres or vis not in nombres:
                pro.append(f"fecha {n}: club desconocido en {loc} vs {vis}")
            par = frozenset((loc, vis))
            if "bye" in (loc.lower(), vis.lower()):
                continue
            if par in vistos:
                pro.append(f"cruce repetido {loc} vs {vis}")
            vistos.add(par)
    return pro

def candidatos(divs, club="Los Molinos"):
    """Divisiones donde juega el club: lista de (categoria, division, equipo B?, letra del equipo, página)."""
    out = []
    for d in divs:
        for _, nombre in d["clubes"]:
            c, letra = separar_equipo(nombre)
            if _sin_acentos(c) == _sin_acentos(club):
                out.append({"categoria": d["categoria"], "division": d["division"], "equipo_b": d["equipo_b"],
                            "equipo": letra, "pagina": d["pagina"], "horario": d["horario"], "nombre": nombre})
    return out

def calendario(d, nombre_club):
    """Calendario del club `nombre_club` (como figura en la división, ej. 'Los Molinos A')."""
    cal = []
    for n in sorted((k for k in d["partidos"] if d["fechas"].get(k)), key=lambda k: d["fechas"][k]):
        for loc, vis in d["partidos"][n]:
            if nombre_club in (loc, vis):
                cond = "L" if loc == nombre_club else "V"
                rival = vis if cond == "L" else loc
                if rival.lower() == "bye":
                    cond, rival = "B", None          # descanso: no juega esa fecha
                notas = [d["notas_num"].get(i, f"nota {i}") for i in d["marcas"].get((n, loc, vis), [])]
                cal.append({"fecha_n": n, "fecha": d["fechas"][n], "cond": cond, "rival": rival,
                            "local": loc, "visitante": vis, "horario": d["horario"], "notas": notas})
    return cal

def domingos_libres(d, cal):
    """Domingos entre el primer y el último partido del club en los que no juega."""
    fechas = {c["fecha"] for c in cal}
    if not fechas:
        return []
    x, fin, libres = min(fechas), max(fechas), []
    while x <= fin:
        if x.weekday() == 6 and x not in fechas:
            libres.append(x)
        x += dt.timedelta(days=1)
    return libres


# ---------------------------------------------------------------------------
# Unificación de nombres de club (el fixture escribe el mismo club de varias formas)
# ---------------------------------------------------------------------------
import collections, difflib

# Errores de tipeo y abreviaturas del fixture que sí son el mismo club.
# Claves normalizadas (sin acentos, minúsculas, sin puntos). "Atl. San Andres" y "San Andres"
# son clubes distintos, por eso NO se unen por parecido: solo por esta tabla y por la normalización.
ALIAS_CLUBES = {
    "argentno": "argentino",
    "munc de berazategui": "munic de berazategui",
    "tiro f de baradero": "t f de baradero",
    "atl chascomus": "atletico chascomus",
}

def clave_club(nombre):
    """Clave para comparar nombres: sin acentos, minúsculas, sin puntos ni espacios de más."""
    s = _sin_acentos(nombre)
    s = re.sub(r"[.\-_,]", " ", s)
    return re.sub(r"\s+", " ", s).strip()

def unificar_clubes(divs, alias=None):
    """Unifica los nombres de club en todas las divisiones (modifica `divs`).
    Devuelve {variante: nombre unificado} solo para los nombres que cambian."""
    alias = ALIAS_CLUBES if alias is None else alias
    cuentas = collections.Counter()
    for d in divs:
        for _, n in d["clubes"]:
            base, _l = separar_equipo(n)
            if base.lower() != "bye":
                cuentas[base] += 1
    grupos = collections.defaultdict(list)
    for base in cuentas:
        k = clave_club(base)
        grupos[alias.get(k, k)].append(base)
    canon = {}
    for variantes in grupos.values():
        # gana la variante más usada; a igualdad, la que no escribe "De"/"La" con mayúscula en medio del nombre
        mejor = max(variantes, key=lambda v: (cuentas[v], -len(re.findall(r"(?<=\s)(?:De|Del|La|Las|Los|Y)\b", v)),
                                              v.count("."), len(v)))
        for v in variantes:
            if v != mejor:
                canon[v] = mejor

    def ren(nombre):
        base, letra = separar_equipo(nombre)
        if base in canon:
            return canon[base] + (" " + letra if letra else "")
        return nombre

    for d in divs:
        d["clubes"] = [(num, ren(n)) for num, n in d["clubes"]]
        d["partidos"] = {f: [(ren(a), ren(b)) for a, b in ps] for f, ps in d["partidos"].items()}
        d["marcas"] = {(f, ren(a), ren(b)): ids for (f, a, b), ids in d["marcas"].items()}
    return canon

def posibles_duplicados(divs, umbral=0.82):
    """Pares de clubes con nombre parecido que NO se unieron solos (para que el usuario decida)."""
    bases = sorted({separar_equipo(n)[0] for d in divs for _, n in d["clubes"] if n.lower() != "bye"})
    out = []
    for i, a in enumerate(bases):
        for b in bases[i + 1:]:
            ka, kb = clave_club(a), clave_club(b)
            r = difflib.SequenceMatcher(None, ka, kb).ratio()
            if r >= umbral or ka.startswith(kb) or kb.startswith(ka):
                out.append((a, b, round(r, 2)))
    return out
