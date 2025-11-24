/* ==========================================================================
   SISTEMA DE VOTACIONES USB 2025
   ==========================================================================
 */

const CONFIG = {
  ID_RESULTADOS:          '1CNc-j0YrQdJDhjf0IxzAsEYfKNwfz1CySCcFJXO-ViU',
  ID_REGISTRO_SARTENEJAS: '11uE25RmubL_68IDu0dyabQOFMymoYPqx224D2PiJmuo',
  ID_REGISTRO_LITORAL:    '1tJNdVHX16ZCVn0AWgJNydQborVJ2__s3bwyFz1_2nsw',

  TAB_NAME_REGISTRO:   'Hoja 1',      
  TAB_NAME_RESULTADOS: 'RESULTADOS',  

  // --- CONFIGURACIÓN DE COLUMNAS (DOBLE CHEQUEO) ---
  COL_CARNET: 1,           // A
  COL_CHECK_BASICO: 5,     // E <--- FILTRO DE SEGURIDAD (¿Es básico?)
  COL_CODIGO_CARRERA: 9,   // I <--- CÓDIGO REAL (¿Qué carrera le toca?)
  
  COL_YA_VOTO_SART: 10,    // J
  COL_YA_VOTO_LIT: 7,      // G

  // --- ESTRUCTURA DE RESULTADOS ---
  COL_BUSQUEDA_TITULOS: 3, // Columna C (Títulos y Conteos)
  COL_BUSQUEDA_NOMBRES: 2, // Columna B (Nombres)
  COL_CONTEO_DESTINO: 3,   // Columna C (Suma)

  COL_RES_CONTEO_INVALIDO: 11, // K

  KEY_CARNET: "CARNET",
  KEY_SEDE:   "SEDE",
  TXT_INVALIDOS: "Votos CE No Validos", 

  ANCHORS_LITORAL: [
    "CENTRO DE ESTUDIANTES DEL LITORAL", 
    "SEDE DEL LITORAL", 
    "LITORAL",
    "CAMINO AMARILLO"
  ],
  
  ANCHORS_FCE: ["JD-FCEUSB", "FEDERACION", "FCEUSB", "FCE"],

  MAPA_FCE: {
    "PRESIDENCIA": 3, "PRESI": 3, "GENERAL": 5, "GEN": 5,
    "SERVICIOS": 7, "SERV": 7, "ACADEMICA": 9, "ACAD": 9,
    "FINANZAS": 11, "FINAN": 11, "DEFAULT": 3
  }
};

function onFormSubmit(e) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return; }

  try {
    const itemResponses = e.response ? e.response.getItemResponses() : [];
    if (!itemResponses.length) return;

    // --- 1. DATOS ---
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

    // --- 2. REGISTRO ---
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

    // --- 3. LÓGICA DE SEGURIDAD ---
    let codigoCarrera = "";
    let puedeVotarCentro = true;

    if (esLitoral) {
      codigoCarrera = "LITORAL"; 
    } else {
      // A) PASO 1: VERIFICAR SI ES BÁSICO EN COLUMNA E (5)
      const valorBasico = String(sheetRegistro.getRange(filaUsuario, CONFIG.COL_CHECK_BASICO).getValue());
      const basicoClean = normalizeStr(valorBasico);

      // Si Col E es "0", "00" o "BASIC", es básico y NO debe votar centro
      const esBasico = (basicoClean === "0" || basicoClean === "00" || basicoClean.includes("BASIC") || basicoClean.includes("CICLO"));

      if (esBasico) {
         puedeVotarCentro = false; // BLOQUEADO
         Logger.log(`[SEGURIDAD] Estudiante detectado como Ciclo Básico (Col E="${valorBasico}"). Voto de carrera deshabilitado.`);
      } else {
         // B) PASO 2: SI NO ES BÁSICO, LEER LA CARRERA REAL EN COLUMNA I (9)
         const rawCode = String(sheetRegistro.getRange(filaUsuario, CONFIG.COL_CODIGO_CARRERA).getValue());
         codigoCarrera = formatearCodigoInteligente(rawCode);
         puedeVotarCentro = true; // HABILITADO
         Logger.log(`[OK] Estudiante de Carrera. Código asignado (Col I): ${rawCode} -> ${codigoCarrera}`);
      }
    }

    // --- 4. PROCESAR ---
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

      // 1. VOTO FCE (Todos votan)
      if (tipo === "FCE") {
        const colDestino = determinarColumnaFCE(tituloNorm);
        const bloqueFCE = encontrarBloque(sheetResultados, CONFIG.ANCHORS_FCE, CONFIG.COL_BUSQUEDA_TITULOS); 
        if (bloqueFCE) registrarVotoFCE(sheetResultados, bloqueFCE.getRow(), votoLimpio, colDestino);
      }
      
      // 2. VOTO LITORAL (Solo sede Litoral)
      else if (tipo === "LITORAL" && esLitoral) {
        const bloqueLit = encontrarBloque(sheetResultados, CONFIG.ANCHORS_LITORAL, CONFIG.COL_BUSQUEDA_TITULOS);
        if (bloqueLit) registrarVotoCentro(sheetResultados, bloqueLit.getRow(), votoLimpio);
      }
      
      // 3. VOTO SARTENEJAS (Solo si paso la seguridad de Básico)
      else if (tipo === "CENTRO" && !esLitoral) {
        if (puedeVotarCentro) {
          const bloqueCentro = encontrarBloquePorCodigo(sheetResultados, codigoCarrera, CONFIG.COL_BUSQUEDA_TITULOS);
          if (bloqueCentro) {
            registrarVotoCentro(sheetResultados, bloqueCentro.getRow(), votoLimpio);
          } else {
            Logger.log(`[ALERTA] No se encontró bloque para el código '${codigoCarrera}'.`);
          }
        } else {
          Logger.log(`[INFO] Intento de voto de Ciclo Básico en Carrera. Registrando como inválido.`);
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
   FUNCIONES AUXILIARES
   ========================================== */

function registrarVotoCentro(sheet, filaTitulo, nombreCandidato) {
  const rangoNombres = sheet.getRange(filaTitulo + 1, CONFIG.COL_BUSQUEDA_NOMBRES, 20, 1);
  const rangoTitulos = sheet.getRange(filaTitulo + 1, CONFIG.COL_BUSQUEDA_TITULOS, 20, 1);
  
  const valsNombres = rangoNombres.getValues();
  const valsTitulos = rangoTitulos.getValues(); 

  const buscado = normalizeStr(nombreCandidato);
  const esBlanco = buscado.includes("BLANCO");

  for (let i = 0; i < 20; i++) {
    const nombreEnB = normalizeStr(valsNombres[i][0]);
    const celdaC = valsTitulos[i][0];
    const strC = String(celdaC).trim();

    // FRENO INTELIGENTE (Ignora números de votos previos)
    const esNumero = !isNaN(parseFloat(celdaC)) && isFinite(celdaC);
    const esTituloLargo = strC.length > 5 && (strC.includes("INGENIERIA") || strC.includes("LICENCIATURA") || strC.includes("TSU") || strC.includes("ARQUITECTURA"));
    const esCodigo = strC.includes("-") && /\d/.test(strC) && strC.length > 5;

    if (!esNumero && (esTituloLargo || esCodigo)) break; 

    let match = false;
    if (esBlanco) {
      if (nombreEnB.includes("BLANCO")) match = true;
    } else {
      if (nombreEnB && (nombreEnB === buscado || nombreEnB.includes(buscado) || buscado.includes(nombreEnB))) {
        match = true;
      }
    }

    if (match) {
      const celda = sheet.getRange(filaTitulo + 1 + i, CONFIG.COL_CONTEO_DESTINO);
      const val = Number(celda.getValue()) || 0;
      celda.setValue(val + 1);
      return;
    }
  }
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

function registrarVotoFCE(sheet, filaTitulo, nombreCandidato, colDestino) {
  const rangoNombres = sheet.getRange(filaTitulo + 1, CONFIG.COL_BUSQUEDA_NOMBRES, 25, 1); 
  const vals = rangoNombres.getValues();
  const buscado = normalizeStr(nombreCandidato);
  for (let i = 0; i < vals.length; i++) {
    const leido = normalizeStr(vals[i][0]);
    if (leido === "" && i > 2 && normalizeStr(vals[i+1][0]) === "") break;
    if (leido && (leido === buscado || leido.includes(buscado) || buscado.includes(leido))) {
      const celda = sheet.getRange(filaTitulo + 1 + i, colDestino);
      celda.setValue((Number(celda.getValue()) || 0) + 1);
      return;
    }
  }
}

function determinarColumnaFCE(titulo) {
  const t = normalizeStr(titulo);
  for (let key in CONFIG.MAPA_FCE) {
    if (key !== "DEFAULT" && t.includes(normalizeStr(key))) return CONFIG.MAPA_FCE[key];
  }
  return CONFIG.MAPA_FCE.DEFAULT;
}

function registrarInvalido(sheet) {
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
