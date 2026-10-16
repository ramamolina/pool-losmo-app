/* Google Maps para Pool LosMo: mapa con pin, búsqueda de canchas y distancias en auto.
   Todo pasa por este archivo; la pantalla solo llama a Mapas.* (así se puede probar con respuestas simuladas).
   Cuidado del gasto: el tope diario propio de la app (TOPE) se suma a los límites que se ponen en Google Cloud. */
(function (g) {
  const TOPE = { buscar: 60, matriz: 20, mapa: 40 };   // consultas por día en este navegador
  const hoy = () => new Date().toISOString().slice(0, 10);
  function contar(tipo) {
    let est = {}; try { est = JSON.parse(localStorage.getItem("poollosmo.gasto") || "{}"); } catch (e) {}
    if (est.dia !== hoy()) est = { dia: hoy() };
    if ((est[tipo] || 0) >= TOPE[tipo]) throw new Error(`Se alcanzó el tope diario de la app para "${tipo}" (${TOPE[tipo]}). Probá mañana o cargá los datos a mano.`);
    est[tipo] = (est[tipo] || 0) + 1; try { localStorage.setItem("poollosmo.gasto", JSON.stringify(est)); } catch (e) {}
  }

  const dormir = ms => new Promise(r => setTimeout(r, ms));
  let cargando = null;
  function cargarUnaVez(clave) {
    return new Promise((ok, ko) => {
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(clave)}&loading=async&v=weekly&language=es&region=AR`;
      g.gm_authFailure = () => { P.error = "Google rechazó la clave. Revisá en Google Cloud que la clave permita el sitio https://ramamolina.github.io/* y las 3 APIs (Maps JavaScript, Places New, Routes), y que la facturación esté activa."; P.alError && P.alError(P.error); };
      s.async = true; s.onload = ok; s.onerror = () => { s.remove(); ko(new Error("No se pudo conectar con Google Maps.")); };
      document.head.appendChild(s);
    });
  }
  function cargar(clave) {
    if (!clave) return Promise.reject(new Error("Falta la clave de Google Maps en la app."));
    if (g.google && g.google.maps && g.google.maps.importLibrary) return Promise.resolve();
    return cargando || (cargando = (async () => {
      let ultimo;
      for (let i = 0; i < 3; i++) {                    // a veces la primera conexión falla y la segunda anda: se reintenta sola
        try {
          await cargarUnaVez(clave);
          for (let k = 0; k < 50 && !(g.google && g.google.maps && g.google.maps.importLibrary); k++) await dormir(100);   // espera a que Google termine de armarse
          if (g.google && g.google.maps && g.google.maps.importLibrary) return;
          ultimo = new Error("Google Maps tardó en iniciar.");
        } catch (e) { ultimo = e; }
        await dormir(700 * (i + 1));
      }
      cargando = null; throw ultimo;
    })());
  }
  async function lib(nombre) {                         // importLibrary con reintentos
    let ultimo;
    for (let i = 0; i < 3; i++) { try { return await g.google.maps.importLibrary(nombre); } catch (e) { ultimo = e; await dormir(600 * (i + 1)); } }
    throw ultimo;
  }

  const P = {
    clave: "", error: "", alError: null,
    async buscar(texto, sesgo) {        // candidatos de lugar: [{id, nombre, dir, lat, lng}]
      await cargar(P.clave); contar("buscar");
      const { Place } = await lib("places");
      const req = { textQuery: texto, fields: ["id", "displayName", "formattedAddress", "location"], maxResultCount: 3, region: "ar", language: "es" };
      if (sesgo) req.locationBias = { center: { lat: sesgo.lat, lng: sesgo.lng }, radius: 50000 };
      const { places } = await Place.searchByText(req);
      return (places || []).map(p => ({ id: p.id, nombre: p.displayName, dir: p.formattedAddress, lat: p.location.lat(), lng: p.location.lng() }));
    },
    async referencia(ll) {              // nombre de lugar cercano + localidad + partido: "Cerca de X · Localidad, Partido"
      await cargar(P.clave); contar("buscar");
      const { Place } = await lib("places");
      const { places } = await Place.searchNearby({ fields: ["displayName", "formattedAddress", "addressComponents"],
        locationRestriction: { center: { lat: ll.lat, lng: ll.lng }, radius: 300 }, maxResultCount: 1, rankPreference: "DISTANCE", language: "es", region: "ar" });
      const p = (places || [])[0]; if (!p) return "";
      const comp = t => { const c = (p.addressComponents || []).find(c => (c.types || []).includes(t)); return c ? (c.longText || c.long_name || "") : ""; };
      const loc = comp("locality") || comp("sublocality") || comp("sublocality_level_1") || comp("neighborhood");
      const par = comp("administrative_area_level_2");
      const zona = [loc, par && par !== loc ? par : ""].filter(Boolean).join(", ");
      return [p.displayName ? "Cerca de " + p.displayName : "", zona].filter(Boolean).join(" · ");
    },
    async montarMapa(div, centro, alMover) {   // mapa con pin movible; devuelve {get()}
      await cargar(P.clave); contar("mapa");
      const { Map } = await lib("maps");
      const { AdvancedMarkerElement } = await lib("marker");
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));   // que el cuadro ya tenga tamaño
      const c0 = centro || { lat: -34.5, lng: -58.5 };
      const mapa = new Map(div, { center: c0, zoom: centro ? 14 : 10, mapId: "DEMO_MAP_ID", gestureHandling: "greedy", streetViewControl: false, mapTypeControl: false });
      const pin = new AdvancedMarkerElement({ map: mapa, position: centro ? c0 : null, gmpDraggable: true });
      g.google.maps.event.addListenerOnce(mapa, "idle", () => { g.google.maps.event.trigger(mapa, "resize"); mapa.setCenter(c0); });
      const poner = ll => { pin.position = ll; alMover && alMover({ lat: ll.lat, lng: ll.lng }); };
      mapa.addListener("click", e => poner({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
      pin.addListener("dragend", () => { const p = pin.position; poner({ lat: p.lat, lng: p.lng }); });
      return { get: () => (pin.position ? { lat: +pin.position.lat, lng: +pin.position.lng } : null),
               ir: ll => { mapa.setCenter(ll); mapa.setZoom(15); poner(ll); } };
    },
    async matriz(origen, destinos) {    // km de ida (ruta más rápida) del origen a cada destino: [km|null]
      const out = [];
      for (let i = 0; i < destinos.length; i += 25) {
        const lote = destinos.slice(i, i + 25);
        await cargar(P.clave); contar("matriz");
        const { RouteMatrix } = await lib("routes");
        const { matrix } = await RouteMatrix.computeRouteMatrix({
          origins: [{ lat: origen.lat, lng: origen.lng }], destinations: lote.map(d => ({ lat: d.lat, lng: d.lng })),
          travelMode: "DRIVING", fields: ["originIndex", "destinationIndex", "distanceMeters", "condition"] });
        const km = new Array(lote.length).fill(null);
        matrix.rows[0].items.forEach((it, k) => { const j = it.destinationIndex ?? k; if (it.distanceMeters != null) km[j] = it.distanceMeters / 1000; });
        out.push(...km);
      }
      return out;
    },
  };
  g.Mapas = P;
})(globalThis);
