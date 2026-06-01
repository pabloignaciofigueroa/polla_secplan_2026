# 04_predicciones - Mapa tecnico

## Estado
wireframe-implemented

## Funcion
Permitir que cada jugador complete las predicciones de los 72 partidos de fase de grupos. El 1er/2do lugar de cada grupo se calcula automaticamente desde los marcadores.

Regla madre: no existe polla incompleta. El JSON final solo se descarga cuando estan completos:

- 72 marcadores validos.
- 12 primeros de grupo calculados.
- 12 segundos de grupo calculados.

## Zonas implementadas
- prediction-hero-header
- progress-summary-grid
- group-tabs-navigation
- prediction-workspace
- matches-panel
- qualified-panel
- prediction-bottom-bar

## Sub-componentes principales
```txt
04_predicciones/
├── PrediccionesSection.astro
├── predicciones.client.js
├── predicciones.validation.js
├── predicciones.export.js
├── predicciones.standings.js
├── ProgressSummaryGrid.astro
├── GroupTabs.astro
├── PredictionWorkspace.astro
├── QualifiedPanel.astro
├── PredictionBottomBar.astro
└── SaveAndContinueCTA.astro
```

## Comportamiento
- Lee jugador desde `polla:selectedPlayerId` / identidad confirmada.
- Guarda marcadores en `polla:predictions`.
- Calcula tabla de grupo en vivo y guarda clasificados automaticos en `polla:qualifiedPredictions`.
- Guarda grupo activo en `polla:activePredictionGroup`.
- Los tabs A-L cambian grupo activo y muestran sus 6 partidos.
- Inputs aceptan solo enteros no negativos.
- El panel lateral muestra POS/EQUIPO/PTS/DG/GF y destaca 1°/2° cuando el grupo tiene 6 partidos completos.
- El boton `RESULTADO RANDOM` vive dentro del panel de clasificados y genera marcadores ponderados por H2H/info de equipos.
- El boton final queda gris hasta que `validateFullPrediction(...)` marca la polla completa.
- Al completar todo, el boton amarillo descarga el JSON local.
- Luego se guarda el bloqueo local con `polla:finalDownloaded*` y se deshabilitan inputs/random.

## Modulos ESM
- `predicciones.validation.js`: modulo puro sin DOM; valida grupo y polla completa con contadores 72/12/24.
- `predicciones.export.js`: construye el payload oficial, genera `predicciones_<jugador>_<YYYY-MM-DD_HH-mm>.json` y descarga con `Blob`.
- `predicciones.standings.js`: calcula tabla de posiciones, clasificados automaticos y resultados random ponderados.

## Storage
- `polla:predictions`
- `polla:qualifiedPredictions`
- `polla:activePredictionGroup`
- `polla:finalDownloaded`
- `polla:finalDownloadedAt`
- `polla:finalDownloadedFilename`
- `polla:finalSubmissionPayload`

## JSON oficial
El payload incluye:

- `schemaVersion`
- `competition`
- `submittedAt`
- `player`
- `summary`
- `groupPredictions`
- `raw`

Los grupos siguen el orden A-L y los partidos se ordenan por `matchNumber`.

## Admin / futuro
La prediccion oficial se genera como archivo JSON descargable. El administrador recibira manualmente estos archivos y los cargara despues en la base real o archivo maestro. Pendiente futuro: panel admin para importar JSON y recalcular tabla.

No hay servidor, claves externas, token, base de datos ni integraciones automaticas en esta etapa.
