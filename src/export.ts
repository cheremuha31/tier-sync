import { buildGameMap, getUnassignedGameIds } from "./tier-data";
import type { TierSyncSettings } from "./types";
import { formatPlaytime } from "./utils";

export function buildTierListMarkdown(settings: TierSyncSettings): string {
	const lines: string[] = [
		"# Tier sync export",
		"",
		`Exported: ${new Date().toLocaleString()}`,
		"",
	];
	const gameMap = buildGameMap(settings.games);

	for (const tier of settings.tiers) {
		lines.push(`## ${tier.name}`, "");

		const gameIds = settings.placements[tier.id] ?? [];

		if (gameIds.length === 0) {
			lines.push("- No games yet.", "");
			continue;
		}

		for (const gameId of gameIds) {
			const game = gameMap.get(gameId);

			if (!game) {
				continue;
			}

			lines.push(formatExportLine(game.name, game.playtimeMinutes));
		}

		lines.push("");
	}

	const unassignedGameIds = getUnassignedGameIds(settings.games, settings.placements);

	if (unassignedGameIds.length > 0) {
		lines.push("## Unassigned", "");

		for (const gameId of unassignedGameIds) {
			const game = gameMap.get(gameId);

			if (!game) {
				continue;
			}

			lines.push(formatExportLine(game.name, game.playtimeMinutes));
		}

		lines.push("");
	}

	return `${lines.join("\n").trim()}\n`;
}

function formatExportLine(name: string, playtimeMinutes: number | null): string {
	const playtime = formatPlaytime(playtimeMinutes);

	return playtime ? `- ${name} (${playtime})` : `- ${name}`;
}

export function createExportFileName(date = new Date()): string {
	const year = date.getFullYear();
	const month = `${date.getMonth() + 1}`.padStart(2, "0");
	const day = `${date.getDate()}`.padStart(2, "0");
	const hours = `${date.getHours()}`.padStart(2, "0");
	const minutes = `${date.getMinutes()}`.padStart(2, "0");
	const seconds = `${date.getSeconds()}`.padStart(2, "0");

	return `Tier sync ${year}-${month}-${day} ${hours}-${minutes}-${seconds}.md`;
}
