# Sistema de Votaciones Estudiantiles USB (2025)

Sistema automatizado de votación y escrutinio en tiempo real para la Federación de Centros de Estudiantes (FCEUSB) y Centros de Estudiantes de la Universidad Simón Bolívar.

## Características
* **Multi-Sede:** Soporte unificado para Sede Sartenejas y Sede Litoral.
* **Validación en Tiempo Real:** Verifica identidad contra padrón electoral (Google Sheets).
* **Voto Único:** Impide votos duplicados mediante bloqueo de registro.
* **Filtros Inteligentes:**
  * Estudiantes de Ciclo Básico solo votan Federación.
  * Estudiantes de Carrera votan Federación + Centro.
  * Estudiantes de Litoral votan Federación + Centro Único.
* **Privacidad:** Separa la identidad del votante del voto emitido.

## Tecnologías
* Google Apps Script (Backend)
* Google Forms (Frontend)
* Google Sheets (Base de Datos y Resultados)

## Licencia
Este proyecto está bajo la Licencia GNU GPLv3. Es software libre para el beneficio de la comunidad estudiantil.
