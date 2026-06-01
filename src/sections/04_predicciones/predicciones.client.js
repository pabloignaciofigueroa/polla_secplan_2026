(async () => {
  const section = document.querySelector('[data-section="predicciones"]');
  if (!section) return;

  const storageKeys = {
    selectedPlayerId: "polla:selectedPlayerId",
    playerConfirmed: "polla:playerConfirmed",
    selectedPlayerSnapshot: "polla:selectedPlayerSnapshot",
    predictions: "polla:predictions",
    qualified: "polla:qualifiedPredictions",
    activeGroup: "polla:activePredictionGroup",
    activeGroupIntent: "polla:activePredictionGroupIntent",
    finalDownloaded: "polla:finalDownloaded",
    finalDownloadedAt: "polla:finalDownloadedAt",
    finalDownloadedFilename: "polla:finalDownloadedFilename",
    finalSubmissionPayload: "polla:finalSubmissionPayload",
  };

  const payloadNode = section.querySelector("[data-predictions-payload]");
  const payload = payloadNode ? JSON.parse(payloadNode.textContent || "{}") : {};

  if (payload.resetStateUrl) {
    try {
      const resetModule = await import(payload.resetStateUrl);
      resetModule.ensurePollaStorageVersion?.();
    } catch {
      // La pantalla sigue disponible aunque no se pueda aplicar el reset.
    }
  }
  const groups = payload.groups ?? [];
  const matches = payload.matches ?? [];
  const players = payload.players ?? [];
  const h2hData = payload.h2hData ?? {};
  const teamInfoData = payload.teamInfoData ?? {};
  const defaultPlayerId = payload.defaultPlayerId ?? "";

  const groupById = new Map(groups.map((group) => [group.id, group]));
  const matchById = new Map(matches.map((match) => [match.id, match]));
  const playersById = new Map(players.map((player) => [player.id, player]));
  let confirmedIdentity = null;

  if (payload.playerIdentityUrl) {
    try {
      const identityModule = await import(payload.playerIdentityUrl);
      confirmedIdentity = identityModule.resolveConfirmedPlayer?.(players) ?? null;
      if (confirmedIdentity) identityModule.syncPredictionLinks?.(document, confirmedIdentity);
    } catch {
      // Fallback storage readers below keep the section usable.
    }
  }

  // Modulos de validacion global y exportacion (ESM). Si no cargan, la seccion
  // sigue funcionando para completar; solo se desactiva la descarga final.
  let validationModule = null;
  let exportModule = null;
  let standingsModule = null;
  if (payload.validationUrl) {
    try {
      validationModule = await import(payload.validationUrl);
    } catch {
      // Sin validacion global, el boton de descarga queda bloqueado por seguridad.
    }
  }
  if (payload.exportUrl) {
    try {
      exportModule = await import(payload.exportUrl);
    } catch {
      // Sin exportacion, no se puede generar el JSON; el boton queda bloqueado.
    }
  }
  if (payload.standingsUrl) {
    try {
      standingsModule = await import(payload.standingsUrl);
    } catch {
      // Sin standings, se mantiene la captura de marcadores pero no se autocalculan clasificados.
    }
  }

  const tabs = Array.from(section.querySelectorAll("[data-group-tab]"));
  const matchGroups = Array.from(section.querySelectorAll("[data-match-group]"));
  const matchRows = Array.from(section.querySelectorAll("[data-match-row]"));
  const playerNameNode = section.querySelector("[data-active-player-name]");
  const playerStatusNode = section.querySelector("[data-active-player-status]");
  const playerStatusCard = section.querySelector("[data-player-status-card]");
  const matchesTitle = section.querySelector("[data-matches-title]");
  const qualifiedTitle = section.querySelector("[data-qualified-title]");
  const qualifiedCompleteNode = section.querySelector("[data-qualified-complete]");
  const qualifiedTotalNode = section.querySelector("[data-qualified-total]");
  const standingsBody = section.querySelector("[data-standings-body]");
  const qualifiedSummary = section.querySelector("[data-qualified-summary]");
  const randomButton = section.querySelector("[data-random-results]");
  const backButton = section.querySelector("[data-back-group]");
  const saveButton = section.querySelector("[data-save-continue]");
  const saveLabel = section.querySelector("[data-save-label]");
  const messageNode = section.querySelector("[data-prediction-message]");
  const completionStatus = section.querySelector("[data-completion-status]");
  const nextGroupIndicator = section.querySelector("[data-next-group-indicator]");
  const bottomGroupLabel = section.querySelector("[data-bottom-group-label]");
  const bottomGroupComplete = section.querySelector("[data-bottom-group-complete]");
  const nextGroupLabel = section.querySelector("[data-next-group-label]");

  const safeGet = (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const safeSet = (key, value) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // La pantalla sigue funcionando como wireframe aunque storage no esté disponible.
    }
  };

  const safeSessionGet = (key) => {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const safeSessionRemove = (key) => {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // Sin sessionStorage, la entrada directa conserva el SSR estable.
    }
  };

  const readJson = (key, fallback) => {
    const raw = safeGet(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  };

  const writeJson = (key, value) => {
    safeSet(key, JSON.stringify(value));
  };

  const getPlayerIdFromUrl = () => {
    try {
      const playerId = new URLSearchParams(window.location.search).get("player");
      return playersById.has(playerId) ? playerId : "";
    } catch {
      return "";
    }
  };

  const persistPlayerFromUrl = () => {
    const playerId = getPlayerIdFromUrl();
    if (!playerId) return "";
    const player = playersById.get(playerId);
    const snapshot = player
      ? {
          id: player.id,
          name: player.name,
          avatar: player.avatar ?? "",
          avatarThumb: player.avatarThumb ?? player.avatar ?? "",
        }
      : { id: playerId };
    safeSet(storageKeys.selectedPlayerId, playerId);
    safeSet(storageKeys.playerConfirmed, "true");
    safeSet(storageKeys.selectedPlayerSnapshot, JSON.stringify(snapshot));
    return playerId;
  };

  const getStoredPlayerSnapshot = () => {
    const raw = safeGet(storageKeys.selectedPlayerSnapshot) || safeSessionGet(storageKeys.selectedPlayerSnapshot);
    if (!raw) return null;
    try {
      const snapshot = JSON.parse(raw);
      return snapshot?.id ? snapshot : null;
    } catch {
      return null;
    }
  };

  const getPlayerId = () => {
    if (playersById.has(confirmedIdentity?.id)) return confirmedIdentity.id;

    const urlPlayerId = persistPlayerFromUrl();
    if (urlPlayerId) return urlPlayerId;

    const stored = safeGet(storageKeys.selectedPlayerId) || safeSessionGet(storageKeys.selectedPlayerId);
    const confirmed = safeGet(storageKeys.playerConfirmed) === "true" || safeSessionGet(storageKeys.playerConfirmed) === "true";
    if (confirmed && playersById.has(stored)) return stored;

    const snapshot = getStoredPlayerSnapshot();
    if (playersById.has(snapshot?.id)) return snapshot.id;

    return playersById.has(defaultPlayerId) ? defaultPlayerId : "";
  };

  let activePlayerId = getPlayerId();
  const navigationIntentGroupId = safeSessionGet(storageKeys.activeGroupIntent);
  let activeGroupId = navigationIntentGroupId || section.dataset.activeGroupId || "A";
  safeSessionRemove(storageKeys.activeGroupIntent);
  if (!groupById.has(activeGroupId)) activeGroupId = "A";

  const allPredictions = readJson(storageKeys.predictions, {});
  const allQualified = readJson(storageKeys.qualified, {});

  const ensurePlayerBucket = (store, playerId) => {
    if (!store[playerId]) store[playerId] = {};
    return store[playerId];
  };

  const getPlayerPredictions = () => ensurePlayerBucket(allPredictions, activePlayerId);
  const getPlayerQualified = () => ensurePlayerBucket(allQualified, activePlayerId);

  const groupIndex = (groupId) => groups.findIndex((group) => group.id === groupId);
  const getActiveGroup = () => groupById.get(activeGroupId) ?? groups[0];
  const getGroupMatches = (groupId) => matches.filter((match) => match.groupId === groupId);
  const groupColors = {
    A: ["#22C55E", "#16A34A", "#FFFFFF"],
    B: ["#126DFF", "#005BFF", "#FFFFFF"],
    C: ["#FFB000", "#FF8A00", "#061326"],
    D: ["#7C35FF", "#4B18B8", "#FFFFFF"],
    E: ["#46F1FF", "#18DDF2", "#061326"],
    F: ["#FF2FB3", "#D946EF", "#FFFFFF"],
    G: ["#FFD21F", "#F5B800", "#061326"],
    H: ["#1B8CFF", "#005BFF", "#FFFFFF"],
    I: ["#B6FF00", "#8AD600", "#061326"],
    J: ["#FF4058", "#E11D48", "#FFFFFF"],
    K: ["#D946EF", "#A21CAF", "#FFFFFF"],
    L: ["#18DDF2", "#00B8D9", "#061326"],
    review: ["#7C35FF", "#4B18B8", "#FFFFFF"],
  };

  const applyGroupColor = (node, prefix, groupId) => {
    if (!node) return;
    const [primary, secondary, text] = groupColors[groupId] ?? groupColors.review;
    node.style.setProperty(`--${prefix}-color`, primary);
    node.style.setProperty(`--${prefix}-color-2`, secondary);
    node.style.setProperty(`--${prefix}-text`, text);
  };

  const toScore = (value) => {
    if (value === "") return null;
    const numberValue = Number(value);
    if (!Number.isInteger(numberValue) || numberValue < 0) return null;
    return numberValue;
  };

  const scoreStatus = (homeScore, awayScore) => {
    const hasHome = homeScore !== null;
    const hasAway = awayScore !== null;
    if (hasHome && hasAway) return "complete";
    if (hasHome || hasAway) return "partial";
    return "empty";
  };

  const setMessage = (message) => {
    if (messageNode) messageNode.textContent = message;
  };

  const persist = ({ includeActiveGroup = true } = {}) => {
    writeJson(storageKeys.predictions, allPredictions);
    writeJson(storageKeys.qualified, allQualified);
    if (includeActiveGroup) safeSet(storageKeys.activeGroup, activeGroupId);
  };

  const rowMatchId = (row) => row.dataset.matchId ?? "";

  const predictionForRow = (row) => {
    const matchId = rowMatchId(row);
    const predictions = getPlayerPredictions();
    return predictions[matchId] ?? null;
  };

  const updateRowStatus = (row) => {
    const homeInput = row.querySelector('[data-score-input="home"]');
    const awayInput = row.querySelector('[data-score-input="away"]');
    const statusIcon = row.querySelector("[data-status-icon]");
    const homeScore = toScore(homeInput?.value ?? "");
    const awayScore = toScore(awayInput?.value ?? "");
    const status = scoreStatus(homeScore, awayScore);

    row.dataset.status = status;
    if (statusIcon) {
      const labels = {
        empty: ["—", "Predicción vacía"],
        partial: ["…", "Predicción parcial"],
        complete: ["", "Predicción completa"],
      };
      const [text, label] = labels[status];
      if (status === "complete") {
        if (!statusIcon.querySelector("img")) {
          statusIcon.innerHTML =
            '<img src="/assets/polla-mundialera/sections/04_predicciones/18-success-check-gold-energy.webp" alt="" width="64" height="64" decoding="async" />';
        }
      } else if (statusIcon.querySelector("img") || statusIcon.textContent !== text) {
        statusIcon.textContent = text;
      }
      statusIcon.setAttribute("aria-label", label);
    }

    return { homeScore, awayScore, status };
  };

  const storeRowPrediction = (row) => {
    const matchId = rowMatchId(row);
    const match = matchById.get(matchId);
    if (!match) return;

    const prediction = updateRowStatus(row);
    const predictions = getPlayerPredictions();
    predictions[matchId] = {
      playerId: activePlayerId,
      matchId,
      groupId: match.groupId,
      homeScore: prediction.homeScore,
      awayScore: prediction.awayScore,
      status: prediction.status,
    };
    persist();
  };

  const applyStoredPredictionToRow = (row) => {
    const prediction = predictionForRow(row);
    const homeInput = row.querySelector('[data-score-input="home"]');
    const awayInput = row.querySelector('[data-score-input="away"]');

    if (homeInput) homeInput.value = prediction?.homeScore ?? "";
    if (awayInput) awayInput.value = prediction?.awayScore ?? "";
    updateRowStatus(row);
  };

  const setProgress = (kind, current, total) => {
    const currentNode = section.querySelector(`[data-progress-current="${kind}"]`);
    const totalNode = section.querySelector(`[data-progress-total="${kind}"]`);
    const percentNode = section.querySelector(`[data-progress-percent="${kind}"]`);
    const meterNode = section.querySelector(`[data-progress-meter="${kind}"]`);
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;

    if (currentNode) currentNode.textContent = String(current);
    if (totalNode) totalNode.textContent = String(total);
    if (percentNode) percentNode.textContent = `${percent}%`;
    if (meterNode) meterNode.style.width = `${percent}%`;
  };

  const completeMatchesForGroup = (groupId) => {
    const predictions = getPlayerPredictions();
    return getGroupMatches(groupId).filter((match) => predictions[match.id]?.status === "complete").length;
  };

  const completeMatchesTotal = () => {
    const predictions = getPlayerPredictions();
    return matches.filter((match) => predictions[match.id]?.status === "complete").length;
  };

  const getQualifiedForGroup = (groupId) => {
    const qualified = getPlayerQualified();
    if (!qualified[groupId]) {
      qualified[groupId] = {
        playerId: activePlayerId,
        groupId,
        firstPlaceTeamId: null,
        secondPlaceTeamId: null,
      };
    }
    return qualified[groupId];
  };

  const qualifiedComplete = (groupId) => {
    const qualified = getPlayerQualified()[groupId];
    return Boolean(
      qualified?.firstPlaceTeamId &&
      qualified?.secondPlaceTeamId &&
      qualified.firstPlaceTeamId !== qualified.secondPlaceTeamId
    );
  };

  const calculateStandingsForGroup = (groupId) => {
    const group = groupById.get(groupId);
    if (!standingsModule?.calculateGroupStandings || !group) {
      return {
        groupId,
        completedMatches: completeMatchesForGroup(groupId),
        totalMatches: getGroupMatches(groupId).length,
        isComplete: false,
        standings: (group?.teams ?? []).map((team, index) => ({
          teamId: team.id,
          name: team.name,
          shortCode: team.shortCode,
          rank: index + 1,
          qualified: index < 2,
          played: 0,
          won: 0,
          drawn: 0,
          lost: 0,
          goalsFor: 0,
          goalsAgainst: 0,
          goalDifference: 0,
          points: 0,
        })),
      };
    }
    return standingsModule.calculateGroupStandings(group, getGroupMatches(groupId), getPlayerPredictions());
  };

  const syncAutomaticQualifiedForGroup = (groupId) => {
    const result = calculateStandingsForGroup(groupId);
    const qualified = getQualifiedForGroup(groupId);

    if (standingsModule?.getAutomaticQualified && result.isComplete) {
      const automatic = standingsModule.getAutomaticQualified(result);
      qualified.firstPlaceTeamId = automatic.firstPlaceTeamId;
      qualified.secondPlaceTeamId = automatic.secondPlaceTeamId;
    } else {
      qualified.firstPlaceTeamId = null;
      qualified.secondPlaceTeamId = null;
    }

    return result;
  };

  const syncAllAutomaticQualified = () => {
    groups.forEach((group) => syncAutomaticQualifiedForGroup(group.id));
  };

  const getActivePlayerObject = () => {
    const player = playersById.get(activePlayerId);
    return player
      ? { id: player.id, name: player.name }
      : { id: activePlayerId || "generic", name: "Jugador" };
  };

  const runFullValidation = () => {
    if (!validationModule?.validateFullPrediction) return null;
    syncAllAutomaticQualified();
    writeJson(storageKeys.qualified, allQualified);
    return validationModule.validateFullPrediction(
      getPlayerPredictions(),
      getPlayerQualified(),
      groups,
      matches
    );
  };

  const isDownloaded = () => safeGet(storageKeys.finalDownloaded) === "true";

  const lockSection = () => {
    section.dataset.finalDownloaded = "true";
    matchRows.forEach((row) => {
      row.querySelectorAll("[data-score-input]").forEach((input) => {
        input.disabled = true;
      });
    });
    if (randomButton) randomButton.disabled = true;
  };

  const setSubmitState = (state) => {
    if (!saveButton) return;
    saveButton.dataset.submitState = state;
    const blocked = state === "incomplete" || state === "downloading" || state === "downloaded";
    saveButton.disabled = blocked;
    saveButton.setAttribute("aria-disabled", blocked ? "true" : "false");
  };

  const refreshSubmitState = (full) => {
    if (isDownloaded()) {
      setSubmitState("downloaded");
      if (saveLabel) saveLabel.textContent = "JSON DESCARGADO";
      const filename = safeGet(storageKeys.finalDownloadedFilename);
      setMessage(
        filename
          ? `Tu archivo JSON ya fue generado: ${filename}. Si necesitas corregir algo, contacta al administrador antes de reenviarlo.`
          : "Tu archivo JSON ya fue generado. Si necesitas corregir algo, contacta al administrador antes de reenviarlo."
      );
      return;
    }
    if (!exportModule || !validationModule) {
      setSubmitState("incomplete");
      if (saveLabel) saveLabel.textContent = "DESCARGA NO DISPONIBLE";
      return;
    }
    const result = full ?? runFullValidation();
    if (result?.isComplete) {
      setSubmitState("complete");
      if (saveLabel) saveLabel.textContent = "DESCARGAR POLLA JSON";
      setMessage("Polla completa. Ya puedes descargar tu archivo JSON y enviarlo al administrador.");
    } else {
      setSubmitState("incomplete");
      if (saveLabel) saveLabel.textContent = "COMPLETA TODO PARA DESCARGAR";
      if (result?.missingSummary?.length) {
        const head = result.missingSummary.slice(0, 4).join(" · ");
        setMessage(`Faltan: ${head}${result.missingSummary.length > 4 ? "…" : ""}`);
      } else {
        setMessage(
          "Completa los 72 partidos y los clasificados 1° y 2° de cada grupo para descargar tu polla."
        );
      }
    }
  };

  const downloadPollaJson = () => {
    if (isDownloaded()) return;
    const full = runFullValidation();
    if (!full?.isComplete || !exportModule) {
      refreshSubmitState(full);
      return;
    }

    setSubmitState("downloading");
    if (saveLabel) saveLabel.textContent = "GENERANDO JSON...";
    setMessage("Generando tu archivo JSON...");

    const player = getActivePlayerObject();
    const generatedAt = new Date();
    const submittedAt = generatedAt.toISOString();
    const finalPayload = exportModule.buildPredictionPayload({
      player,
      predictions: getPlayerPredictions(),
      qualified: getPlayerQualified(),
      groups,
      matches,
      summary: full,
      submittedAt,
    });
    const filename = exportModule.buildFileName(player.name, generatedAt);

    try {
      exportModule.downloadJson(finalPayload, filename);
    } catch {
      setSubmitState("error");
      if (saveLabel) saveLabel.textContent = "REINTENTAR DESCARGA";
      setMessage("No se pudo generar el archivo. Tus datos siguen guardados. Intenta nuevamente.");
      return;
    }

    safeSet(storageKeys.finalDownloaded, "true");
    safeSet(storageKeys.finalDownloadedAt, submittedAt);
    safeSet(storageKeys.finalDownloadedFilename, filename);
    writeJson(storageKeys.finalSubmissionPayload, finalPayload);
    lockSection();
    setSubmitState("downloaded");
    if (saveLabel) saveLabel.textContent = "JSON DESCARGADO";
    setMessage(`Archivo JSON descargado correctamente. Envialo al administrador para registrar oficialmente tu polla. Archivo generado: ${filename}`);
  };

  const updateProgress = () => {
    const groupComplete = completeMatchesForGroup(activeGroupId);
    const totalComplete = completeMatchesTotal();
    const activeGroup = getActiveGroup();

    renderQualifiedStandings();
    setProgress("general", totalComplete, matches.length);
    setProgress("group", groupComplete, 6);

    const full = runFullValidation();
    if (full) {
      setProgress("groups", full.completedGroups, full.totalGroups);
      setProgress("qualified", full.completedQualifiedSlots, full.totalQualifiedSlots);
      const completeById = new Map(full.groups.map((g) => [g.groupId, g.isComplete]));
      tabs.forEach((tab) => {
        tab.dataset.complete = completeById.get(tab.dataset.groupTab) === true ? "true" : "false";
      });
    }

    const groupTitle = section.querySelector('[data-progress-title="group"]');
    if (groupTitle) groupTitle.textContent = activeGroup.label;
    if (completionStatus) completionStatus.dataset.currentGroup = activeGroup.id.toLowerCase();
    applyGroupColor(completionStatus, "status", activeGroup.id);
    if (bottomGroupLabel) bottomGroupLabel.textContent = activeGroup.label;
    if (bottomGroupComplete) bottomGroupComplete.textContent = String(groupComplete);

    const next = groups[groupIndex(activeGroupId) + 1] ?? null;
    if (nextGroupIndicator) {
      nextGroupIndicator.dataset.nextGroup = next ? next.id.toLowerCase() : "review";
      nextGroupIndicator.disabled = !next;
    }
    applyGroupColor(nextGroupIndicator, "next", next?.id ?? "review");
    if (nextGroupLabel) nextGroupLabel.textContent = next ? next.label : "Revisión";

    refreshSubmitState(full);
  };

  const renderQualifiedStandings = () => {
    const activeGroup = getActiveGroup();
    const result = syncAutomaticQualifiedForGroup(activeGroup.id);
    if (qualifiedTitle) qualifiedTitle.textContent = `TABLA ${activeGroup.label}`;
    if (qualifiedCompleteNode) qualifiedCompleteNode.textContent = String(result.completedMatches);
    if (qualifiedTotalNode) qualifiedTotalNode.textContent = String(result.totalMatches || 6);

    if (standingsBody) {
      standingsBody.innerHTML = "";
      result.standings.forEach((row) => {
        const item = document.createElement("div");
        item.className = "standings-row";
        item.dataset.qualified = row.qualified && result.isComplete ? "true" : "false";
        item.setAttribute("role", "row");
        // El CSS scoped de Astro no alcanza al DOM inyectado por innerHTML, y
        // una custom property scoped (var) no hereda hasta aqui; por eso la
        // grilla se fija inline con columnas LITERALES (POS·EQUIPO·PTS·DG·GF).
        // Debe coincidir con .standings-head y .standings-row en QualifiedPanel.
        item.style.display = "grid";
        item.style.gridTemplateColumns = "2.2rem minmax(0, 1fr) 2.1rem 2.1rem 2.1rem";
        item.style.alignItems = "center";
        item.innerHTML = `
          <span class="rank-badge" role="cell">${row.rank}°</span>
          <span class="team-cell" role="cell" title="${row.name}">${row.name}</span>
          <span class="number-cell" role="cell">${row.points}</span>
          <span class="number-cell" role="cell">${row.goalDifference > 0 ? "+" : ""}${row.goalDifference}</span>
          <span class="number-cell" role="cell">${row.goalsFor}</span>
        `;
        standingsBody.append(item);
      });
    }

    if (qualifiedSummary) {
      const [first, second] = result.standings;
      qualifiedSummary.textContent = result.isComplete && first && second
        ? `Clasifican: ${first.name} y ${second.name}.`
        : `Completa los ${result.totalMatches || 6} marcadores para calcular 1° y 2° automaticamente.`;
    }

    writeJson(storageKeys.qualified, allQualified);
  };

  const updatePlayerBadge = () => {
    activePlayerId = getPlayerId();
    section.dataset.playerId = activePlayerId || "generic";
    const player = playersById.get(activePlayerId);
    if (playerNameNode) playerNameNode.textContent = player?.name ?? "Jugador";
    if (playerStatusNode) playerStatusNode.textContent = player ? "JUGADOR ACTIVO" : "SIN JUGADOR";
    if (playerStatusCard) {
      playerStatusCard.dataset.playerId = activePlayerId || "generic";
      playerStatusCard.dataset.hasPlayer = player ? "true" : "false";
      const avatarThumb = player?.avatarThumb ?? player?.avatar ?? "";
      playerStatusCard.dataset.playerAvatarThumb = avatarThumb;

      const avatarShell = playerStatusCard.querySelector(".player-avatar");
      let avatarImg = playerStatusCard.querySelector("[data-active-player-avatar]");

      if (player && avatarThumb && avatarShell) {
        if (!avatarImg) {
          avatarShell.innerHTML =
            '<img data-active-player-avatar alt="" width="160" height="160" loading="lazy" decoding="async" />';
          avatarImg = playerStatusCard.querySelector("[data-active-player-avatar]");
        }
        if (avatarImg?.getAttribute("src") !== avatarThumb) {
          avatarImg?.setAttribute("src", avatarThumb);
        }
      } else if (avatarShell) {
        if (!avatarShell.querySelector("[data-active-player-fallback]")) {
          avatarShell.innerHTML =
            '<span class="avatar-fallback" data-active-player-fallback><span class="person-icon" aria-hidden="true"></span></span>';
        }
      }
    }
  };

  const showActiveGroup = (groupId, options = {}) => {
    if (!groupById.has(groupId)) return;
    const { persistActiveGroup = true } = options;
    activeGroupId = groupId;
    section.dataset.activeGroupId = groupId;

    tabs.forEach((tab) => {
      const active = tab.dataset.groupTab === groupId;
      tab.dataset.active = active ? "true" : "false";
      tab.setAttribute("aria-pressed", active ? "true" : "false");
    });

    matchGroups.forEach((group) => {
      group.hidden = group.dataset.matchGroup !== groupId;
    });

    matchRows.forEach((row) => applyStoredPredictionToRow(row));

    const activeGroup = getActiveGroup();
    if (matchesTitle) matchesTitle.textContent = activeGroup.label.toUpperCase();
    renderQualifiedStandings();
    updateProgress();
    persist({ includeActiveGroup: persistActiveGroup });
  };

  // Nota: la navegacion entre grupos es por tabs A-L + Back. El boton principal
  // ya no avanza grupo a grupo: es la descarga global gateada.

  const randomizeActiveGroup = () => {
    const rows = matchRows.filter((row) => row.dataset.groupId === activeGroupId);
    const generatedScores = standingsModule?.generateWeightedRandomScores
      ? standingsModule.generateWeightedRandomScores(getGroupMatches(activeGroupId), h2hData, teamInfoData)
      : {};
    rows.forEach((row) => {
      const matchId = rowMatchId(row);
      const generated = generatedScores[matchId];
      const homeInput = row.querySelector('[data-score-input="home"]');
      const awayInput = row.querySelector('[data-score-input="away"]');
      if (homeInput) homeInput.value = String(generated?.homeScore ?? Math.floor(Math.random() * 4));
      if (awayInput) awayInput.value = String(generated?.awayScore ?? Math.floor(Math.random() * 4));
      storeRowPrediction(row);
    });
    renderQualifiedStandings();
    updateProgress();
    setMessage(`Marcadores ponderados cargados para el Grupo ${activeGroupId}. La tabla de clasificados se recalculo automaticamente.`);
  };

  matchRows.forEach((row) => {
    row.querySelectorAll("[data-score-input]").forEach((input) => {
      input.addEventListener("input", () => {
        const numberValue = Number(input.value);
        if (input.value !== "" && (!Number.isInteger(numberValue) || numberValue < 0)) {
          input.value = "";
        }
        storeRowPrediction(row);
        updateProgress();
      });
    });
  });

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const groupId = tab.dataset.groupTab;
      if (!groupId) return;
      showActiveGroup(groupId);
      setMessage("");
    });
  });

  randomButton?.addEventListener("click", randomizeActiveGroup);

  backButton?.addEventListener("click", () => {
    const previous = groups[groupIndex(activeGroupId) - 1];
    if (!previous) {
      setMessage("Ya estás en el Grupo A.");
      return;
    }
    showActiveGroup(previous.id);
    setMessage(`Volviste a ${previous.label}.`);
  });

  nextGroupIndicator?.addEventListener("click", () => {
    const next = groups[groupIndex(activeGroupId) + 1];
    if (!next) {
      setMessage("Ya estás en el último grupo (L).");
      return;
    }
    showActiveGroup(next.id);
    setMessage(`Avanzaste a ${next.label}.`);
  });

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  saveButton?.addEventListener("click", () => {
    // Punch arcade al accionar la descarga (no se dispara si el boton esta bloqueado).
    if (!reduceMotion && !saveButton.disabled) {
      saveButton.classList.remove("is-saved-punch");
      void saveButton.offsetWidth; // reflow para re-disparar
      saveButton.classList.add("is-saved-punch");
    }
    downloadPollaJson();
  });

  updatePlayerBadge();
  showActiveGroup(activeGroupId, { persistActiveGroup: Boolean(navigationIntentGroupId) });
  if (isDownloaded()) lockSection();
})();
