/* 1. CONFIGURACIÓN GENERAL */
const CONFIG = {
  // IDs de tus hojas
  ID_RESULTADOS:          '1CNc-j0YrQdJDhjf0IxzAsEYfKNwfz1CySCcFJXO-ViU',
  ID_REGISTRO_SARTENEJAS: '11uE25RmubL_68IDu0dyabQOFMymoYPqx224D2PiJmuo',
  ID_REGISTRO_LITORAL:    '1tJNdVHX16ZCVn0AWgJNydQborVJ2__s3bwyFz1_2nsw',

  // Nombres de pestañas
  TAB_NAME_RESULTADOS: 'RESULTADOS',
  TAB_NAME_REGISTRO:   'Hoja 1',

  // Columnas de registro
  COL_CARNET: 1,           // A
  COL_CODIGO_CARRERA: 5,   // E
  COL_YA_VOTO: 10,         // J

  // Columnas de resultados
  COL_RES_NOMBRES: 2,      // B: Nombres de planchas/candidatos
  COL_RES_TITULOS: 3,      // C: Encabezados de bloques (Federación/Litoral/otros)
  COL_RES_ANCLAJE: 10,     // J: Códigos de carrera para centros de Sartenejas y Litoral

  // Palabras clave base
  KEY_CARNET: "CARNET",
  KEY_SEDE:   "SEDE",

  // Variantes de encabezado reconocidas para Federación
  HEADERS_FCE_VARIANTS: [
    "JD-FCEUSB",
    "JDC-FCEUSB",
    "FEDERACION FCEUSB",
    "FEDERACION",
    "FCEUSB"
  ],

  // Encabezado para Litoral (y variantes)
  HEADERS_LITORAL_VARIANTS: [
    "JD-CE SEDE DE LITORAL",
    "CE LITORAL",
    "LITORAL"
  ],

  // Mapa de columnas de conteo por bloque
  MAPA_CARGOS: {
    FCE: {
      "PRESIDENCIA": 3,
      "GENERAL": 5,
      "SERVICIOS": 7,
      "ACADEMICA": 9,
      "ACADÉMICA": 9,
      "FINANZAS": 11,
      "DEFAULT": 3
    },
    LITORAL: {
      "PRESIDENCIA": 3,
      "VICE": 4,
      "GENERAL": 5,
      "ACTAS": 6,
      "TESORERIA": 7,
      "ACADEMICA": 8,
      "ACADÉMICA": 8,
      "SERVICIO": 9,
      "DEPORTE": 10,
      "DEFAULT": 3
    },
    SARTENEJAS: {
      "DEFAULT": 3
    }
  },

  // Lista de cargos típicos para detectar preguntas de Federación aunque no tengan palabras clave
  CARGOS_FCE_LIST: [
    "PRESIDENCIA",
    "VICEPRESIDENCIA",
    "SECRETARIA GENERAL",
    "SECRETARÍA GENERAL",
    "SECRETARIA DE SERVICIOS",
    "SECRETARÍA DE SERVICIOS",
    "SECRETARIA ACADEMICA",
    "SECRETARÍA ACADÉMICA",
    "SECRETARIA DE FINANZAS",
    "SECRETARÍA DE FINANZAS"
  ],

  // Palabras que sugieren preguntas de centro
  KEY_CENTRO_HINTS: [
    "CENTRO",
    "DELEGACION",
    "DELEGACIÓN",
    "TESORERIA",
    "TESORERÍA",
    "ACTAS",
    "DEPORTE",
    "VOTACION",
    "VOTACIÓN",
    "ELECCION",
    "ELECCIÓN"
  ]
};


/* 2. LÓGICA PRINCIPAL */
function onFormSubmit(e) {
  try {
    const itemResponses = e.response && e.response.getItemResponses ? e.response.getItemResponses() : [];
    if (!itemResponses || !itemResponses.length) { Logger.log("[WARN] Sin respuestas"); return; }

    let carnet = "";
    let sede = "";

    // Leer datos del form con tolerancia
    for (let i = 0; i < itemResponses.length; i++) {
      const titulo = normalizeStr(itemResponses[i].getItem().getTitle());
      const respuesta = itemResponses[i].getResponse();
      const respStr = String(respuesta || "").trim();

      if (titulo.includes(normalizeStr(CONFIG.KEY_CARNET))) carnet = respStr;
      if (titulo.includes(normalizeStr(CONFIG.KEY_SEDE)))   sede = normalizeStr(respStr);
    }

    if (!carnet) { Logger.log("[ERROR] Falta Carnet."); return; }
    if (!sede)   { sede = "SARTENEJAS"; }

    Logger.log(`[PROCESANDO] Carnet: ${carnet} | Sede: ${sede}`);

    // Selección de hoja de registro
    const esLitoral = sede.includes("LITORAL");
    const idRegistro = esLitoral ? CONFIG.ID_REGISTRO_LITORAL : CONFIG.ID_REGISTRO_SARTENEJAS;

    const sheetReg = SpreadsheetApp.openById(idRegistro).getSheetByName(CONFIG.TAB_NAME_REGISTRO);
    if (!sheetReg) { Logger.log("[ERROR] Hoja de registro no encontrada."); return; }

    const lastRowReg = sheetReg.getLastRow() || 1;
    const carnetRange = sheetReg.getRange(1, CONFIG.COL_CARNET, lastRowReg, 1);
    const finder = carnetRange.createTextFinder(carnet).matchEntireCell(true).matchCase(false);
    const result = finder.findNext();

    if (!result) { Logger.log(`[RECHAZADO] Carnet no encontrado.`); return; }

    const rowUser = result.getRow();
    const cellYaVoto = sheetReg.getRange(rowUser, CONFIG.COL_YA_VOTO);

    if (normalizeStr(cellYaVoto.getValue()) === "SI") { Logger.log(`[REPETIDO] Ya votó.`); return; }

    // Validar carrera (solo aplica para Sartenejas centro)
    let puedeVotarCentro = true;
    let codigoAnclaje = "";
    let columnaBusquedaAncla = 0;

    if (esLitoral) {
      puedeVotarCentro = true;
      codigoAnclaje = "LITORAL"; // se usará con variantes
      columnaBusquedaAncla = CONFIG.COL_RES_TITULOS;
    } else {
      const rawCode = String(sheetReg.getRange(rowUser, CONFIG.COL_CODIGO_CARRERA).getValue() || "").trim();
      const codeNorm = normalizeStr(rawCode);
      const esBasico = (codeNorm === "0" || codeNorm === "00" || codeNorm.includes("BASIC"));
      puedeVotarCentro = !esBasico;
      codigoAnclaje = extractCodeDigits(rawCode); // "4300" etc.
      columnaBusquedaAncla = CONFIG.COL_RES_ANCLAJE;
    }

    // Guardar votos con lock
    const lock = LockService.getDocumentLock();
    if (!lock.tryLock(10000)) { Logger.log("[ERROR] No pudo adquirirse el lock."); return; }

    try {
      // marcar que ya votó
      cellYaVoto.setValue("SI");

      const sheetRes = SpreadsheetApp.openById(CONFIG.ID_RESULTADOS).getSheetByName(CONFIG.TAB_NAME_RESULTADOS);
      if (!sheetRes) { Logger.log("[ERROR] Hoja RESULTADOS no encontrada."); return; }

      for (let i = 0; i < itemResponses.length; i++) {
        const item = itemResponses[i];
        const tituloRaw = item.getItem().getTitle() || "";
        const titulo = normalizeStr(tituloRaw);
        const votoOriginal = item.getResponse();
        const votoLimpio = normalizarVoto(votoOriginal); // "BLANCO" o nombre de plancha normalizado

        // Clasificación robusta del bloque
        const tipoPregunta = clasificarPregunta(titulo);

        if (tipoPregunta === "FCE") {
          const targetCol = obtenerColumnaDesdeMapa(tituloRaw, CONFIG.MAPA_CARGOS.FCE); // usa raw para detectar keywords
          const anchorCell = findAnchorFlexible(sheetRes, CONFIG.HEADERS_FCE_VARIANTS, CONFIG.COL_RES_TITULOS);
          if (!anchorCell) {
            Logger.log(`[ALERTA] Bloque FCE no encontrado en col ${CONFIG.COL_RES_TITULOS}. Variantes: ${CONFIG.HEADERS_FCE_VARIANTS.join(", ")}`);
            continue;
          }
          smartVoteCountFromAnchor(sheetRes, anchorCell.getRow(), votoLimpio, 80, targetCol);
        }
        else if (tipoPregunta === "CENTRO") {
          if (puedeVotarCentro) {
            const mapaUsar = esLitoral ? CONFIG.MAPA_CARGOS.LITORAL : CONFIG.MAPA_CARGOS.SARTENEJAS;
            const targetCol = obtenerColumnaDesdeMapa(tituloRaw, mapaUsar);

            let anchorCell;
            if (esLitoral) {
              anchorCell = findAnchorFlexible(sheetRes, CONFIG.HEADERS_LITORAL_VARIANTS, CONFIG.COL_RES_TITULOS);
            } else {
              anchorCell = findAnchorByCode(sheetRes, codigoAnclaje, CONFIG.COL_RES_ANCLAJE);
            }

            if (!anchorCell) {
              Logger.log(`[ALERTA] Bloque Centro no encontrado: '${codigoAnclaje}' en col ${esLitoral ? CONFIG.COL_RES_TITULOS : CONFIG.COL_RES_ANCLAJE}`);
              continue;
            }

            smartVoteCountFromAnchor(sheetRes, anchorCell.getRow(), votoLimpio, 120, targetCol);
          } else {
            Logger.log(`[INFO] Usuario ${carnet} no puede votar centros (ciclo básico).`);
          }
        }
        else {
          // No clasificado: ignora preguntas administrativas (Nombre, Apellido, etc.)
          Logger.log(`[DEBUG] Pregunta no electoral: ${tituloRaw}`);
        }
      }

      SpreadsheetApp.flush();
      Logger.log("[EXITO] Voto guardado.");

    } catch (e) {
      Logger.log("[CRITICO] Error interno: " + e);
    } finally {
      try { lock.releaseLock(); } catch (er) { /* ignore */ }
    }

  } catch (error) {
    Logger.log("[FATAL] " + error);
  }
}


/* 3. UTILIDADES DE NORMALIZACIÓN */

function normalizeStr(val) {
  if (val === null || val === undefined) return "";
  try {
    return String(val)
      .toUpperCase()
      .trim()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/\s+/g, ' ') // colapsa espacios múltiples
      .replace(/[\u200B-\u200D\uFEFF]/g, ''); // quita espacios invisibles
  } catch (e) {
    return String(val).toUpperCase().trim();
  }
}

// Extrae dígitos de un código (ej. " - 4300 - " -> "4300")
function extractCodeDigits(str) {
  const s = String(str || "");
  const match = s.match(/\d+/g);
  return match ? match.join('') : "";
}

// Detecta si una cadena contiene otra, normalizadas
function containsNorm(haystack, needle) {
  const h = normalizeStr(haystack);
  const n = normalizeStr(needle);
  return h.includes(n);
}

// Clasificación robusta de pregunta: FCE, CENTRO o OTRO
function clasificarPregunta(tituloNorm) {
  const t = normalizeStr(tituloNorm);

  // Si contiene pistas de centro
  for (const kw of CONFIG.KEY_CENTRO_HINTS) {
    if (t.includes(normalizeStr(kw))) return "CENTRO";
  }

  // Si coincide con cargos de FCE
  for (const cargo of CONFIG.CARGOS_FCE_LIST) {
    if (t.includes(normalizeStr(cargo))) return "FCE";
  }

  // Fallback: intenta distinguir por contexto
  if (t.includes("PRESIDENCIA") || t.includes("SECRETARIA") || t.includes("SECRETARÍA")) {
    return "FCE";
  }

  return "OTRO";
}


/* 4. LOCALIZACIÓN FLEXIBLE DE ANCLAS EN LA HOJA */

function findAnchorFlexible(sheet, variants, anchorColIndex) {
  const lastRow = sheet.getLastRow() || 1;
  const colRange = sheet.getRange(1, anchorColIndex, lastRow, 1);
  const values = colRange.getValues().map(r => normalizeStr(r[0]));

  for (let row = 0; row < values.length; row++) {
    const cellVal = values[row];
    if (!cellVal) continue;
    for (const v of variants) {
      if (cellVal.includes(normalizeStr(v))) {
        return sheet.getRange(row + 1, anchorColIndex); // +1 por índice base 1
      }
    }
  }
  return null;
}

function findAnchorByCode(sheet, codeDigits, anchorColIndex) {
  const code = extractCodeDigits(codeDigits);
  if (!code) return null;
  const lastRow = sheet.getLastRow() || 1;
  const colRange = sheet.getRange(1, anchorColIndex, lastRow, 1);
  const values = colRange.getValues().map(r => String(r[0] || ""));

  for (let row = 0; row < values.length; row++) {
    const digits = extractCodeDigits(values[row]);
    if (digits === code) {
      return sheet.getRange(row + 1, anchorColIndex);
    }
  }
  return null;
}


/* 5. CONTEO DE VOTOS DESDE UN ANCLA */

function normalizarVoto(voto) {
  if (!voto && voto !== 0) return "";
  const v = String(voto || "").trim();

  // BLANCO
  if (normalizeStr(v).includes("BLANCO")) return "BLANCO";

  // Extraer entre paréntesis: "(Plancha X)" o "(X)"
  const paren = v.match(/\((?:\s*Plancha\s*[:\-]?\s*)?(.+?)\s*\)/i);
  if (paren && paren[1]) return normalizeStr(paren[1]);

  // Prefijo "Plancha X"
  const planchaPref = v.match(/^\s*Plancha\s*[:\-]?\s*(.+)$/i);
  if (planchaPref && planchaPref[1]) return normalizeStr(planchaPref[1]);

  // Separadores comunes
  const parts = v.split(/[-–—|]/).map(p => p.trim()).filter(Boolean);
  if (parts.length === 1) return normalizeStr(parts[0]);

  for (let p of parts) {
    if (/PLANCHA/i.test(p)) {
      return normalizeStr(p.replace(/PLANCHA/i, '').trim());
    }
  }

  // Fallback: parte más corta (probable nombre)
  let shortest = parts.reduce((a, b) => a.length <= b.length ? a : b, parts[0]);
  return normalizeStr(shortest);
}

function obtenerColumnaDesdeMapa(tituloPreguntaRaw, mapa) {
  if (!mapa) return 3;
  const tituloUp = normalizeStr(tituloPreguntaRaw || "");
  for (let clave in mapa) {
    if (clave === "DEFAULT") continue;
    if (tituloUp.includes(normalizeStr(clave))) {
      return mapa[clave];
    }
  }
  return mapa["DEFAULT"];
}

function smartVoteCountFromAnchor(sheet, startRow, candidateNameNorm, searchDepth, targetColIndex) {
  if (!candidateNameNorm) { Logger.log("[WARN] smartVoteCount sin candidateName"); return; }

  const lastRow = sheet.getLastRow() || startRow;
  const endRow = Math.min(lastRow, startRow + (searchDepth || 60) - 1);
  const numRows = Math.max(1, endRow - startRow + 1);

  // Leer nombres de planchas
  const namesRange = sheet.getRange(startRow, CONFIG.COL_RES_NOMBRES, numRows, 1);
  const namesVals = namesRange.getValues();

  let foundRow = null;
  const candidateNorm = normalizeStr(candidateNameNorm);

  for (let i = 0; i < namesVals.length; i++) {
    const raw = namesVals[i][0];
    const cellNorm = normalizeStr(raw);
    if (!cellNorm) continue;

    // Intentos de match: exacto, contains, inverse contains, startsWith
    if (
      cellNorm === candidateNorm ||
      cellNorm.includes(candidateNorm) ||
      candidateNorm.includes(cellNorm) ||
      cellNorm.startsWith(candidateNorm) ||
      candidateNorm.startsWith(cellNorm)
    ) {
      foundRow = startRow + i;
      break;
    }

    // Caso especial BLANCO
    if (candidateNorm === "BLANCO" && cellNorm === "BLANCO") {
      foundRow = startRow + i;
      break;
    }
  }

  if (foundRow) {
    const cellCount = sheet.getRange(foundRow, targetColIndex);
    const valRaw = cellCount.getValue();
    const current = (typeof valRaw === 'number') ? valRaw : (isFinite(Number(valRaw)) ? Number(valRaw) : 0);
    const newVal = current + 1;
    cellCount.setValue(newVal);
    Logger.log(` +1 a '${candidateNameNorm}' en Col ${targetColIndex} fila ${foundRow} (antes ${current} ahora ${newVal})`);
  } else {
    Logger.log(`[ALERTA] Candidato '${candidateNameNorm}' no encontrado desde fila ${startRow} hasta ${endRow} en Col ${CONFIG.COL_RES_NOMBRES}`);
  }
}
