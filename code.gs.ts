/* ==========================================================================
   SISTEMA DE VOTACIONES USB 2025
   ========================================================================== */

const CONFIG = {
  ID_RESULTADOS:          '1CNc-j0YrQdJDhjf0IxzAsEYfKNwfz1CySCcFJXO-ViU',
  ID_REGISTRO_SARTENEJAS: '11uE25RmubL_68IDu0dyabQOFMymoYPqx224D2PiJmuo',
  ID_REGISTRO_LITORAL:    '1tJNdVHX16ZCVn0AWgJNydQborVJ2__s3bwyFz1_2nsw',

  TAB_NAME_REGISTRO:   'Hoja 1',      
  TAB_NAME_RESULTADOS: 'RESULTADOS',  

  COL_CARNET: 1,           // A
  COL_CHECK_BASICO: 5,     // E
  COL_CODIGO_CARRERA: 9,   // I
  
  COL_YA_VOTO_SART: 10,    // J
  COL_YA_VOTO_LIT: 7,      // G

  COL_BUSQUEDA_TITULOS: 3, // C
  COL_BUSQUEDA_NOMBRES: 2, // B
  COL_CONTEO_DESTINO: 3,   // C

  COL_BUSQUEDA_INVALIDOS: 9, // I
  COL_CONTEO_INVALIDOS: 11,  // K
  TXT_INVALIDOS_PARCIAL: "Votos CE No Validos",

  KEY_CARNET: "CARNET",
  KEY_SEDE:   "SEDE",

  CODIGOS_BASICO: ["0", "00", "BASIC", "CICLO", "42", "41", "40", "19", "16", "7"],
  CARRERAS_NOMINALES: ["0700", "1100", "1900"],

  ANCHORS_LITORAL: ["CE SEDE DEL LITORAL", "CENTRO DE ESTUDIANTES DE LA SEDE DEL LITORAL", "LITORAL", "SEDE DEL LITORAL"],
  ANCHORS_FCE: ["JD-FCEUSB", "FEDERACION", "FCEUSB", "FCE"],

  // --- MAPAS DE CARGOS ---
  MAPA_CARGOS_POR_CARRERA: {
    "0700": { // ARQUITECTURA
      "VICE": 5, "VICEPRESIDENCIA": 5, // Prioridad
      "PRESIDENCIA": 3, "PRESI": 3, 
      "GENERAL": 4, "GEN": 4,
      "TESORERIA": 6, "TESO": 6,
      "ACADEMICA": 7, "ACAD": 7,
      "CULTURA": 8, "CULT": 8,
      "SALA": 9, "SECRETARIA DE SALA": 9,
      "INFORMACION": 10, "INFO": 10
    },
    "1100": { // URBANISMO
      "PRESIDENTE": 3, "PRESI": 3, "PRESIDENCIA": 3,
      "GENERAL": 4, "GEN": 4,
      "TESORERIA": 5, "TESO": 5,
      "EXTENSION": 6, "EXT": 6,
      "CULTURA": 7, "CULT": 7
    },
    "1900": { // BIOLOGÍA
      "PRESIDENTE": 3, "PRESI": 3,
      "GENERAL": 4, "GEN": 4,
      "TESORERIA": 5, "TESO": 5,
      "COORDINACION": 6, "COORD": 6, "SALA": 6,
      "EVENTOS": 7
    },
    "DEFAULT": { // FEDERACIÓN
      "PRESIDENCIA": 3, "PRESI": 3,
      "GENERAL": 5, "GEN": 5,
      "SERVICIOS": 7, "SERV": 7,
      "ACADEMICA": 9, "ACAD": 9,
      "FINANZAS": 11, "FINAN": 11,
      "DEPORTES": 13, "DEPOR": 13
    }
  }
};

function onFormSubmit(e) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return; }

  try {
    const itemResponses = e.response ? e.response.getItemResponses() : [];
    if (!itemResponses.length) return;

    // 1. DATOS
    let carnetInput = "";
    let esLitoral = false;

    for (let i = 0; i < itemResponses.length; i++) {
      const t = normalizeStr(itemResponses[i].getItem().getTitle());
      const r = String(itemResponses[i].getResponse() || "").trim();
      if (t.includes(CONFIG.KEY_CARNET)) carnetInput = r.replace(/[^0-9]/g, "");
      if (t.includes(CONFIG.KEY_SEDE) && !t.includes("VOTACION")) {
        if (normalizeStr(r).includes("LITORAL")) esLitoral = true;
      }
    }

    if (!carnetInput) return;

    // 2. REGISTRO
    const idRegistro = esLitoral ? CONFIG.ID_REGISTRO_LITORAL : CONFIG.ID_REGISTRO_SARTENEJAS;
    const ssRegistro = SpreadsheetApp.openById(idRegistro);
    let sheetRegistro = ssRegistro.getSheetByName(CONFIG.TAB_NAME_REGISTRO);
    if (!sheetRegistro) sheetRegistro = ssRegistro.getSheets()[0];

    const filaUsuario = buscarUsuarioManual(sheetRegistro, carnetInput);
    if (filaUsuario === -1) { Logger.log("Carnet no encontrado"); return; }

    const colYaVoto = esLitoral ? CONFIG.COL_YA_VOTO_LIT : CONFIG.COL_YA_VOTO_SART;
    if (filaUsuario > sheetRegistro.getLastRow()) return;
    
    const celdaYaVoto = sheetRegistro.getRange(filaUsuario, colYaVoto);
    if (normalizeStr(celdaYaVoto.getValue()) === "SI") return;

    // 3. SEGURIDAD Y CARRERA
    let codigoCarrera = "";
    let puedeVotarCentro = true;

    if (!esLitoral) {
      const valorCelda = sheetRegistro.getRange(filaUsuario, CONFIG.COL_CHECK_BASICO).getValue();
      const valorBasico = String(valorCelda).trim();
      const basicoClean = normalizeStr(valorBasico);
      
      let esBasico = false;
      if (CONFIG.CODIGOS_BASICO.includes(valorBasico) || CONFIG.CODIGOS_BASICO.includes(basicoClean) || basicoClean.includes("BASIC") || basicoClean.includes("CICLO")) {
        esBasico = true;
      }

      if (esBasico) {
          puedeVotarCentro = false; 
          Logger.log(`[SEGURIDAD] Básico detectado (${valorBasico}).`);
      } else {
          const rawCode = String(sheetRegistro.getRange(filaUsuario, CONFIG.COL_CODIGO_CARRERA).getValue());
          codigoCarrera = formatearCodigoInteligente(rawCode);
          puedeVotarCentro = true; 
          Logger.log(`[INFO] Carrera detectada: ${rawCode} -> ${codigoCarrera}`);
      }
    }

    // 4. PROCESAMIENTO
    const ssResultados = SpreadsheetApp.openById(CONFIG.ID_RESULTADOS);
    let sheetResultados = ssResultados.getSheetByName(CONFIG.TAB_NAME_RESULTADOS);
    if (!sheetResultados) sheetResultados = ssResultados.getSheets()[0];
    let yaConteNuloCentro = false;

    for (let i = 0; i < itemResponses.length; i++) {
      const item = itemResponses[i];
      const tituloRaw = item.getItem().getTitle();
      const tituloNorm = normalizeStr(tituloRaw);
      const respuesta = item.getResponse();

      if (!respuesta || tituloNorm.includes("CARNET") || tituloNorm.includes("CORREO") || tituloNorm.includes("NOMBRE") || tituloNorm === "SEDE") continue;

      const votoLimpio = limpiarVoto(respuesta);
      
      let tipo = "OTRO";
      if (tituloNorm.includes("FEDERACION") || tituloNorm.includes("FCE")) tipo = "FCE";
      else if (tituloNorm.includes("CENTRO") || tituloNorm.includes("VOTACION") || tituloNorm.includes("ELECCION") ||
               tituloNorm.includes("CEARQ") || tituloNorm.includes("CEURB") || tituloNorm.includes("CEBIO")) {
        tipo = "CENTRO";
        if (tituloNorm.includes("LITORAL")) tipo = "LITORAL";
      }

      // A) FCE
      if (tipo === "FCE") {
        const colDestino = determinarColumnaDestino(tituloNorm, "DEFAULT");
        const bloqueFCE = buscarBloqueEnCualquierColumna(sheetResultados, CONFIG.ANCHORS_FCE, [3]); 
        if (bloqueFCE > 0) registrarVotoNominal(sheetResultados, bloqueFCE, votoLimpio, colDestino);
      }
      
      // B) LITORAL
      else if (tipo === "LITORAL") {
        const filaLit = buscarBloqueEnCualquierColumna(sheetResultados, CONFIG.ANCHORS_LITORAL, [2, 3]);
        if (filaLit > 0) {
          registrarVotoLitoralSinFrenos(sheetResultados, filaLit, votoLimpio);
        }
      }
      
      // C) CENTRO SARTENEJAS
      else if (tipo === "CENTRO" && !esLitoral) {
        if (puedeVotarCentro) {
          // BUSCA EL BLOQUE DE LA CARRERA
          const filaCentro = buscarBloqueEnCualquierColumna(sheetResultados, [codigoCarrera], [3]);
          
          if (filaCentro > 0) {
            // VERIFICA SI ES NOMINAL O PLANCHA
            if (CONFIG.CARRERAS_NOMINALES.includes(codigoCarrera)) {
               // --- MODO NOMINAL (CEARQ, CEURB, CEBIO) ---
               const colDestino = determinarColumnaDestino(tituloNorm, codigoCarrera); 
               registrarVotoNominal(sheetResultados, filaCentro, votoLimpio, colDestino);
               Logger.log(`[NOMINAL] ${codigoCarrera} voto sumado en columna ${colDestino}`);
            } else {
               // --- MODO PLANCHA ---
               registrarVotoCentro(sheetResultados, filaCentro, votoLimpio);
            }
          } else {
            // Si el bloque de carrera no existe, cuenta como inválido (solo una vez)
            if (!yaConteNuloCentro) {
               Logger.log(`[ERROR] Bloque '${codigoCarrera}' no encontrado.`);
               registrarInvalido(sheetResultados);
               yaConteNuloCentro = true;
            }
          }
        } else {
          if (!yaConteNuloCentro) {
             registrarInvalido(sheetResultados);
             yaConteNuloCentro = true; 
             Logger.log(`[INVALIDO] Voto de ciclo básico registrado una sola vez.`);
          }
        }
      }
    }

    celdaYaVoto.setValue("SI");
    SpreadsheetApp.flush();

  } catch (err) {
    Logger.log("[ERROR FATAL] " + err.toString());
  } finally {
    lock.releaseLock();
  }
}

/* ==========================================
   FUNCIONES DE REGISTRO
   ========================================== */

function registrarVotoNominal(sheet, filaTitulo, nombreCandidato, colDestino) {
  const rangoNombres = sheet.getRange(filaTitulo, CONFIG.COL_BUSQUEDA_NOMBRES, 30, 1); 
  const vals = rangoNombres.getValues();
  const buscado = normalizeStr(nombreCandidato);
  
  for (let i = 0; i < vals.length; i++) {
    const leido = normalizeStr(vals[i][0]);
    if (leido === "" && i > 2 && normalizeStr(vals[i+1][0]) === "") break;
    
    if (leido && (leido.includes(buscado) || buscado.includes(leido))) {
      const celda = sheet.getRange(filaTitulo + i, colDestino);
      const val = Number(celda.getValue()) || 0;
      celda.setValue(val + 1);
      return;
    }
  }
}

function registrarVotoLitoralSinFrenos(sheet, filaTitulo, nombreCandidato) {
  const rangoNombres = sheet.getRange(filaTitulo, CONFIG.COL_BUSQUEDA_NOMBRES, 20, 1);
  const valsNombres = rangoNombres.getValues();
  const buscado = normalizeStr(nombreCandidato);
  const esBlanco = buscado.includes("BLANCO");

  for (let i = 0; i < valsNombres.length; i++) {
    const nombreEnB = normalizeStr(valsNombres[i][0]);
    let match = false;
    if (esBlanco) { if (nombreEnB.includes("BLANCO")) match = true; }
    else { if (nombreEnB && (nombreEnB.includes(buscado) || buscado.includes(nombreEnB))) match = true; }

    if (match) {
      const celda = sheet.getRange(filaTitulo + i, CONFIG.COL_CONTEO_DESTINO);
      celda.setValue((Number(celda.getValue()) || 0) + 1);
      return;
    }
  }
}

function registrarVotoCentro(sheet, filaTitulo, nombreCandidato) {
  const rangoNombres = sheet.getRange(filaTitulo, CONFIG.COL_BUSQUEDA_NOMBRES, 20, 1);
  const rangoTitulos = sheet.getRange(filaTitulo, CONFIG.COL_BUSQUEDA_TITULOS, 20, 1);
  const valsNombres = rangoNombres.getValues();
  const valsTitulos = rangoTitulos.getValues(); 
  const buscado = normalizeStr(nombreCandidato);
  const esBlanco = buscado.includes("BLANCO");

  for (let i = 0; i < 20; i++) {
    const nombreEnB = normalizeStr(valsNombres[i][0]);
    const celdaC = valsTitulos[i][0];
    const strC = String(celdaC).trim();

    const esNumero = !isNaN(parseFloat(celdaC)) && isFinite(celdaC);
    const esTituloLargo = strC.length > 5 && (strC.includes("INGENIERIA") || strC.includes("LICENCIATURA") || strC.includes("ARQUITECTURA") || strC.includes("TOTALES") || strC.includes("CODIGO"));
    const esCodigo = strC.includes("-") && /\d/.test(strC) && strC.length > 5;

    if (i > 0 && !esNumero && (esTituloLargo || esCodigo)) break; 

    let match = false;
    if (esBlanco) { if (nombreEnB.includes("BLANCO")) match = true; }
    else { if (nombreEnB && (nombreEnB.includes(buscado) || buscado.includes(nombreEnB))) match = true; }

    if (match) {
      const celda = sheet.getRange(filaTitulo + i, CONFIG.COL_CONTEO_DESTINO);
      celda.setValue((Number(celda.getValue()) || 0) + 1);
      return;
    }
  }
}

function registrarInvalido(sheet) {
  const rangoBusqueda = sheet.getRange(1, CONFIG.COL_BUSQUEDA_INVALIDOS, sheet.getLastRow(), 1);
  const finder = rangoBusqueda.createTextFinder(CONFIG.TXT_INVALIDOS_PARCIAL);
  const match = finder.findNext();
  if (match) {
    const celda = sheet.getRange(match.getRow(), CONFIG.COL_CONTEO_INVALIDOS);
    celda.setValue((Number(celda.getValue()) || 0) + 1);
  }
}

/* ==========================================
   UTILIDADES
   ========================================== */

function determinarColumnaDestino(titulo, codigoCarrera) {
  const t = normalizeStr(titulo);
  const mapa = CONFIG.MAPA_CARGOS_POR_CARRERA[codigoCarrera] || CONFIG.MAPA_CARGOS_POR_CARRERA["DEFAULT"];
  
  // 1. PRIORIDAD: VICE (Evita conflicto con PRESI)
  if (t.includes("VICE")) {
    if (mapa["VICE"]) return mapa["VICE"];
    if (mapa["VICEPRESIDENCIA"]) return mapa["VICEPRESIDENCIA"];
  }
  // 2. PRIORIDAD: SALA (Evita conflicto con COORD)
  if (t.includes("SALA")) {
    if (mapa["SALA"]) return mapa["SALA"];
  }

  // 3. RESTO (BÚSQUEDA ESTÁNDAR)
  for (let key in mapa) {
    if (t.includes(normalizeStr(key))) return mapa[key];
  }
  return mapa["DEFAULT"] || 3;
}

function buscarBloqueEnCualquierColumna(sheet, textos, indicesColumnas) {
  for (let colIdx of indicesColumnas) {
    const rango = sheet.getRange(1, colIdx, sheet.getLastRow(), 1);
    for (let t of textos) {
      const finder = rango.createTextFinder(t).matchCase(false);
      const match = finder.findNext();
      if (match) return match.getRow();
    }
  }
  return -1;
}

function limpiarVoto(votoRaw) {
  const v = String(votoRaw || "").trim();
  let vLimpio = v.replace(/^(PLANCHA|VOTO|VOTACION)[\s:\-]+/i, ""); 
  const vNorm = normalizeStr(vLimpio);
  if (vNorm.includes("BLANCO")) return "Blanco";
  const parenMatch = v.match(/\((?:\s*Plancha\s*[:\-]?\s*)?(.+?)\s*\)/i);
  if (parenMatch && parenMatch[1].length > 1) return normalizeStr(parenMatch[1]);
  return vNorm;
}

function formatearCodigoInteligente(raw) {
  let s = String(raw || "").trim();
  let match = s.match(/\d+/);
  if (!match) return ""; 
  let code = match[0];
  
  if (code === "4100") return "0600"; 
  if (/^0?50\d/.test(code)) return "050X";
  
  return code.padStart(4, '0');
}

function buscarUsuarioManual(sheet, carnetBuscado) {
  const lastRow = sheet.getLastRow();
  const valores = sheet.getRange(1, CONFIG.COL_CARNET, lastRow, 1).getDisplayValues();
  for (let i = 0; i < valores.length; i++) {
    const carnetExcel = String(valores[i][0]).replace(/[^0-9]/g, "");
    if (carnetExcel === carnetBuscado) return i + 1; 
  }
  return -1;
}

function normalizeStr(val) {
  if (!val) return "";
  return String(val).toUpperCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}
