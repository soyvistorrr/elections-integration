// GENERAL CONFIGURATION

const CONFIG = {
  SPREADSHEET_RESULTADOS_ID: '1lR05G4f8qOEEO-ZKknPiRhmqK-83uh5IYHz3rvggTlQ', 
  SPREADSHEET_REGISTRO_ID:   '1wJTY0L5h2sgg6oL90VvZMY-fYDAiD4PZ', 

  SHEET_NAME_RESULTADOS: 'RESULTADOS',
  SHEET_NAME_REGISTRO:   'Hoja 1',

  COL_CARNET: 1,           // Column A in Registry
  COL_CODIGO_CARRERA: 5,   // Column E in Registry
  COL_YA_VOTO: 9,          // Column I in Registry

  // Keywords to identify sections
  KEYWORD_CARNET:     "CARNET",                   // To find the Student ID question
  KEYWORD_FEDERACION: ["FEDERACIÓN", "FCE", "FCEUSB"], 
  KEYWORD_CENTRO:     ["CENTRO", "VOTACIÓN", "CARRERA"], 

  ROW_LIMIT_FCE: 15,       
  COL_OPCIONES: 2,         // Column B in Results
  COL_CONTEO: 3,           // Column C in Results
};

// MAIN LOGIC

function onFormSubmit(e) {
  try {
    const response = e.response;
    const itemResponses = response.getItemResponses();
    
    // 1. FIND STUDENT ID (Search for the question titled "Carnet")
    let carnetInput = "";
    
    for (let i = 0; i < itemResponses.length; i++) {
      const titulo = itemResponses[i].getItem().getTitle().toUpperCase();
      if (titulo.includes(CONFIG.KEYWORD_CARNET)) {
        carnetInput = itemResponses[i].getResponse().trim();
        break;
      }
    }

    if (carnetInput === "") {
      Logger.log("[ERROR] 'Carnet' question not found in form responses.");
      return;
    }

    Logger.log(`[START] Processing Vote for ID: ${carnetInput}`);

    // 2. VALIDATE USER IN REGISTRY
    const docRegistro = SpreadsheetApp.openById(CONFIG.SPREADSHEET_REGISTRO_ID);
    const sheetRegistro = docRegistro.getSheetByName(CONFIG.SHEET_NAME_REGISTRO);

    // Search for ID in Column A
    const finder = sheetRegistro.getRange(1, CONFIG.COL_CARNET, sheetRegistro.getLastRow(), 1)
      .createTextFinder(carnetInput).matchEntireCell(true);
    const result = finder.findNext();

    if (!result) {
      Logger.log(`[ERROR] ID ${carnetInput} not found in registry.`);
      return;
    }

    const rowIndex = result.getRow();

    // Check for duplicate vote
    const yaVotoCell = sheetRegistro.getRange(rowIndex, CONFIG.COL_YA_VOTO);
    if (yaVotoCell.getValue() === "SI") {
      Logger.log(`[DUPLICATE] ID ${carnetInput} already voted.`);
      return;
    }

    // Determine eligibility (Student Center vs Basic Cycle)
    const codigoCarrera = sheetRegistro.getRange(rowIndex, CONFIG.COL_CODIGO_CARRERA).getValue().toString();
    const esCicloBasico = (codigoCarrera === "0000" || codigoCarrera.toUpperCase().includes("BASIC")); 
    const puedeVotarCentro = !esCicloBasico;

    Logger.log(`ID verified. Major: ${codigoCarrera}. Center Eligible: ${puedeVotarCentro}`);

    // 3. PROCESS VOTE (WITH LOCK)
    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(10000)) return; 

    try {
      // Mark user as voted
      yaVotoCell.setValue("SI");

      const docResultados = SpreadsheetApp.openById(CONFIG.SPREADSHEET_RESULTADOS_ID);
      const sheetResultados = docResultados.getSheetByName(CONFIG.SHEET_NAME_RESULTADOS);

      // Iterate over all responses to find votes
      for (let i = 0; i < itemResponses.length; i++) {
        const item = itemResponses[i];
        const titulo = item.getItem().getTitle().toUpperCase();
        const respuesta = item.getResponse();

        // Case A: Federation
        if (contienePalabraClave(titulo, CONFIG.KEYWORD_FEDERACION)) {
          incrementarVoto(sheetResultados, respuesta, 1, CONFIG.ROW_LIMIT_FCE);
        }
        
        // Case B: Student Center
        else if (contienePalabraClave(titulo, CONFIG.KEYWORD_CENTRO)) {
          if (puedeVotarCentro) {
            // Find the major block and search within it
            const filaInicioCarrera = buscarInicioBloqueCarrera(sheetResultados, codigoCarrera);
            if (filaInicioCarrera > 0) {
              incrementarVoto(sheetResultados, respuesta, filaInicioCarrera, filaInicioCarrera + 25);
            }
          }
        }
      }

      SpreadsheetApp.flush();
      Logger.log("[SUCCESS] Vote registered.");

    } catch (err) {
      Logger.log("[CRITICAL] Error saving data: " + err);
    } finally {
      lock.releaseLock();
    }

  } catch (e) {
    Logger.log("[FATAL] " + e);
  }
}

/**
 * HELPERS
 */

function contienePalabraClave(texto, palabras) {
  return palabras.some(palabra => texto.includes(palabra));
}

function buscarInicioBloqueCarrera(sheet, codigo) {
  const finder = sheet.getRange(CONFIG.ROW_LIMIT_FCE, CONFIG.COL_OPCIONES, sheet.getLastRow(), 1)
    .createTextFinder(codigo);
  const result = finder.findNext();
  return result ? result.getRow() : -1;
}

function incrementarVoto(sheet, textoBusqueda, filaInicio, filaFin) {
  if (!textoBusqueda) return;

  const numFilas = filaFin - filaInicio + 1;
  const rangoBusqueda = sheet.getRange(filaInicio, CONFIG.COL_OPCIONES, numFilas, 1);
  
  const finder = rangoBusqueda.createTextFinder(textoBusqueda).matchEntireCell(true);
  const celdaNombre = finder.findNext();

  if (celdaNombre) {
    const celdaConteo = sheet.getRange(celdaNombre.getRow(), CONFIG.COL_CONTEO);
    const valor = celdaConteo.getValue();
    celdaConteo.setValue((typeof valor === 'number' ? valor : 0) + 1);
  }
}