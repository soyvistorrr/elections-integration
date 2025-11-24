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

  // --- CONFIGURACIÓN DE COLUMNAS ---
  COL_CARNET: 1,           // A
  COL_CHECK_BASICO: 5,     // E (Filtro seguridad)
  COL_CODIGO_CARRERA: 9,   // I (Código real)
  
  COL_YA_VOTO_SART: 10,    // J
  COL_YA_VOTO_LIT: 7,      // G

  // --- RESULTADOS ---
  COL_BUSQUEDA_TITULOS: 3, // Columna C
  COL_BUSQUEDA_NOMBRES: 2, // Columna B
  COL_CONTEO_DESTINO: 3,   // Columna C (Donde se suman los votos normales)
  
  // --- CONFIGURACIÓN INVALIDOS (SEGÚN TUS INSTRUCCIONES) ---
  COL_BUSQUEDA_INVALIDOS: 9, // Columna I (Donde está el título "Votos CE No Validos...")
  COL_CONTEO_INVALIDOS: 11,  // Columna K (Donde se suman los numeritos)
  TXT_INVALIDOS_PARCIAL: "Votos CE No Validos", // Texto clave a buscar

  KEY_CARNET: "CARNET",
  KEY_SEDE:   "SEDE",

  // --- ANCLAJES ---
  ANCHORS_LITORAL: [
    "CE SEDE DEL LITORAL",
    "CENTRO DE ESTUDIANTES DE LA SEDE DEL LITORAL", 
    "LITORAL",
    "SEDE DEL LITORAL"
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

    // --- 3. LÓGICA DE SEGURIDAD (BÁSICO VS CARRERA) ---
    let codigoCarrera = "";
    let puedeVotarCentro = true;

    if (!esLitoral) {
      // 3.1. VERIFICAR BÁSICO (COL E)
      const valorBasico = String(sheetRegistro.getRange(filaUsuario, CONFIG.COL_CHECK_BASICO).getValue());
      const basicoClean = normalizeStr(valorBasico);
      const esBasico = (basicoClean === "0" || basicoClean === "00" || basicoClean.includes("BASIC") || basicoClean.includes("CICLO"));

      if (esBasico) {
         puedeVotarCentro = false; 
         Logger.log(`[SEGURIDAD] Usuario de Ciclo Básico detectado.`);
      } else {
         // 3.2. OBTENER CARRERA (COL I)
         const rawCode = String(sheetRegistro.getRange(filaUsuario, CONFIG.COL_CODIGO_CARRERA).getValue());
         codigoCarrera = formatearCodigoInteligente(rawCode);
         puedeVotarCentro = true; 
      }
    }

    // --- 4. PROCESAMIENTO DE VOTOS ---
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
      // DETECCIÓN LITORAL: Si dice Litoral y es una votación
      if (tituloNorm.includes("LITORAL") && (tituloNorm.includes("CENTRO") || tituloNorm.includes("ESTUDIANTES") || tituloNorm.includes("VOTACION"))) {
        tipo = "LITORAL";
      }
      else if (tituloNorm.includes("FEDERACION") || tituloNorm.includes("FCE")) tipo = "FCE";
      else if (tituloNorm.includes("CENTRO") || tituloNorm.includes("VOTACION") || tituloNorm.includes("ELECCION")) tipo = "CENTRO";

      // A) FCE
      if (tipo === "FCE") {
        const colDestino = determinarColumnaFCE(tituloNorm);
        const bloqueFCE = buscarBloqueEnCualquierColumna(sheetResultados, CONFIG.ANCHORS_FCE, [3]); 
        if (bloqueFCE > 0) registrarVotoFCE(sheetResultados, bloqueFCE, votoLimpio, colDestino);
      }
      
      // B) LITORAL
      else if (tipo === "LITORAL") {
        // Busca título en Columna 2 (B) o 3 (C)
        const filaLit = buscarBloqueEnCualquierColumna(sheetResultados, CONFIG.ANCHORS_LITORAL, [2, 3]);
        
        if (filaLit > 0) {
          registrarVotoCentro(sheetResultados, filaLit, votoLimpio);
        } else {
          Logger.log("[ERROR CRÍTICO] Título 'CE SEDE DEL LITORAL' no encontrado en Excel.");
        }
      }
      
      // C) CENTRO SARTENEJAS
      else if (tipo === "CENTRO" && !esLitoral) {
        if (puedeVotarCentro) {
          // Busca código (ej: 0600) en Columna C
          const filaCentro = buscarBloqueEnCualquierColumna(sheetResultados, [codigoCarrera], [3]);
          
          if (filaCentro > 0) {
            registrarVotoCentro(sheetResultados, filaCentro, votoLimpio);
          } else {
            // ERROR: TIENE CARRERA PERO NO ENCUENTRO EL BLOQUE -> INVÁLIDO
            Logger.log(`[ERROR] Bloque '${codigoCarrera}' no existe en Resultados. Registrando como inválido.`);
            registrarInvalido(sheetResultados);
          }
        } else {
          // ERROR: ES CICLO BÁSICO -> INVÁLIDO
          Logger.log(`[INFO] Voto de Ciclo Básico rechazado. Sumando a inválidos.`);
          registrarInvalido(sheetResultados);
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

function registrarVotoCentro(sheet, filaTitulo, nombreCandidato) {
  // ESCÁNER DE 20 FILAS
  const rangoNombres = sheet.getRange(filaTitulo + 1, CONFIG.COL_BUSQUEDA_NOMBRES, 20, 1);
  const rangoTitulos = sheet.getRange(filaTitulo + 1, CONFIG.COL_BUSQUEDA_TITULOS, 20, 1);
  
  const valsNombres = rangoNombres.getValues();
  const valsTitulos = rangoTitulos.getValues(); 

  const buscado = normalizeStr(nombreCandidato);
  const esBlanco = buscado.includes("BLANCO");

  Logger.log(`--- INTENTANDO SUMAR: '${nombreCandidato}' DESDE FILA ${filaTitulo} ---`);

  for (let i = 0; i < 20; i++) {
    const nombreEnB = normalizeStr(valsNombres[i][0]);
    const celdaC = valsTitulos[i][0];
    const strC = String(celdaC).trim();

    // FRENO INTELIGENTE:
    const esNumero = !isNaN(parseFloat(celdaC)) && isFinite(celdaC);
    const esTituloLargo = strC.length > 5 && (strC.includes("INGENIERIA") || strC.includes("LICENCIATURA") || strC.includes("ARQUITECTURA") || strC.includes("TOTALES") || strC.includes("CODIGO"));
    const esCodigo = strC.includes("-") && /\d/.test(strC) && strC.length > 5;

    // Solo frenamos si NO es un número y parece un título
    if (!esNumero && (esTituloLargo || esCodigo)) {
       Logger.log(`[FRENO] Me detuve en la fila relativa ${i} porque vi: '${strC}'`);
       break; 
    }

    let match = false;
    if (esBlanco) {
      if (nombreEnB.includes("BLANCO")) match = true;
    } else {
      if (nombreEnB && (nombreEnB.includes(buscado) || buscado.includes(nombreEnB))) {
        match = true;
      }
    }

    if (match) {
      const celda = sheet.getRange(filaTitulo + 1 + i, CONFIG.COL_CONTEO_DESTINO);
      const val = Number(celda.getValue()) || 0;
      celda.setValue(val + 1);
      Logger.log(`[EXITO] Voto sumado en fila ${filaTitulo + 1 + i}`);
      return;
    }
  }
  Logger.log(`[FALLO] Recorrí 20 filas y no encontré coincidencia para: ${nombreCandidato}`);
}

function registrarInvalido(sheet) {
  // 1. Buscar en Columna I (9) el texto "Votos CE No Validos"
  const rangoBusqueda = sheet.getRange(1, CONFIG.COL_BUSQUEDA_INVALIDOS, sheet.getLastRow(), 1);
  const finder = rangoBusqueda.createTextFinder(CONFIG.TXT_INVALIDOS_PARCIAL);
  const match = finder.findNext();
  
  if (match) {
    const fila = match.getRow();
    // 2. Sumar en Columna K (11) de esa misma fila
    const celdaConteo = sheet.getRange(fila, CONFIG.COL_CONTEO_INVALIDOS);
    const valor = Number(celdaConteo.getValue()) || 0;
    celdaConteo.setValue(valor + 1);
    Logger.log(`[INVALIDO] Se sumó +1 a 'Votos CE No Validos' en Fila ${fila}, Columna K.`);
  } else {
    Logger.log(`[ERROR CRÍTICO] No encontré la celda '${CONFIG.TXT_INVALIDOS_PARCIAL}' en la Columna I.`);
  }
}

/* ==========================================
   UTILIDADES
   ========================================== */

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

function registrarVotoFCE(sheet, filaTitulo, nombreCandidato, colDestino) {
  const rangoNombres = sheet.getRange(filaTitulo + 1, CONFIG.COL_BUSQUEDA_NOMBRES, 25, 1); 
  const vals = rangoNombres.getValues();
  const buscado = normalizeStr(nombreCandidato);
  for (let i = 0; i < vals.length; i++) {
    const leido = normalizeStr(vals[i][0]);
    if (leido === "" && i > 2 && normalizeStr(vals[i+1][0]) === "") break;
    if (leido && (leido.includes(buscado) || buscado.includes(leido))) {
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

function normalizeStr(val) {
  if (!val) return "";
  return String(val).toUpperCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}
