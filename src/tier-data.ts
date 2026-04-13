import { BACKLOG_TIER_ID } from "./constants";
import { normalizePlacements } from "./settings";
import type { SteamGame, TierDefinition } from "./types";

export function filterExcludedGames(
	games: SteamGame[],
	excludedAppIds: number[],
): SteamGame[] {
	if (excludedAppIds.length === 0) {
		return games.slice();
	}

	const excludedIds = new Set<number>(excludedAppIds);

	return games.filter((game) => {
		if (game.source !== "steam") {
			return true;
		}

		const steamAppId = typeof game.steamAppId === "number" && game.steamAppId > 0
			? game.steamAppId
			: game.appId;

		return !excludedIds.has(steamAppId);
	});
}

export function reconcilePlacements(
	tiers: TierDefinition[],
	games: SteamGame[],
	currentPlacements: Record<string, number[]>,
): Record<string, number[]> {
	const validGameIds = buildGameIdSet(games);
	const nextPlacements = normalizePlacements(currentPlacements, tiers, validGameIds);
	const placedIds = new Set<number>(getPlacedGameIds(nextPlacements));
	const backlogTier = tiers.find((tier) => tier.id === BACKLOG_TIER_ID);

	if (!backlogTier) {
		return nextPlacements;
	}

	const backlogPlacements = nextPlacements[backlogTier.id];

	if (!backlogPlacements) {
		return nextPlacements;
	}

	for (const gameId of getUnassignedGameIds(games, nextPlacements)) {
		if (placedIds.has(gameId)) {
			continue;
		}

		backlogPlacements.push(gameId);
		placedIds.add(gameId);
	}

	return nextPlacements;
}

export function getUnassignedGameIds(
	games: SteamGame[],
	placements: Record<string, number[]>,
): number[] {
	const placedIds = new Set<number>(getPlacedGameIds(placements));
	const unassignedGames = games
		.filter((game) => !placedIds.has(game.appId))
		.slice();

	unassignedGames.sort((left, right) =>
		left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
	);

	return unassignedGames.map((game) => game.appId);
}

export function buildGameMap(games: SteamGame[]): Map<number, SteamGame> {
	const gameMap = new Map<number, SteamGame>();

	for (const game of games) {
		gameMap.set(game.appId, game);
	}

	return gameMap;
}

export function buildGameIdSet(games: SteamGame[]): Set<number> {
	const ids = new Set<number>();

	for (const game of games) {
		ids.add(game.appId);
	}

	return ids;
}

function getPlacedGameIds(placements: Record<string, number[]>): number[] {
	const ids: number[] = [];

	for (const tierIds of Object.values(placements)) {
		for (const gameId of tierIds) {
			ids.push(gameId);
		}
	}

	return ids;
}
