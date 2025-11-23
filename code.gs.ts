/**
 * ============================================================================
 * 1. CONFIGURACIÓN GENERAL (MODIFICAR SOLO ESTA SECCIÓN)
 * ============================================================================
 */
const CONFIG = {
  ID_RESULTADOS:          '1CNc-j0YrQdJDhjf0IxzAsEYfKNwfz1CySCcFJXO-ViU', // Excel Público (Resultados)
  ID_REGISTRO_SARTENEJAS: '11uE25RmubL_68IDu0dyabQOFMymoYPqx224D2PiJmuo', // Registro Privado Sartenejas
  ID_REGISTRO_LITORAL:    '1tJNdVHX16ZCVn0AWgJNydQborVJ2__s3bwyFz1_2nsw', // Registro Privado Litoral

  TAB_NAME_RESULTADOS: 'RESULTADOS', 
  TAB_NAME_REGISTRO:   'Hoja 1',     

  COL_CARNET: 1,
  COL_CODIGO_CARRERA: 5,
  COL_YA_VOTO: 9,

  COL_RES_NOMBRES: 2,      // Columna B: Donde están los nombres de candidatos
  COL_RES_CONTEO: 3,       // Columna C: Donde se suman los votos
  COL_RES_ANCLAJE: 6,      // Columna F: Donde están los códigos (- 0800 -)

  KEY_CARNET: "CARNET",
  KEY_SEDE:   "SEDE",      // Pregunta "¿A qué sede perteneces?"
  KEY_FED:    ["FEDERACIÓN", "FCE", "FCEUSB", "JD-FCEUSB"], 
  KEY_CENTRO: ["CENTRO", "VOTACIÓN", "CARRERA", "ELECCIÓN"], 

  HEADER_FCE:     "JD-FCEUSB",             // Título de la tabla Federación
  HEADER_LITORAL: "JD-CE Sede De Litoral", // Título exacto de la tabla de Litoral
};

/**
 * ============================================================================
 * 2. LÓGICA PRINCIPAL DEL SISTEMA
 * ============================================================================
 */
function onFormSubmit(e) {
  try {
    const itemResponses = e.response.getItemResponses();
    
    // --- PASO 1: LEER DATOS DEL ESTUDIANTE ---
    let carnet = "";
    let sede = "";

    for (let i = 0; i < itemResponses.length; i++) {
      const titulo = itemResponses[i].getItem().getTitle().toUpperCase();
      const respuesta = itemResponses[i].getResponse();

      if (titulo.includes(CONFIG.KEY_CARNET)) carnet = respuesta.trim();
      if (titulo.includes(CONFIG.KEY_SEDE))   sede = respuesta.toUpperCase();
    }

    if (!carnet) { Logger.log("[ERROR] Falta Carnet."); return; }
    if (!sede)   { sede = "SARTENEJAS"; Logger.log("[AVISO] Sede no detectada, asumiendo Sartenejas."); }

    Logger.log(`[PROCESANDO] Carnet: ${carnet} | Sede: ${sede}`);

    // --- PASO 2: ELEGIR EL REGISTRO ADECUADO ---
    let idRegistro = (sede.includes("LITORAL")) ? CONFIG.ID_REGISTRO_LITORAL : CONFIG.ID_REGISTRO_SARTENEJAS;
    let esLitoral = sede.includes("LITORAL");

    // --- PASO 3: VALIDAR AL ESTUDIANTE EN LA BASE DE DATOS ---
    const sheetReg = SpreadsheetApp.openById(idRegistro).getSheetByName(CONFIG.TAB_NAME_REGISTRO);

    const finder = sheetReg.getRange(1, CONFIG.COL_CARNET, sheetReg.getLastRow(), 1)
      .createTextFinder(carnet).matchEntireCell(true);
    const result = finder.findNext();

    if (!result) {
      Logger.log(`[RECHAZADO] Carnet ${carnet} no encontrado en registro de ${sede}.`);
      return;
    }

    const rowUser = result.getRow();

    const cellYaVoto = sheetReg.getRange(rowUser, CONFIG.COL_YA_VOTO);
    if (cellYaVoto.getValue() === "SI") {
      Logger.log(`[FRAUDE] El usuario ${carnet} ya votó.`);
      return;
    }

    let puedeVotarCentro = true;
    let codigoAnclaje = ""; 
    let columnaBusqueda = 0;

    if (esLitoral) {
        puedeVotarCentro = true;
        codigoAnclaje = CONFIG.HEADER_LITORAL;
        columnaBusqueda = CONFIG.COL_RES_NOMBRES; 
    } else {
        const rawCode = sheetReg.getRange(rowUser, CONFIG.COL_CODIGO_CARRERA).getValue().toString();
        let esBasico = (rawCode === "0" || rawCode === "00" || rawCode.toUpperCase().includes("BASIC"));
        puedeVotarCentro = !esBasico;
        codigoAnclaje = rawCode;
        columnaBusqueda = CONFIG.COL_RES_ANCLAJE;
    }

    // --- PASO 4: REGISTRAR EL VOTO ---
    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(10000)) { Logger.log("[ERROR] Servidor ocupado."); return; }

    try {
      // 1. Quemar el voto (Marcar SI)
      cellYaVoto.setValue("SI");

      // 2. Abrir Excel de Resultados
      const sheetRes = SpreadsheetApp.openById(CONFIG.ID_RESULTADOS).getSheetByName(CONFIG.TAB_NAME_RESULTADOS);

      for (let i = 0; i < itemResponses.length; i++) {
        const item = itemResponses[i];
        const titulo = item.getItem().getTitle().toUpperCase();
        const votoOriginal = item.getResponse();

        const votoLimpio = normalizarVoto(votoOriginal);

        // -> SI ES FEDERACIÓN
        if (containsAny(titulo, CONFIG.KEY_FED)) {
          smartVoteCount(sheetRes, CONFIG.HEADER_FCE, votoLimpio, CONFIG.COL_RES_NOMBRES, 25); 
        }

        // -> SI ES CENTRO DE ESTUDIANTES
        else if (containsAny(titulo, CONFIG.KEY_CENTRO)) {
          if (puedeVotarCentro) {
            smartVoteCount(sheetRes, codigoAnclaje, votoLimpio, columnaBusqueda, 60);
          }
        }
      }

      SpreadsheetApp.flush();
      Logger.log("[EXITO] Voto registrado correctamente.");

    } catch (e) {
      Logger.log("[CRITICO] Error escribiendo datos: " + e);
    } finally {
      lock.releaseLock();
    }

  } catch (error) {
    Logger.log("[FATAL] Error general: " + error);
  }
}

/**
 * ============================================================================
 * 3. FUNCIONES AUXILIARES (HERRAMIENTAS)
 * ============================================================================
 */

function normalizeVote(voto) {
  if (!voto) return "";
  if (voto.toUpperCase().includes("BLANCO")) return "Blanco";
  
  const matchFCE = voto.match(/\(Plancha (.*?)\)/); 
  if (matchFCE && matchFCE[1]) return matchFCE[1].trim();

  // Limpia "Plancha X" al inicio (Centros)
  if (voto.startsWith("Plancha ")) return voto.substring(8).trim(); 

  return voto.trim();
}

// Verifica palabras clave
function containsAny(str, keywords) {
  return keywords.some(key => str.includes(key));
}

function smartVoteCount(sheet, anchorText, candidateName, anchorColIndex, searchDepth) {
  if (!candidateName) return;

  // 1. Busca el TÍTULO DE SECCIÓN (Ancla)
  const finder = sheet.getRange(1, anchorColIndex, sheet.getLastRow(), 1)
    .createTextFinder(anchorText); 
  const anchorCell = finder.findNext();

  if (!anchorCell) {
    Logger.log(`[ALERTA] Bloque no encontrado: ${anchorText}`);
    return;
  }

  const startRow = anchorCell.getRow();
  
  // 2. Busca al CANDIDATO debajo
  const searchRange = sheet.getRange(startRow, CONFIG.COL_RES_NOMBRES, searchDepth, 1);
  const candidateFinder = searchRange.createTextFinder(candidateName).matchEntireCell(true);
  const candidateCell = candidateFinder.findNext();

  if (candidateCell) {
    // 3. Suma +1
    const cellCount = sheet.getRange(candidateCell.getRow(), CONFIG.COL_RES_CONTEO);
    const val = cellCount.getValue();
    cellCount.setValue((typeof val === 'number' ? val : 0) + 1);
    Logger.log(` +1 a ${candidateName}`);
  } else {
    Logger.log(`[ALERTA] Candidato '${candidateName}' no encontrado en bloque '${anchorText}'`);
  }
}

