export const GROUP_POINTS = {
  win: 3,
  draw: 1,
  loss: 0,
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const toScore = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

const slugify = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const TEAM_INFO_ALIASES = {
  czechia: "republica-checa",
  "congo-dr": "rd-del-congo",
  "cote-divoire": "costa-de-marfil",
  "ir-iran": "iran",
  "korea-republic": "corea-del-sur",
  turkiye: "turquia",
  usa: "estados-unidos",
};

function createEmptyRow(team, index) {
  return {
    teamId: team.id,
    name: team.name,
    shortCode: team.shortCode,
    originalIndex: index,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
    rank: index + 1,
    qualified: false,
  };
}

function applyResult(row, goalsFor, goalsAgainst) {
  row.played += 1;
  row.goalsFor += goalsFor;
  row.goalsAgainst += goalsAgainst;
  row.goalDifference = row.goalsFor - row.goalsAgainst;

  if (goalsFor > goalsAgainst) {
    row.won += 1;
    row.points += GROUP_POINTS.win;
  } else if (goalsFor === goalsAgainst) {
    row.drawn += 1;
    row.points += GROUP_POINTS.draw;
  } else {
    row.lost += 1;
  }
}

function directStats(teamId, opponents, matches, predictions) {
  const stats = { points: 0, goalDifference: 0, goalsFor: 0 };
  const opponentSet = new Set(opponents);

  for (const match of matches) {
    const homeId = match.homeTeam?.id;
    const awayId = match.awayTeam?.id;
    if (homeId !== teamId && awayId !== teamId) continue;
    const opponentId = homeId === teamId ? awayId : homeId;
    if (!opponentSet.has(opponentId)) continue;

    const prediction = predictions[match.id] ?? {};
    const homeScore = toScore(prediction.homeScore);
    const awayScore = toScore(prediction.awayScore);
    if (homeScore === null || awayScore === null) continue;

    const goalsFor = homeId === teamId ? homeScore : awayScore;
    const goalsAgainst = homeId === teamId ? awayScore : homeScore;
    stats.goalsFor += goalsFor;
    stats.goalDifference += goalsFor - goalsAgainst;
    if (goalsFor > goalsAgainst) stats.points += GROUP_POINTS.win;
    else if (goalsFor === goalsAgainst) stats.points += GROUP_POINTS.draw;
  }

  return stats;
}

function compareRows(a, b, groupMatches, predictions) {
  const globalDiff =
    b.points - a.points ||
    b.goalDifference - a.goalDifference ||
    b.goalsFor - a.goalsFor;
  if (globalDiff !== 0) return globalDiff;

  const aDirect = directStats(a.teamId, [b.teamId], groupMatches, predictions);
  const bDirect = directStats(b.teamId, [a.teamId], groupMatches, predictions);
  const directDiff =
    bDirect.points - aDirect.points ||
    bDirect.goalDifference - aDirect.goalDifference ||
    bDirect.goalsFor - aDirect.goalsFor;
  if (directDiff !== 0) return directDiff;

  return a.originalIndex - b.originalIndex;
}

export function calculateGroupStandings(group, groupMatches = [], predictions = {}) {
  const rowsByTeam = new Map((group?.teams ?? []).map((team, index) => [team.id, createEmptyRow(team, index)]));
  let completedMatches = 0;

  for (const match of groupMatches) {
    const prediction = predictions[match.id] ?? {};
    const homeScore = toScore(prediction.homeScore);
    const awayScore = toScore(prediction.awayScore);
    if (homeScore === null || awayScore === null) continue;

    const home = rowsByTeam.get(match.homeTeam?.id);
    const away = rowsByTeam.get(match.awayTeam?.id);
    if (!home || !away) continue;

    applyResult(home, homeScore, awayScore);
    applyResult(away, awayScore, homeScore);
    completedMatches += 1;
  }

  const standings = Array.from(rowsByTeam.values()).sort((a, b) =>
    compareRows(a, b, groupMatches, predictions)
  );

  standings.forEach((row, index) => {
    row.rank = index + 1;
    row.qualified = index < 2;
  });

  return {
    groupId: group?.id ?? "",
    completedMatches,
    totalMatches: groupMatches.length,
    isComplete: groupMatches.length > 0 && completedMatches === groupMatches.length,
    standings,
  };
}

export function getAutomaticQualified(standingsResult) {
  if (!standingsResult?.isComplete) {
    return { firstPlaceTeamId: null, secondPlaceTeamId: null };
  }

  return {
    firstPlaceTeamId: standingsResult.standings[0]?.teamId ?? null,
    secondPlaceTeamId: standingsResult.standings[1]?.teamId ?? null,
  };
}

function teamInfoFor(teamId, teamInfoData) {
  const teams = teamInfoData?.equipos ?? [];
  const wanted = new Set([teamId, TEAM_INFO_ALIASES[teamId]].filter(Boolean).map(slugify));
  return teams.find((team) => {
    const keys = [team.id, team.seleccion].map(slugify);
    return keys.some((key) => wanted.has(key));
  });
}

function profileScore(teamId, teamInfoData) {
  const info = teamInfoFor(teamId, teamInfoData);
  const text = [
    info?.titulo,
    info?.informacion_secundaria,
    info?.informacion_terciaria,
    info?.especial?.tipo,
    info?.especial?.fortaleza,
    info?.especial?.riesgo,
    ...(info?.especial?.tags ?? []),
  ]
    .join(" ")
    .toLowerCase();

  let attack = 0;
  let defense = 0;
  let volatility = 0;

  if (/goleador|ofensiv|ataque|creativ|talento|posesion|vertical|delantero|remate|gol/.test(text)) attack += 0.24;
  if (/balon parado|aereo|corners|centros|fisico/.test(text)) attack += 0.12;
  if (/defensa|disciplin|orden|solidez|estructura|bloque/.test(text)) defense += 0.18;
  if (/fragilidad|riesgo|dudas|vulnerable|depende|joven/.test(text)) {
    defense -= 0.12;
    volatility += 0.12;
  }
  if (/emocional|intenso|agresivo|transicion/.test(text)) volatility += 0.08;

  return { attack, defense, volatility };
}

function h2hForMatch(match, h2hData) {
  const h2hMatches = h2hData?.matches ?? [];
  return h2hMatches.find((item) =>
    item.matchNumber === match.matchNumber ||
    (item.homeTeamSlug === match.homeTeam?.id && item.awayTeamSlug === match.awayTeam?.id)
  );
}

function weightedGoal(lambda, volatility = 0) {
  const adjusted = clamp(lambda + (Math.random() - 0.5) * volatility, 0.25, 2.7);
  const weights = [0, 1, 2, 3, 4, 5].map((goals) => {
    const factorial = goals <= 1 ? 1 : goals === 2 ? 2 : goals === 3 ? 6 : goals === 4 ? 24 : 120;
    const poisson = (Math.exp(-adjusted) * adjusted ** goals) / factorial;
    const rarePenalty = goals >= 4 ? 0.48 : 1;
    return poisson * rarePenalty;
  });
  const total = weights.reduce((sum, value) => sum + value, 0);
  let roll = Math.random() * total;

  for (let goals = 0; goals < weights.length; goals += 1) {
    roll -= weights[goals];
    if (roll <= 0) return goals;
  }

  return 1;
}

function softenExtremeScore(homeScore, awayScore) {
  if (Math.abs(homeScore - awayScore) <= 4) return [homeScore, awayScore];
  if (homeScore > awayScore) return [Math.min(homeScore, awayScore + 4), awayScore];
  return [homeScore, Math.min(awayScore, homeScore + 4)];
}

export function generateWeightedRandomScores(groupMatches = [], h2hData = {}, teamInfoData = {}) {
  const generated = {};

  for (const match of groupMatches) {
    const homeProfile = profileScore(match.homeTeam?.id, teamInfoData);
    const awayProfile = profileScore(match.awayTeam?.id, teamInfoData);
    const h2h = h2hForMatch(match, h2hData)?.h2h;
    const hasHistory = h2h?.status === "has_history";
    const drawHint = /empate|igualad/.test(String(h2h?.summaryEs ?? "").toLowerCase()) ? 0.08 : 0;
    const historyCalm = hasHistory ? -0.04 : 0.04;

    const homeLambda = 1.12 + homeProfile.attack - awayProfile.defense + 0.08 + historyCalm;
    const awayLambda = 1.02 + awayProfile.attack - homeProfile.defense + historyCalm;
    const volatility = 0.24 + homeProfile.volatility + awayProfile.volatility + (hasHistory ? 0 : 0.08);

    let homeScore = weightedGoal(homeLambda, volatility);
    let awayScore = weightedGoal(awayLambda, volatility);

    if (drawHint && Math.random() < drawHint && Math.abs(homeScore - awayScore) === 1) {
      if (homeScore > awayScore) awayScore = homeScore;
      else homeScore = awayScore;
    }

    [homeScore, awayScore] = softenExtremeScore(homeScore, awayScore);
    generated[match.id] = { homeScore, awayScore };
  }

  return generated;
}
