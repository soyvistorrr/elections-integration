/* ==========================================================================
   SISTEMA DE VOTACIONES USB 2025 - VERSIÓN "EVIDENCIA CSV"
   ==========================================================================
*/

const CONFIG = {
  // --- CREDENCIALES ---
  ID_RESULTADOS:          '1CNc-j0YrQdJDhjf0IxzAsEYfKNwfz1CySCcFJXO-ViU',
  ID_REGISTRO_SARTENEJAS: '11uE25RmubL_68IDu0dyabQOFMymoYPqx224D2PiJmuo',
  ID_REGISTRO_LITORAL:    '1tJNdVHX16ZCVn0AWgJNydQborVJ2__s3bwyFz1_2nsw',

  // --- HOJAS ---
  TAB_NAME_REGISTRO:   'Hoja 1',      
  TAB_NAME_RESULTADOS: 'RESULTADOS',  

  // --- COLUMNAS FORMULARIO ---
  COL_CARNET: 1,           
  COL_CODIGO_CARRERA: 5,   
  COL_YA_VOTO_SART: 10,    
  COL_YA_VOTO_LIT: 7,      

  // --- COLUMNAS RESULTADOS (BASADO EN TU CSV) ---
  COL_BUSQUEDA_TITULOS: 3, // Columna C: Donde dicen "0600 - Ing..."
  COL_BUSQUEDA_NOMBRES: 2, // Columna B: Donde dicen "PIC26", "Blanco"
  COL_CONTEO_DESTINO: 3,   // Columna C: Donde se pone el número

  COL_RES_CONTEO_INVALIDO: 11, // K

  KEY_CARNET: "CARNET",
  KEY_SEDE:   "SEDE",
  TXT_INVALIDOS: "Votos CE No Validos", 

  ANCHORS_LITORAL: ["CENTRO DE ESTUDIANTES DEL LITORAL", "SEDE DEL LITORAL", "LITORAL"],
  ANCHORS_FCE: ["JD-FCEUSB", "FEDERACION", "FCEUSB", "FCE"],

  MAPA_FCE: {
    "PRESIDENCIA": 3, "PRESI": 3, "GENERAL": 5, "GEN": 5,
    "SERVICIOS": 7, "SERV": 7, "ACADEMICA": 9, "ACAD": 9,
    "FINANZAS": 11, "FINAN": 11, "DEFAULT": 3
  },

  CODIGOS_FIX: { "4100": "0600", "200":  "0200" }
};

function onFormSubmit(e) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return; }

  try {
    const itemResponses = e.response ? e.response.getItemResponses() : [];
    if (!itemResponses.length) return;

    // --- 1. LECTURA ---
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

    // --- 2. VALIDACIÓN ---
    const idRegistro = esLitoral ? CONFIG.ID_REGISTRO_LITORAL : CONFIG.ID_REGISTRO_SARTENEJAS;
    const ssRegistro = SpreadsheetApp.openById(idRegistro);
    let sheetRegistro = ssRegistro.getSheetByName(CONFIG.TAB_NAME_REGISTRO);
    if (!sheetRegistro) sheetRegistro = ssRegistro.getSheets()[0];

    const filaUsuario = buscarUsuarioManual(sheetRegistro, carnetInput);
    if (filaUsuario === -1) { Logger.log("Carnet no encontrado"); return; }

    const colYaVoto = esLitoral ? CONFIG.COL_YA_VOTO_LIT : CONFIG.COL_YA_VOTO_SART;
    const celdaYaVoto = sheetRegistro.getRange(filaUsuario, colYaVoto);
    if (normalizeStr(celdaYaVoto.getValue()) === "SI") return;

    // --- 3. CARRERA ---
    let codigoCarrera = "";
    let puedeVotarCentro = true;

    if (esLitoral) {
      codigoCarrera = "LITORAL"; 
    } else {
      const rawCode = String(sheetRegistro.getRange(filaUsuario, CONFIG.COL_CODIGO_CARRERA).getValue());
      const codeClean = normalizeStr(rawCode);
      puedeVotarCentro = !(codeClean === "0" || codeClean === "00" || codeClean.includes("BASIC"));
      codigoCarrera = formatearCodigo(rawCode);
    }

    // --- 4. RESULTADOS ---
    const ssResultados = SpreadsheetApp.openById(CONFIG.ID_RESULTADOS);
    let sheetResultados = ssResultados.getSheetByName(CONFIG.TAB_NAME_RESULTADOS);
    if (!sheetResultados) sheetResultados = ssResultados.getSheets()[0];

    for (let i = 0; i < itemResponses.length; i++) {
      const item = itemResponses[i];
      const tituloRaw = item.getItem().getTitle();
      const tituloNorm = normalizeStr(tituloRaw);
      const respuesta = item.getResponse();

      if (!respuesta || tituloNorm.includes("CARNET") || tituloNorm.includes("CORREO") || tituloNorm.includes("NOMBRE") || tituloNorm === "SEDE") continue;

      const votoLimpio = limpiarVoto(respuesta);
      
      let tipo = "OTRO";
      if (tituloNorm.includes("LITORAL") && tituloNorm.includes("CENTRO")) tipo = "LITORAL";
      else if (tituloNorm.includes("FEDERACION") || tituloNorm.includes("FCE")) tipo = "FCE";
      else if (tituloNorm.includes("CENTRO") || tituloNorm.includes("VOTACION") || tituloNorm.includes("ELECCION")) tipo = "CENTRO";

      // A) FCE
      if (tipo === "FCE") {
        const colDestino = determinarColumnaFCE(tituloNorm);
        const bloqueFCE = encontrarBloque(sheetResultados, CONFIG.ANCHORS_FCE, CONFIG.COL_BUSQUEDA_TITULOS); // Busca título en C
        if (bloqueFCE) registrarVotoFCE(sheetResultados, bloqueFCE.getRow(), votoLimpio, colDestino);
      }

      // B) LITORAL
      else if (tipo === "LITORAL" && esLitoral) {
        // Busca título en Columna C
        const bloqueLit = encontrarBloque(sheetResultados, CONFIG.ANCHORS_LITORAL, CONFIG.COL_BUSQUEDA_TITULOS);
        if (bloqueLit) registrarVotoCentro(sheetResultados, bloqueLit.getRow(), votoLimpio);
      }

      // C) CENTRO SARTENEJAS
      else if (tipo === "CENTRO" && !esLitoral) {
        if (puedeVotarCentro) {
          // Busca código en Columna C
          const bloqueCentro = encontrarBloquePorCodigo(sheetResultados, codigoCarrera, CONFIG.COL_BUSQUEDA_TITULOS);
          
          if (bloqueCentro) {
            registrarVotoCentro(sheetResultados, bloqueCentro.getRow(), votoLimpio);
          } else {
            Logger.log(`[ALERTA] Bloque Carrera '${codigoCarrera}' no encontrado en Columna C.`);
          }
        } else {
          registrarInvalido(sheetResultados);
        }
      }
    }

    celdaYaVoto.setValue("SI");
    SpreadsheetApp.flush();

  } catch (err) {
    Logger.log("[ERROR] " + err.toString());
  } finally {
    lock.releaseLock();
  }
}

/* ==========================================
   LÓGICA ADAPTADA AL CSV
   ========================================== */

function registrarVotoCentro(sheet, filaTitulo, nombreCandidato) {
  // Buscamos nombres en COLUMNA B (2), empezando una fila debajo del título
  const rangoNombres = sheet.getRange(filaTitulo + 1, CONFIG.COL_BUSQUEDA_NOMBRES, 15, 1);
  // Verificamos frenos en COLUMNA C (3)
  const rangoTitulos = sheet.getRange(filaTitulo + 1, CONFIG.COL_BUSQUEDA_TITULOS, 15, 1);
  
  const valsNombres = rangoNombres.getValues();
  const valsTitulos = rangoTitulos.getValues(); // Aquí miramos si hay texto (otro título)

  const buscado = normalizeStr(nombreCandidato);
  const esBlanco = buscado.includes("BLANCO");

  Logger.log(`   > Buscando '${nombreCandidato}' bajo fila ${filaTitulo}...`);

  for (let i = 0; i < 15; i++) {
    const nombreEnB = normalizeStr(valsNombres[i][0]);
    const tituloEnC = String(valsTitulos[i][0]).trim(); // Verificar si hay título nuevo

    // 1. FRENO:
    if (tituloEnC.length > 3 && (tituloEnC.includes("-") || tituloEnC.match(/\d/))) {
       // OJO: Ignoramos si es un número simple (porque podría ser un voto ya existente de otro candidato)
       // Solo frenamos si parece TEXTO de título.
       if (isNaN(tituloEnC)) { 
          Logger.log(`   [FRENO] Título detectado en Col C fila relativa ${i}: ${tituloEnC}`);
          break; 
       }
    }

    // 2. MATCH
    let match = false;
    if (esBlanco) {
      if (nombreEnB.includes("BLANCO")) match = true;
    } else {
      if (nombreEnB && (nombreEnB === buscado || nombreEnB.includes(buscado) || buscado.includes(nombreEnB))) {
        match = true;
      }
    }

    if (match) {
      // Escribir en Columna C (CONFIG.COL_CONTEO_DESTINO), misma fila
      const celda = sheet.getRange(filaTitulo + 1 + i, CONFIG.COL_CONTEO_DESTINO);
      const val = Number(celda.getValue()) || 0;
      celda.setValue(val + 1);
      Logger.log(`   [OK] Voto sumado en Col C, fila ${filaTitulo + 1 + i}`);
      return;
    }
  }
  Logger.log(`   [ERROR] No se encontró '${nombreCandidato}' en el bloque.`);
}

// Función específica para FCE porque sus columnas de destino varían
function registrarVotoFCE(sheet, filaTitulo, nombreCandidato, colDestino) {
  const rangoNombres = sheet.getRange(filaTitulo + 1, CONFIG.COL_BUSQUEDA_NOMBRES, 20, 1); // Nombres en B
  const vals = rangoNombres.getValues();
  const buscado = normalizeStr(nombreCandidato);

  for (let i = 0; i < vals.length; i++) {
    const leido = normalizeStr(vals[i][0]);
    // Freno simple por vacío
    if (leido === "" && i > 2 && normalizeStr(vals[i+1][0]) === "") break;

    if (leido && (leido === buscado || leido.includes(buscado) || buscado.includes(leido))) {
      const celda = sheet.getRange(filaTitulo + 1 + i, colDestino);
      celda.setValue((Number(celda.getValue()) || 0) + 1);
      return;
    }
  }
}

// --- UTILIDADES ---
function formatearCodigo(raw) {
  let s = String(raw || "").trim().toUpperCase();
  if (CONFIG.CODIGOS_FIX[s]) return CONFIG.CODIGOS_FIX[s];
  let nums = s.match(/\d+/g);
  let code = nums ? nums.join('') : "";
  if (CONFIG.CODIGOS_FIX[code]) return CONFIG.CODIGOS_FIX[code];
  if (/^0?50[0-9]/.test(code)) return "050X";
  if (code.length > 0 && code.length < 4) code = code.padStart(4, '0');
  return code;
}

function limpiarVoto(votoRaw) {
  const v = String(votoRaw || "").trim();
  let vLimpio = v.replace(/^PLANCHA[\s:\-]+/i, ""); 
  const vNorm = normalizeStr(vLimpio);
  if (vNorm.includes("BLANCO")) return "Blanco";
  const parenMatch = v.match(/\((?:\s*Plancha\s*[:\-]?\s*)?(.+?)\s*\)/i);
  if (parenMatch && parenMatch[1].length > 1) return normalizeStr(parenMatch[1]);
  return vNorm;
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

function encontrarBloque(sheet, variantes, colIndex) {
  const lastRow = sheet.getLastRow();
  const values = sheet.getRange(1, colIndex, lastRow, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    const valCelda = normalizeStr(values[i][0]);
    if (!valCelda) continue;
    for (const variante of variantes) {
      if (valCelda.includes(normalizeStr(variante))) return sheet.getRange(i + 1, colIndex);
    }
  }
  return null;
}

function encontrarBloquePorCodigo(sheet, codigo, colIndex) {
  if (!codigo) return null;
  const values = sheet.getRange(1, colIndex, sheet.getLastRow(), 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]).toUpperCase().includes(codigo)) {
      return sheet.getRange(i + 1, colIndex);
    }
  }
  return null;
}

function determinarColumnaFCE(titulo) {
  const t = normalizeStr(titulo);
  for (let key in CONFIG.MAPA_FCE) {
    if (key !== "DEFAULT" && t.includes(normalizeStr(key))) return CONFIG.MAPA_FCE[key];
  }
  return CONFIG.MAPA_FCE.DEFAULT;
}

function registrarInvalido(sheet) {
  // Busca texto exacto en cualquier lado de Col C
  const finder = sheet.getRange(1, CONFIG.COL_BUSQUEDA_TITULOS, sheet.getLastRow(), 1).createTextFinder(CONFIG.TXT_INVALIDOS);
  const match = finder.findNext();
  if (match) {
    const celda = sheet.getRange(match.getRow(), CONFIG.COL_RES_CONTEO_INVALIDO);
    celda.setValue((Number(celda.getValue()) || 0) + 1);
  }
}

function normalizeStr(val) {
  if (!val) return "";
  return String(val).toUpperCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}
