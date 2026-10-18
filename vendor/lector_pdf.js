/* Lee un PDF en el navegador con pdf.js y arma, página por página, un texto con las columnas
   alineadas con espacios (como `pdftotext -layout`), que después interpreta fixture_pdf.py. */
(function (g) {
  const CW = 4;            // ancho aproximado de un carácter, en puntos
  const TOL_Y = 2;         // dos textos a menos de esto de altura van en la misma línea

  function armarTexto(items) {
    const t = items.filter(i => i.s && i.s.trim() !== "").sort((a, b) => b.y - a.y || a.x - b.x);
    const lineas = [];
    for (const it of t) {
      const l = lineas.length ? lineas[lineas.length - 1] : null;
      if (l && Math.abs(l.y - it.y) <= TOL_Y) l.items.push(it); else lineas.push({ y: it.y, items: [it] });
    }
    return lineas.map(l => {
      l.items.sort((a, b) => a.x - b.x);
      let s = "", fin = null;
      for (const it of l.items) {
        if (fin !== null && it.x - fin < 6) {
          s += " " + it.s.trim();                      // pegado al anterior: un solo espacio
        } else {
          const col = Math.max(Math.round(it.x / CW), s.length ? s.length + 2 : 0);
          s = s.padEnd(col, " ") + it.s.trim();
        }
        fin = it.x + (it.w || 0);
      }
      return s;
    }).join("\n");
  }

  async function leerPaginas(pdfjs, bytes, alProgreso) {
    const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
    const out = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const p = await doc.getPage(n), tc = await p.getTextContent();
      out.push(armarTexto(tc.items.filter(i => i.str !== undefined)
        .map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width }))));
      if (alProgreso) alProgreso(n, doc.numPages);
    }
    return out;
  }
  /* ---- Tablas: devuelve las filas del PDF como celdas, usando la posición de cada texto ----
     Columnas: las marca la línea con más celdas de las primeras (los títulos). Filas: una línea que tiene algo en la
     primera columna abre una fila; las líneas que no (celdas con texto en varios renglones) se pegan a la más cercana. */
  function celdasDeLinea(items) {
    const cel = []; let fin = null;
    for (const it of items.sort((a, b) => a.x - b.x)) {
      const u = cel[cel.length - 1];
      if (u && fin !== null && it.x - fin < 6) { u.s += " " + it.s.trim(); u.x1 = it.x + (it.w || 0); }
      else cel.push({ s: it.s.trim(), x0: it.x, x1: it.x + (it.w || 0) });
      fin = it.x + (it.w || 0);
    }
    return cel;
  }
  function agruparLineas(items) {
    const t = items.filter(i => i.s && i.s.trim() !== "").sort((a, b) => b.y - a.y);
    const lineas = [];
    for (const it of t) { const l = lineas[lineas.length - 1]; if (l && Math.abs(l.y - it.y) <= TOL_Y) l.items.push(it); else lineas.push({ y: it.y, items: [it] }); }
    return lineas.map(l => ({ y: l.y, h: Math.max(...l.items.map(i => i.h || 0), 0), cel: celdasDeLinea(l.items) }));
  }
  function tablaDePaginas(paginas) {              // paginas: [[{s,x,y,w}]]
    const lp = paginas.map(agruparLineas);
    let cab = null;
    for (const lineas of lp) { for (const l of lineas.slice(0, 15)) if (l.cel.length >= 2 && (!cab || l.cel.length > cab.length)) cab = l.cel; if (cab) break; }
    if (!cab) return null;
    const lim = cab.slice(1).map((c, i) => (cab[i].x1 + c.x0) / 2);          // fronteras entre columnas
    const colDe = c => { const m = (c.x0 + c.x1) / 2; let i = 0; while (i < lim.length && m > lim[i]) i++; return i; };
    const filas = [];
    for (const lineas of lp) {
      let anclas = lineas.filter(l => l.cel.some(c => colDe(c) === 0));
      // un nombre largo partido en dos renglones: el renglón con solo la primera columna, pegado al siguiente, no abre fila
      anclas = anclas.filter((l, i) => !(l.cel.length === 1 && anclas[i + 1] && l.h && l.y - anclas[i + 1].y <= 1.3 * l.h));
      if (!anclas.length) continue;
      const grupos = new Map(anclas.map(a => [a, []]));
      for (const l of lineas) {
        const a = anclas.includes(l) ? l : anclas.reduce((b, x) => Math.abs(x.y - l.y) < Math.abs(b.y - l.y) ? x : b);
        grupos.get(a).push(l);
      }
      for (const a of anclas) {
        const fila = []; 
        for (const l of grupos.get(a).sort((x, y) => y.y - x.y)) for (const c of l.cel) { const j = colDe(c); fila[j] = ((fila[j] || "") + " " + c.s).trim(); }
        filas.push(Array.from(fila, x => x ?? ""));
      }
    }
    return filas;
  }
  async function leerTabla(pdfjs, bytes, alProgreso) {
    const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise, pags = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const p = await doc.getPage(n), tc = await p.getTextContent();
      pags.push(tc.items.filter(i => i.str !== undefined).map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: i.height })));
      if (alProgreso) alProgreso(n, doc.numPages);
    }
    return tablaDePaginas(pags);
  }
  g.LectorPDF = { armarTexto, leerPaginas, leerTabla, tablaDePaginas };
})(globalThis);
