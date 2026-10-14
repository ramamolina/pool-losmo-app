/* Lee un .xlsx en el navegador (sin servidor) y devuelve los partidos de un equipo.
   Busca la fila de títulos (Fecha, Condición/Local-Visitante, Rival, Nº, Nota) y lee las filas de abajo. */
(function (g) {
  const MESES = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8, sep:9, set:9, oct:10, nov:11, dic:12 };
  const norm = t => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const p2 = n => String(n).padStart(2, "0");
  const colDe = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

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

  function aFecha(v, anioBase) {
    if (v === "" || v == null) return null;
    if (typeof v === "number") { if (v < 30000 || v > 80000) return null; const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5); return d.toISOString().slice(0, 10); }
    const s = norm(v);
    let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${p2(m[2])}-${p2(m[3])}`;
    m = s.match(/(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/);
    if (m) { let y = m[3] ? +m[3] : anioBase; if (y < 100) y += 2000; return `${y}-${p2(m[2])}-${p2(m[1])}`; }
    m = s.match(/(\d{1,2})\s*(?:de\s+)?([a-z]{3})[a-z]*(?:\s*(?:de\s+)?(\d{4}))?/);
    if (m && MESES[m[2]]) return `${m[3] || anioBase}-${p2(MESES[m[2]])}-${p2(m[1])}`;
    return null;
  }
  function aCond(v) {
    const s = norm(v);
    if (!s) return null;
    if (/^(l|local|casa|h|home)\b/.test(s)) return "L";
    if (/^(v|visit|visita|visitante|afuera|a|away)\b/.test(s)) return "V";
    if (/libre|bye|descansa|sin partido|no se juega/.test(s)) return "B";
    return null;
  }

  function interpretar(filas, anioBase) {
    anioBase = anioBase || new Date().getFullYear();
    let h = filas.findIndex(f => f.some(c => /^(fecha|dia|date)\b/.test(norm(c)) && !/^fecha\s*(n|nro|num)/.test(norm(c))));
    if (h < 0) throw new Error("No encontré una columna \"Fecha\". Poné títulos en la primera fila: Fecha, Condición (Local/Visitante), Rival.");
    const tit = filas[h].map(norm), busca = re => tit.findIndex(t => re.test(t));
    const cF = busca(/^(fecha|dia|date)(?!\s*(n|nro|num))/), cN = busca(/^(n[ºo°.]?|nro|num|nº|fecha\s*(n|nro|num))/),
          cC = busca(/cond|local|visit|sede|l\/v|tipo/), cR = busca(/rival|oponente|contra|equipo|vs/), cO = busca(/nota|obs|coment/);
    if (cC < 0 && cR < 0) throw new Error("Faltan las columnas Condición (Local/Visitante) y Rival.");
    const rows = [], avisos = []; let n = 0;
    filas.slice(h + 1).forEach((f, i) => {
      if (f.every(c => c === "")) return;
      const iso = aFecha(f[cF], anioBase);
      if (!iso) { avisos.push(`Fila ${h + i + 2}: no entendí la fecha "${f[cF]}".`); return; }
      let cond = cC >= 0 ? aCond(f[cC]) : null; const rival = cR >= 0 ? String(f[cR] ?? "").trim() : "";
      if (!cond && /libre|bye/i.test(rival)) cond = "B";
      if (!cond) { avisos.push(`Fila ${h + i + 2}: no entendí si es local o visitante ("${f[cC] ?? ""}").`); return; }
      n++; const num = cN >= 0 && f[cN] !== "" ? parseInt(f[cN], 10) || n : n;
      rows.push({ n: num, iso, cond, rival: cond === "B" ? "" : rival, nota: cO >= 0 ? String(f[cO] ?? "") : "" });
    });
    return { rows, avisos };
  }

  async function leerXlsx(bytes, anioBase) { return interpretar(await leerHoja(bytes), anioBase); }
  g.LectorXLSX = { leerXlsx, interpretar };
})(globalThis);
