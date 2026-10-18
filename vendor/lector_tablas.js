/* Lectura de archivos con tablas (hoy .xlsx), común a todos los datos de la app.
   Capa 1: abrir el archivo y sacar las filas (leerHoja).
   Capa 2: cada tipo de dato tiene un ESQUEMA (qué columnas espera y cómo se pueden llamar);
           leerTabla busca la fila de títulos aunque la tabla no empiece en A1, reconoce las columnas
           por nombre, y devuelve registros + avisos con el número de fila de lo que no entendió. */
(function (g) {
  const MESES = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8, sep:9, set:9, oct:10, nov:11, dic:12 };
  const norm = t => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const p2 = n => String(n).padStart(2, "0");
  const colDe = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const iso = (y, m, d) => `${y}-${p2(m)}-${p2(d)}`;

  /* ---------- capa 1: abrir el .xlsx ---------- */
  async function leerHoja(bytes) {
    const zip = await g.JSZip.loadAsync(bytes);
    const dom = async ruta => { const f = zip.file(ruta); return f ? new DOMParser().parseFromString(await f.async("string"), "application/xml") : null; };
    const ss = await dom("xl/sharedStrings.xml"), textos = [];
    if (ss) for (const si of ss.getElementsByTagName("si")) textos.push([...si.getElementsByTagName("t")].map(t => t.textContent).join(""));
    let ruta = "xl/worksheets/sheet1.xml";
    if (!zip.file(ruta)) ruta = Object.keys(zip.files).find(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    const hoja = ruta && await dom(ruta);
    if (!hoja) throw new Error("No encontré ninguna hoja en el Excel.");
    const filas = [];
    for (const r of hoja.getElementsByTagName("row")) {
      const fila = [];
      for (const c of r.getElementsByTagName("c")) {
        const v = c.getElementsByTagName("v")[0], t = c.getAttribute("t");
        let val = "";
        if (t === "s" && v) val = textos[+v.textContent] ?? "";
        else if (t === "inlineStr") val = [...c.getElementsByTagName("t")].map(x => x.textContent).join("");
        else if (v) val = t === "str" || t === "b" || t === "e" ? v.textContent : (isNaN(+v.textContent) ? v.textContent : +v.textContent);
        fila[colDe(c.getAttribute("r"))] = val;
      }
      filas[(+r.getAttribute("r") || filas.length + 1) - 1] = Array.from(fila, x => x ?? "");
    }
    return Array.from(filas, f => f || []);
  }

  /* ---------- fechas ---------- */
  function aFecha(v, anio) {
    if (v === "" || v == null) return null;
    if (typeof v === "number") { if (v < 30000 || v > 80000) return null; return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5).toISOString().slice(0, 10); }
    const s = norm(v);
    let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return iso(m[1], m[2], m[3]);
    m = s.match(/^\D*(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/);
    if (m) { let y = m[3] ? +m[3] : anio; if (y < 100) y += 2000; return iso(y, m[2], m[1]); }
    m = s.match(/(\d{1,2})\s*(?:de\s+)?([a-z]{3})[a-z]*(?:\s*(?:de\s+)?(\d{4}))?/);
    if (m && MESES[m[2]]) return iso(m[3] || anio, MESES[m[2]], m[1]);
    return null;
  }

  /* Texto libre con fechas: "9 de agosto; 13, 20 y 27 de septiembre", "13/9", rangos "desde el lunes 10 de
     agosto hasta el lunes 24 de agosto". Devuelve las fechas ISO (los rangos se abren día por día). */
  function fechasEnTexto(texto, anio) {
    let s = " " + norm(texto) + " "; const out = new Set();
    const MES = "(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)[a-z]*";
    const rango = new RegExp(`desde\\s+(?:el\\s+)?(?:[a-z]+\\s+)?(\\d{1,2})\\s*(?:de\\s+)?(?:${MES})?(?:\\s*(?:de\\s+)?(\\d{4}))?\\s+hasta\\s+(?:el\\s+)?(?:[a-z]+\\s+)?(\\d{1,2})\\s*(?:de\\s+)?${MES}(?:\\s*(?:de\\s+)?(\\d{4}))?`, "g");
    s = s.replace(rango, (_, d1, m1, y1, d2, m2, y2) => {
      const mf = MESES[m2], mi = m1 ? MESES[m1] : mf, yf = +(y2 || y1 || anio), yi = +(y1 || y2 || anio);
      let a = Date.UTC(yi, mi - 1, +d1); const b = Date.UTC(yf, mf - 1, +d2);
      for (let i = 0; a <= b && i < 400; i++, a += 864e5) out.add(new Date(a).toISOString().slice(0, 10));
      return " ";
    });
    s = s.replace(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g, (_, d, m, y) => { out.add(iso(y ? (+y < 100 ? 2000 + +y : y) : anio, m, d)); return " "; });
    let pend = [], year = null; const toks = s.match(/\d{4}|\d{1,2}|[a-z]+/g) || [];
    for (const t of toks) {
      if (/^\d{4}$/.test(t)) { year = +t; continue; }
      if (/^\d{1,2}$/.test(t)) { pend.push(+t); continue; }
      const mm = MESES[t.slice(0, 3)];
      if (mm && pend.length) { pend.forEach(d => out.add(iso(year || anio, mm, d))); pend = []; }
    }
    return [...out].sort();
  }

  /* ---------- capa 2: esquemas ---------- */
  const ESQUEMAS = {
    fixture: { requeridas: ["fecha", "cond|rival"], cols: {
      fecha: /^(fecha|dia|date)(?!\s*(n|nro|num))/, n: /^(n[ºo°.]?|nro|num|nº|fecha\s*(n|nro|num))\b/,
      cond: /cond|local|visit|sede|l\/v|tipo/, rival: /rival|oponente|contra|equipo|vs/, nota: /nota|obs|coment/ } },
    conductores: { requeridas: ["nombre|sigla", "cap"], cols: {
      sigla: /sigla|inicial/, cap: /capacidad|asientos|pasajeros|lugares|plazas/, no: /restric|no puede|no disponib|ausen|fechas/,
      tel: /cel|tel|whats/, mail: /mail|correo/, nombre: /conductor|nombre|padre|chofer|apellido/ } },
    distancias: { requeridas: ["local", "visitante", "km"], contenido: "fecha", cols: {
      fecha: /^(fecha|dia|date)/, local: /^local/, visitante: /^visit/, km: /\bkm|kil[oó]metr|distancia/ } },
  };

  function leerTabla(filas, tipo, anio) {
    const esq = ESQUEMAS[tipo], orden = Object.keys(esq.cols);
    const mapear = fila => { const usadas = new Set(), m = {};
      for (const k of orden) { const i = fila.findIndex((c, j) => !usadas.has(j) && c !== "" && typeof c === "string" && esq.cols[k].test(norm(c))); if (i >= 0) { m[k] = i; usadas.add(i); } }
      return m; };
    const ok = m => esq.requeridas.every(r => r.split("|").some(k => k in m));
    let h = -1, col = null;
    for (let i = 0; i < Math.min(filas.length, 40) && h < 0; i++) { const m = mapear(filas[i]); if (ok(m) || (esq.contenido && !(esq.contenido in m) && esq.requeridas.every(r => r.split("|").some(k => k in m || k === esq.contenido)))) { h = i; col = m; } }
    if (h < 0) throw new Error(`No encontré los títulos de las columnas. Para ${tipo} se esperan: ${orden.join(", ")}.`);
    const cuerpo = filas.slice(h + 1);
    if (esq.contenido && !(esq.contenido in col)) { // columna sin título que se reconoce por lo que contiene
      const usadas = new Set(Object.values(col)), ancho = Math.max(...cuerpo.map(f => f.length), 0);
      for (let j = 0; j < ancho; j++) { if (usadas.has(j)) continue; const v = cuerpo.map(f => f[j]).filter(x => x !== "" && x != null);
        if (v.length && v.filter(x => aFecha(x, anio)).length / v.length >= 0.6) { col[esq.contenido] = j; break; } }
      if (!(esq.contenido in col)) throw new Error("No encontré la columna de fechas.");
    }
    return { h, col, cuerpo, titulos: filas[h], desde: h + 2 };
  }

  const vacia = f => f.every(c => c === "");

  function leerFixture(filas, anio) {
    const { col: c, cuerpo, desde } = leerTabla(filas, "fixture", anio), rows = [], avisos = []; let n = 0;
    cuerpo.forEach((f, i) => {
      if (vacia(f)) return;
      const fecha = aFecha(f[c.fecha], anio), fila = desde + i;
      if (!fecha) { avisos.push(`Fila ${fila}: no entendí la fecha "${f[c.fecha]}".`); return; }
      const rival = "rival" in c ? String(f[c.rival] ?? "").trim() : "", s = "cond" in c ? norm(f[c.cond]) : "";
      let cond = /^(l|local|casa|h|home)\b/.test(s) ? "L" : /^(v|visit|visita|visitante|afuera|a|away)\b/.test(s) ? "V" : /libre|bye|descansa|sin partido|no se juega/.test(s) ? "B" : null;
      if (!cond && /libre|bye/i.test(rival)) cond = "B";
      if (!cond) { avisos.push(`Fila ${fila}: no entendí si es local o visitante ("${f[c.cond] ?? ""}").`); return; }
      n++; rows.push({ n: "n" in c && f[c.n] !== "" ? parseInt(f[c.n], 10) || n : n, iso: fecha, cond, rival: cond === "B" ? "" : rival, nota: "nota" in c ? String(f[c.nota] ?? "") : "" });
    });
    return { rows, avisos };
  }

  function leerConductores(filas, anio) {
    const { col: c, cuerpo, desde, titulos } = leerTabla(filas, "conductores", anio), drivers = [], avisos = [];
    const unidad = /pasajero/.test(norm(titulos[c.cap])) ? "pasajeros" : "asientos";
    cuerpo.forEach((f, i) => {
      if (vacia(f)) return;
      const nombre = "nombre" in c ? String(f[c.nombre]).trim() : "", sigla = "sigla" in c ? String(f[c.sigla]).replace(/\s/g, "").toUpperCase() : "", fila = desde + i;
      const cap = parseInt(String(f[c.cap]).replace(",", "."), 10);
      if (!nombre && !sigla) return;
      if (!(cap > 0)) { avisos.push(`Fila ${fila}: no entendí la capacidad del auto de ${nombre || sigla} ("${f[c.cap]}").`); return; }
      const texto = "no" in c ? String(f[c.no] ?? "") : "";
      const fechas = texto.trim() ? fechasEnTexto(texto, anio) : [];
      if (texto.trim() && !fechas.length) avisos.push(`Fila ${fila}: no pude sacar fechas de "${texto}" (${nombre || sigla}).`);
      drivers.push({ nombre, ini: sigla, cap, tel: "tel" in c ? String(f[c.tel] ?? "") : "", mail: "mail" in c ? String(f[c.mail] ?? "") : "", textoNo: texto, no: fechas });
    });
    return { drivers, unidad, avisos };
  }

  function leerDistancias(filas, anio) {
    const { col: c, cuerpo, desde, titulos } = leerTabla(filas, "distancias", anio), rows = [], avisos = [];
    const t = norm(titulos[c.km]), idaVuelta = /ida y vuelta|i\/v|ida-vuelta|ida \+ vuelta/.test(t);
    cuerpo.forEach((f, i) => {
      if (vacia(f)) return;
      const fecha = aFecha(f[c.fecha], anio), km = parseFloat(String(f[c.km]).replace(",", ".")), fila = desde + i;
      if (!fecha) { avisos.push(`Fila ${fila}: no entendí la fecha "${f[c.fecha]}".`); return; }
      if (!(km > 0)) { avisos.push(`Fila ${fila}: no entendí los km ("${f[c.km]}").`); return; }
      rows.push({ iso: fecha, local: String(f[c.local]).trim(), visitante: String(f[c.visitante]).trim(), km: idaVuelta ? km : km * 2, kmArchivo: km });
    });
    return { rows, idaVuelta, avisos };
  }

  /* ---------- Word (.docx): tablas del documento; si no hay, párrafos separados por tab o 2+ espacios ---------- */
  async function leerDocx(bytes) {
    const zip = await g.JSZip.loadAsync(bytes), f = zip.file("word/document.xml");
    if (!f) throw new Error("No encontré el contenido del Word.");
    const doc = new DOMParser().parseFromString(await f.async("string"), "application/xml");
    const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const hijos = (el, tag) => [...el.childNodes].filter(n => n.localName === tag && n.namespaceURI === W);
    const textoDe = el => { let t = ""; (function rec(n) { for (const h of n.childNodes) {
      if (h.namespaceURI !== W) continue;
      if (h.localName === "t") t += h.textContent; else if (h.localName === "tab") t += "\t"; else if (h.localName === "br") t += " ";
      else if (h.localName === "p" && t && !t.endsWith(" ")) { t += " "; rec(h); } else rec(h); } })(el); return t.replace(/\s+/g, " ").trim(); };
    const filas = [];
    for (const tbl of doc.getElementsByTagNameNS(W, "tbl"))
      for (const tr of hijos(tbl, "tr")) filas.push(hijos(tr, "tc").map(tc => textoDe(tc)));
    if (filas.length) return filas;
    const cuerpo = doc.getElementsByTagNameNS(W, "body")[0], out = [];
    for (const p of cuerpo ? hijos(cuerpo, "p") : []) {
      const t = (() => { let x = ""; for (const n of p.getElementsByTagNameNS(W, "*")) { if (n.localName === "t") x += n.textContent; else if (n.localName === "tab") x += "\t"; } return x; })();
      if (t.trim()) out.push(t.trim().split(/\t+|\s{2,}/).map(c => c.trim()));
    }
    return out;
  }

  /* ---------- PDF: cada línea de texto se parte en celdas donde hay 2+ espacios (las columnas quedan alineadas) ---------- */
  async function leerPdf(bytes, pdfjs) {
    if (!pdfjs || !g.LectorPDF) throw new Error("Falta el lector de PDF.");
    let filas = await g.LectorPDF.leerTabla(pdfjs, bytes);
    if (!filas || !filas.length) {                      // sin columnas claras: se parte cada línea donde hay 2+ espacios
      filas = [];
      for (const t of await g.LectorPDF.leerPaginas(pdfjs, bytes)) for (const l of t.split("\n")) if (l.trim()) filas.push(l.trim().split(/\s{2,}/));
    }
    if (!filas.length) throw new Error("El PDF no tiene texto (¿es una foto o un escaneo?). Probá con una versión en Excel o Word.");
    return filas;
  }

  /* Abre cualquier archivo con tablas: PDF, Word o Excel (se reconoce por el contenido, no por la extensión). */
  async function abrir(bytes, opc) {
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u.length > 4 && String.fromCharCode(u[0], u[1], u[2], u[3]) === "%PDF") return leerPdf(u, opc && opc.pdfjs);
    if (u[0] === 0x50 && u[1] === 0x4b) {
      const zip = await g.JSZip.loadAsync(u);
      if (zip.file("word/document.xml")) return leerDocx(u);
      return leerHoja(u);
    }
    throw new Error("No reconozco el formato. Se leen Excel (.xlsx), Word (.docx) y PDF.");
  }
  g.LectorTablas = { abrir, leerHoja, leerDocx, leerPdf, aFecha, fechasEnTexto, leerFixture, leerConductores, leerDistancias, ESQUEMAS };
})(globalThis);
