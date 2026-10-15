/* Salidas de Pool LosMo: arma lo que recibe cada conductor (resumen, fixture, calendario .ics) y los enlaces de WhatsApp y mail.
   Funciones puras: reciben un "ctx" y devuelven texto, para poder probarlas sin pantalla.
   ctx = { equipo, horario "14:00", fechas:[{iso, cond "L"|"V", rival, sede:{nombre,dir}|null, km}], asig:{iso:"AM + FAH"},
           conductores:[{ini, nombre, tel, mail}], liquidacion:{ini: pesos}|null, notas:"" } */
(function (g) {
  const DIAL = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const MESL = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const parse = iso => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const fechaL = iso => { const d = parse(iso); return `${DIAL[d.getUTCDay()]} ${d.getUTCDate()} de ${MESL[d.getUTCMonth()]}`; };
  const fechaC = iso => { const d = parse(iso); return `${DIAL[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`; };
  const km1 = n => (n == null ? "" : String(Math.round(n * 10) / 10).replace(".", ","));
  const pesos = n => "$" + Math.abs(Math.round(n)).toLocaleString("es-AR");

  const quienes = a => (a || "").split("+").map(s => s.trim()).filter(Boolean);

  /* Teléfono argentino -> formato internacional para wa.me (54 9 + área + número, sin 0 ni 15). Devuelve "" si no se puede. */
  function telWA(t) {
    let d = String(t || "").replace(/[^\d+]/g, "");
    if (!d) return "";
    const plus = d.startsWith("+"); d = d.replace(/\D/g, "");
    if (plus || d.startsWith("54")) {                      // ya viene con país
      if (d.startsWith("54") && d.length >= 12 && d[2] !== "9") d = "549" + d.slice(2);
      return d.length >= 12 ? d : "";
    }
    d = d.replace(/^0+/, "");
    d = d.replace(/^(\d{2,4})15(\d{6,8})$/, "$1$2");       // 011 15 5555 1234 -> 11 5555 1234
    if (d.length === 10) return "549" + d;
    if (d.length === 8) return "54911" + d;                // sin área: se asume Buenos Aires
    return "";
  }

  const viajesDe = (ctx, ini) => ctx.fechas.filter(f => quienes(ctx.asig[f.iso]).includes(ini));
  const sedeTxt = f => f.cond === "L" ? "Local (en el club)" : "Visitante" + (f.sede ? " en " + f.sede.nombre + (f.sede.dir && f.sede.dir !== f.sede.nombre ? ", " + f.sede.dir : "") : "");

  function fixtureTexto(ctx) {
    const nom = ini => { const c = ctx.conductores.find(x => x.ini === ini); return c && c.nombre ? c.nombre.split(" ")[0] : ini; };
    const lin = ctx.fechas.map(f => `${fechaC(f.iso)} · ${f.cond === "L" ? "Local" : "Visitante"} vs ${f.rival} → ${quienes(ctx.asig[f.iso]).map(nom).join(" + ") || "sin asignar"}`);
    return `*Pool ${ctx.equipo}* (${ctx.horario} hs)\n` + lin.join("\n");
  }

  function resumenConductor(ctx, c) {
    const v = viajesDe(ctx, c.ini), nombre = (c.nombre || c.ini).split(" ")[0];
    if (!v.length) return `Hola ${nombre}! En el pool ${ctx.equipo} de esta temporada no te toca manejar ningún partido.`;
    const km = v.reduce((s, f) => s + (f.km || 0), 0);
    const lin = v.map(f => {
      const cos = quienes(ctx.asig[f.iso]).filter(x => x !== c.ini);
      return `• ${fechaL(f.iso)} · vs ${f.rival} · ${sedeTxt(f)}${f.km ? " (" + km1(f.km) + " km)" : ""}${cos.length ? " · con " + cos.join(" y ") : ""}`;
    });
    let t = `Hola ${nombre}! Estos son tus viajes del pool ${ctx.equipo} (partidos ${ctx.horario} hs):\n` + lin.join("\n") +
      `\nTotal: ${v.length} ${v.length === 1 ? "viaje" : "viajes"}${km ? ", " + km1(km) + " km" : ""}.`;
    const l = ctx.liquidacion && ctx.liquidacion[c.ini];
    if (l) t += `\nEstacionamiento: ${l > 0 ? "te corresponde recibir " : "te toca pagar "}${pesos(l)}.`;
    return t;
  }

  /* Calendario: un evento por viaje, con aviso el día anterior. Hora local de Buenos Aires. */
  function ics(ctx, c) {
    const esc = t => String(t || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
    const [hh, mm] = (ctx.horario || "14:00").split(":").map(Number);
    const ymd = iso => iso.replace(/-/g, "");
    const hm = (h, m) => String(h).padStart(2, "0") + String(m).padStart(2, "0") + "00";
    const sello = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Pool LosMo//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:" + esc("Pool " + ctx.equipo)];
    for (const f of viajesDe(ctx, c.ini)) {
      const cos = quienes(ctx.asig[f.iso]).filter(x => x !== c.ini), fin = Math.min(hh + 2, 23);
      out.push("BEGIN:VEVENT", `UID:poollosmo-${ymd(f.iso)}-${c.ini}@ramamolina.github.io`, "DTSTAMP:" + sello,
        `DTSTART;TZID=America/Argentina/Buenos_Aires:${ymd(f.iso)}T${hm(hh, mm)}`, `DTEND;TZID=America/Argentina/Buenos_Aires:${ymd(f.iso)}T${hm(fin, mm)}`,
        "SUMMARY:" + esc(`Pool ${ctx.equipo}: ${f.cond === "L" ? "local" : "visitante"} vs ${f.rival}`),
        "DESCRIPTION:" + esc(`Te toca manejar.${f.km ? " " + km1(f.km) + " km." : ""}${cos.length ? " Con " + cos.join(" y ") + "." : ""}`));
      if (f.cond === "V" && f.sede) out.push("LOCATION:" + esc(f.sede.nombre + (f.sede.dir ? ", " + f.sede.dir : "")));
      out.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Mañana te toca el pool", "TRIGGER:-P1D", "END:VALARM", "END:VEVENT");
    }
    out.push("END:VCALENDAR");
    return out.join("\r\n") + "\r\n";
  }

  const waLink = (tel, texto) => { const n = telWA(tel); return `https://wa.me/${n}?text=${encodeURIComponent(texto)}`; };
  const waGrupo = texto => `https://wa.me/?text=${encodeURIComponent(texto)}`;
  const mailLink = (mail, asunto, texto) => `mailto:${encodeURIComponent(mail || "").replace("%40", "@")}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(texto)}`;

  g.Salidas = { telWA, viajesDe, fixtureTexto, resumenConductor, ics, waLink, waGrupo, mailLink, fechaL };
})(globalThis);
