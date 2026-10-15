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

  let cargando = null;
  function cargar(clave) {
    if (!clave) return Promise.reject(new Error("Falta la clave de Google Maps en la app."));
    if (g.google && g.google.maps && g.google.maps.importLibrary) return Promise.resolve();
    return cargando || (cargando = new Promise((ok, ko) => {
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(clave)}&loading=async&v=weekly&language=es&region=AR`;
      s.async = true; s.onload = ok; s.onerror = () => { cargando = null; ko(new Error("No se pudo conectar con Google Maps.")); };
      document.head.appendChild(s);
    }));
  }

  const P = {
    clave: "",
    async buscar(texto, sesgo) {        // candidatos de lugar: [{id, nombre, dir, lat, lng}]
      await cargar(P.clave); contar("buscar");
      const { Place } = await g.google.maps.importLibrary("places");
      const req = { textQuery: texto, fields: ["id", "displayName", "formattedAddress", "location"], maxResultCount: 3, region: "ar", language: "es" };
      if (sesgo) req.locationBias = { center: { lat: sesgo.lat, lng: sesgo.lng }, radius: 50000 };
      const { places } = await Place.searchByText(req);
      return (places || []).map(p => ({ id: p.id, nombre: p.displayName, dir: p.formattedAddress, lat: p.location.lat(), lng: p.location.lng() }));
    },
    async montarMapa(div, centro, alMover) {   // mapa con pin movible; devuelve {get()}
      await cargar(P.clave); contar("mapa");
      const { Map } = await g.google.maps.importLibrary("maps");
      const { AdvancedMarkerElement } = await g.google.maps.importLibrary("marker");
      const c0 = centro || { lat: -34.5, lng: -58.5 };
      const mapa = new Map(div, { center: c0, zoom: centro ? 14 : 10, mapId: "DEMO_MAP_ID", gestureHandling: "greedy", streetViewControl: false, mapTypeControl: false });
      const pin = new AdvancedMarkerElement({ map: mapa, position: centro ? c0 : null, gmpDraggable: true });
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
        const { RouteMatrix } = await g.google.maps.importLibrary("routes");
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
