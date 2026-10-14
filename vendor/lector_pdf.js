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
  g.LectorPDF = { armarTexto, leerPaginas };
})(globalThis);
