import { Notice, Plugin, normalizePath } from "obsidian";
import { registerCommands } from "./commands";
import { BACKLOG_TIER_ID, LEGACY_BOARD_DATA_FILE_PATH, VIEW_TYPE_TIER_SYNC } from "./constants";
import { buildTierListMarkdown, createExportFileName } from "./export";
import {
	buildGameIdSet,
	createDefaultSettings,
	createNextTierName,
	createTierDefinition,
	findFallbackTierId,
	migrateBoardData,
	migrateSettings,
	moveTier,
	normalizePlacements,
	formatExcludedAppIds,
	parseExcludedAppIds,
} from "./settings";
import {
	fetchOwnedGames,
	fetchOwnedGamesByAppIds,
	fetchStoreHeaderImageUrl,
} from "./steam/steam-client";
import { filterExcludedGames, reconcilePlacements } from "./tier-data";
import type {
	CustomGameSearchResult,
	SteamGame,
	SteamStoreSearchResult,
	TierSyncSettings,
} from "./types";
import { GameSearchModal } from "./ui/game-search-modal";
import { TierSyncSettingTab } from "./ui/settings-tab";
import { TierSyncView } from "./ui/tier-sync-view";

export default class TierSyncPlugin extends Plugin {
	settings: TierSyncSettings = createDefaultSettings();
	syncInProgress = false;
	private readonly headerImageRequests = new Map<number, Promise<string | null>>();
	private readonly resolvedHeaderImages = new Map<number, string | null>();
	private externalSettingsReloadInProgress = false;

	async onload(): Promise<void> {
		await this.loadSettings();
		await this.migrateLegacyBoardFileIfNeeded();
		this.settings.placements = reconcilePlacements(
			this.settings.tiers,
			this.getVisibleGames(),
			this.settings.placements,
		);

		this.registerView(
			VIEW_TYPE_TIER_SYNC,
			(leaf) => new TierSyncView(leaf, this),
		);
		this.addRibbonIcon("gamepad-2", "Open board", () => {
			void this.activateView();
		});
		registerCommands(this);
		this.addSettingTab(new TierSyncSettingTab(this.app, this));
	}

	onunload(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TIER_SYNC)) {
			leaf.detach();
		}
	}

	async activateView(): Promise<void> {
		let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIER_SYNC)[0];

		if (!leaf) {
			leaf = this.app.workspace.getLeaf("tab");
			await leaf.setViewState({
				type: VIEW_TYPE_TIER_SYNC,
				active: true,
			});
		}

		await this.app.workspace.revealLeaf(leaf);
	}

	async syncSteamLibrary(options?: { revealView?: boolean }): Promise<void> {
		if (this.syncInProgress) {
			return;
		}

		this.syncInProgress = true;
		this.refreshViews();

		try {
			const { resolvedSteamId, games } = await fetchOwnedGames(
				this.settings.steamApiKey,
				this.settings.steamId,
				this.settings.minPlaytime,
			);
			const supplementalOwnedGames = await fetchOwnedGamesByAppIds(
				this.settings.steamApiKey,
				resolvedSteamId,
				this.getManualSteamAppIdsMissingFromSync(games),
			);

			this.settings.steamId = resolvedSteamId;
			this.settings.games = this.mergeSyncedGames(games, supplementalOwnedGames);
			const visibleGames = this.getVisibleGames();
			this.settings.placements = reconcilePlacements(
				this.settings.tiers,
				visibleGames,
				this.settings.placements,
			);
			await this.saveSettings();

			if (options?.revealView) {
				await this.activateView();
			}

			new Notice(
				games.length > 0
					? `Synced ${games.length} games from Steam.`
					: "Steam sync completed. No games matched the current filter.",
			);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Steam sync failed.";
			new Notice(message, 8000);
		} finally {
			this.syncInProgress = false;
			this.refreshViews();
		}
	}

	async exportTierListMarkdown(): Promise<void> {
		const visibleGames = this.getVisibleGames();

		if (visibleGames.length === 0) {
			new Notice("Sync the library before exporting.");
			return;
		}

		const filePath = this.getAvailableExportPath(createExportFileName());
		const markdown = buildTierListMarkdown({
			...this.settings,
			games: visibleGames,
		});

		await this.app.vault.create(filePath, markdown);
		new Notice(`Created ${filePath}.`);
	}

	hasSteamCredentials(): boolean {
		return (
			this.settings.steamApiKey.trim().length > 0 &&
			this.settings.steamId.trim().length > 0
		);
	}

	hasBacklogTier(): boolean {
		return this.settings.tiers.some((tier) => tier.id === BACKLOG_TIER_ID);
	}

	getVisibleGames(): SteamGame[] {
		return filterExcludedGames(this.settings.games, this.settings.excludedAppIds);
	}

	getManualGames(): SteamGame[] {
		return this.settings.games
			.filter((game) => game.isManual)
			.slice()
			.sort(compareGamesByName);
	}

	openAddSteamGameModal(onComplete?: () => void): void {
		new GameSearchModal(this.app, {
			kind: "steam",
			onSelect: async (result) => {
				await this.addManualSteamGame(result);
				onComplete?.();
			},
		}).open();
	}

	openAddCustomGameModal(onComplete?: () => void): void {
		new GameSearchModal(this.app, {
			kind: "custom",
			rawgApiKey: this.settings.rawgApiKey,
			onSelect: async (result) => {
				await this.addCustomGame(result);
				onComplete?.();
			},
		}).open();
	}

	async resolveGameHeaderImage(
		game: SteamGame,
		forceRefresh = false,
	): Promise<string | null> {
		const storedHeaderImageUrl = normalizeHeaderImageUrl(game.headerImageUrl);
		const steamAppId = getSteamAppId(game);

		if (game.source !== "steam" || !steamAppId) {
			return storedHeaderImageUrl;
		}

		if (storedHeaderImageUrl && !forceRefresh) {
			return storedHeaderImageUrl;
		}

		if (!forceRefresh && this.resolvedHeaderImages.has(steamAppId)) {
			return this.resolvedHeaderImages.get(steamAppId) ?? null;
		}

		const existingRequest = this.headerImageRequests.get(steamAppId);

		if (existingRequest) {
			return existingRequest;
		}

		const request = this.fetchAndCacheHeaderImage(game, steamAppId);

		this.headerImageRequests.set(steamAppId, request);

		try {
			return await request;
		} finally {
			this.headerImageRequests.delete(steamAppId);
		}
	}

	getExcludedAppIdsText(): string {
		return formatExcludedAppIds(this.settings.excludedAppIds);
	}

	getTierSize(tierId: string): number {
		return this.settings.placements[tierId]?.length ?? 0;
	}

	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TIER_SYNC)) {
			const view = leaf.view;

			if (view instanceof TierSyncView) {
				view.refresh();
			}
		}
	}

	async updateSteamApiKey(value: string): Promise<void> {
		this.settings.steamApiKey = value.trim();
		await this.saveSettings();
	}

	async updateSteamId(value: string): Promise<void> {
		this.settings.steamId = value.trim();
		await this.saveSettings();
	}

	async updateRawgApiKey(value: string): Promise<void> {
		this.settings.rawgApiKey = value.trim();
		await this.saveSettings();
	}

	async updateMinPlaytime(value: number): Promise<void> {
		this.settings.minPlaytime = Math.max(0, Math.trunc(value));
		await this.saveSettings();
		this.refreshViews();
	}

	async updateExcludedAppIds(value: string): Promise<void> {
		this.settings.excludedAppIds = parseExcludedAppIds(value);
		this.settings.placements = reconcilePlacements(
			this.settings.tiers,
			this.getVisibleGames(),
			this.settings.placements,
		);
		await this.saveSettings();
		this.refreshViews();
	}

	async updateCardDetailsMode(
		value: TierSyncSettings["cardDetails"],
	): Promise<void> {
		this.settings.cardDetails = value;
		await this.saveSettings();
		this.refreshViews();
	}

	async updateCardSize(
		value: number,
	): Promise<void> {
		this.settings.cardSize = Math.max(70, Math.min(400, Math.round(value)));
		await this.saveSettings();
		this.refreshViews();
	}

	async updateAutoTierTextColor(value: boolean): Promise<void> {
		this.settings.autoTierTextColor = value;
		await this.saveSettings();
		this.refreshViews();
	}

	async clearExcludedAppIds(): Promise<void> {
		if (this.settings.excludedAppIds.length === 0) {
			return;
		}

		this.settings.excludedAppIds = [];
		this.settings.placements = reconcilePlacements(
			this.settings.tiers,
			this.getVisibleGames(),
			this.settings.placements,
		);
		await this.saveSettings();
		this.refreshViews();
	}

	async excludeGameFromSync(gameId: number): Promise<void> {
		if (this.settings.excludedAppIds.includes(gameId)) {
			return;
		}

		this.settings.excludedAppIds = this.settings.excludedAppIds
			.concat(gameId)
			.sort((left, right) => left - right);
		this.settings.placements = reconcilePlacements(
			this.settings.tiers,
			this.getVisibleGames(),
			this.settings.placements,
		);
		await this.saveSettings();
		this.refreshViews();
		new Notice("Game excluded from sync.");
	}

	async addManualSteamGame(result: SteamStoreSearchResult): Promise<void> {
		const existingGame = this.findSteamGameByAppId(result.appId);
		const headerImageUrl = await fetchStoreHeaderImageUrl(result.appId)
			?? normalizeHeaderImageUrl(result.tinyImageUrl);

		if (existingGame) {
			existingGame.name = result.name;
			existingGame.source = "steam";
			existingGame.steamAppId = result.appId;
			existingGame.platform = "Steam";
			existingGame.externalUrl = result.storeUrl;
			existingGame.isManual = true;
			existingGame.headerImageUrl = headerImageUrl ?? existingGame.headerImageUrl ?? null;
		} else {
			this.settings.games = this.settings.games.concat({
				appId: result.appId,
				source: "steam",
				steamAppId: result.appId,
				name: result.name,
				platform: "Steam",
				playtimeMinutes: null,
				lastPlayedAt: null,
				headerImageUrl,
				externalUrl: result.storeUrl,
				isManual: true,
				isSynced: false,
			});
		}

		this.settings.games = this.settings.games.slice().sort(compareGamesByName);
		this.settings.placements = reconcilePlacements(
			this.settings.tiers,
			this.getVisibleGames(),
			this.settings.placements,
		);
		await this.saveSettings();
		this.refreshViews();
		new Notice(`Added ${result.name}.`);
	}

	async addCustomGame(result: CustomGameSearchResult): Promise<void> {
		const normalizedName = result.title.trim();

		if (!normalizedName) {
			throw new Error("Choose a result with a valid title.");
		}

		const existingCustomGame = this.settings.games.find((game) =>
			game.source === "custom" &&
			game.name.localeCompare(normalizedName, undefined, { sensitivity: "base" }) === 0,
		);

		if (existingCustomGame) {
			throw new Error("This non-Steam game is already on the board.");
		}

		this.settings.games = this.settings.games.concat({
			appId: createCustomGameId(this.settings.games),
			source: "custom",
			steamAppId: null,
			name: normalizedName,
			platform: result.platformLabel ?? "Other platform",
			playtimeMinutes: null,
			lastPlayedAt: null,
			headerImageUrl: normalizeHeaderImageUrl(result.imageUrl),
			externalUrl: normalizeHeaderImageUrl(result.pageUrl),
			isManual: true,
			isSynced: false,
		});
		this.settings.games = this.settings.games.slice().sort(compareGamesByName);
		this.settings.placements = reconcilePlacements(
			this.settings.tiers,
			this.getVisibleGames(),
			this.settings.placements,
		);
		await this.saveSettings();
		this.refreshViews();
		new Notice(`Added ${normalizedName}.`);
	}

	async removeManualGame(gameId: number): Promise<void> {
		const game = this.settings.games.find((entry) => entry.appId === gameId);

		if (!game || !game.isManual) {
			return;
		}

		if (game.source === "steam" && game.isSynced) {
			game.isManual = false;
		} else {
			this.settings.games = this.settings.games.filter((entry) => entry.appId !== gameId);
		}

		this.settings.placements = reconcilePlacements(
			this.settings.tiers,
			this.getVisibleGames(),
			this.settings.placements,
		);
		await this.saveSettings();
		this.refreshViews();
		new Notice(game.source === "steam" && game.isSynced ? "Removed manual add." : "Removed game.");
	}

	async addTier(): Promise<void> {
		const tierName = createNextTierName(this.settings.tiers);
		const nextTier = createTierDefinition(tierName, this.settings.tiers);

		this.settings.tiers = this.settings.tiers.concat(nextTier);
		this.settings.placements = normalizePlacements(
			this.settings.placements,
			this.settings.tiers,
			this.getValidGameIdSet(),
		);
		await this.saveSettings();
		this.refreshViews();
	}

	async renameTier(tierId: string, nextName: string): Promise<void> {
		const normalizedName = nextName.trim();

		if (!normalizedName) {
			return;
		}

		this.settings.tiers = this.settings.tiers.map((tier) =>
			tier.id === tierId ? { ...tier, name: normalizedName } : tier,
		);
		await this.saveSettings();
		this.refreshViews();
	}

	async updateTierColor(tierId: string, nextColor: string): Promise<void> {
		this.settings.tiers = this.settings.tiers.map((tier) =>
			tier.id === tierId ? { ...tier, color: nextColor } : tier,
		);
		await this.saveSettings();
		this.refreshViews();
	}

	async moveTier(tierId: string, direction: -1 | 1): Promise<void> {
		this.settings.tiers = moveTier(this.settings.tiers, tierId, direction);
		await this.saveSettings();
		this.refreshViews();
	}

	async removeTier(tierId: string): Promise<boolean> {
		if (this.settings.tiers.length <= 1) {
			return false;
		}

		const fallbackTierId = findFallbackTierId(this.settings.tiers, tierId);
		const removedGameIds = this.settings.placements[tierId] ?? [];
		const nextTiers = this.settings.tiers.filter((tier) => tier.id !== tierId);
		const nextPlacements = normalizePlacements(
			this.settings.placements,
			nextTiers,
			this.getValidGameIdSet(),
		);

		if (fallbackTierId && nextPlacements[fallbackTierId]) {
			const existingIds = new Set<number>(nextPlacements[fallbackTierId]);

			for (const gameId of removedGameIds) {
				if (!existingIds.has(gameId)) {
					nextPlacements[fallbackTierId].push(gameId);
					existingIds.add(gameId);
				}
			}
		}

		this.settings.tiers = nextTiers;
		this.settings.placements = nextPlacements;
		await this.saveSettings();
		this.refreshViews();

		new Notice(
			fallbackTierId
				? "Removed tier and moved its games to another row."
				: "Removed tier.",
		);

	return true;
	}

	async onExternalSettingsChange(): Promise<void> {
		if (this.externalSettingsReloadInProgress) {
			return;
		}

		this.externalSettingsReloadInProgress = true;

		try {
			await this.reloadSettingsFromDisk();
		} finally {
			this.externalSettingsReloadInProgress = false;
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = migrateSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private async reloadSettingsFromDisk(): Promise<void> {
		const nextSettings = migrateSettings(await this.loadData());

		nextSettings.placements = reconcilePlacements(
			nextSettings.tiers,
			filterExcludedGames(nextSettings.games, nextSettings.excludedAppIds),
			nextSettings.placements,
		);

		this.settings = nextSettings;
		this.refreshViews();
	}

	private async migrateLegacyBoardFileIfNeeded(): Promise<void> {
		const legacyBoardFilePath = normalizePath(LEGACY_BOARD_DATA_FILE_PATH);

		if (!(await this.app.vault.adapter.exists(legacyBoardFilePath))) {
			return;
		}

		try {
			const rawLegacyBoardData = JSON.parse(
				await this.app.vault.adapter.read(legacyBoardFilePath),
			) as unknown;

			this.settings = {
				...this.settings,
				...migrateBoardData(rawLegacyBoardData),
			};
			this.settings.placements = reconcilePlacements(
				this.settings.tiers,
				this.getVisibleGames(),
				this.settings.placements,
			);
			await this.saveSettings();
			await this.removeLegacyBoardFile(legacyBoardFilePath);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Could not migrate the old board file.";
			new Notice(`${message} Check ${legacyBoardFilePath}.`, 8000);
		}
	}

	private async removeLegacyBoardFile(filePath: string): Promise<void> {
		await this.app.vault.adapter.remove(filePath);

		const parentPath = getParentPath(filePath);

		if (!parentPath || !(await this.app.vault.adapter.exists(parentPath))) {
			return;
		}

		const listing = await this.app.vault.adapter.list(parentPath);

		if (listing.files.length === 0 && listing.folders.length === 0) {
			await this.app.vault.adapter.rmdir(parentPath, false);
		}
	}

	private getValidGameIdSet(): Set<number> | undefined {
		const visibleGames = this.getVisibleGames();

		return visibleGames.length > 0
			? buildGameIdSet(visibleGames)
			: undefined;
	}

	private async fetchAndCacheHeaderImage(
		game: SteamGame,
		steamAppId: number,
	): Promise<string | null> {
		try {
			const headerImageUrl = await fetchStoreHeaderImageUrl(steamAppId);

			this.resolvedHeaderImages.set(steamAppId, headerImageUrl);

			if (!headerImageUrl) {
				return null;
			}

			await this.storeGameHeaderImage(game, headerImageUrl);

			return headerImageUrl;
		} catch {
			return null;
		}
	}

	private async storeGameHeaderImage(
		game: SteamGame,
		headerImageUrl: string,
	): Promise<void> {
		const normalizedHeaderImageUrl = normalizeHeaderImageUrl(headerImageUrl);

		if (!normalizedHeaderImageUrl) {
			return;
		}

		game.headerImageUrl = normalizedHeaderImageUrl;

		let didUpdate = false;

		for (const existingGame of this.settings.games) {
			if (existingGame.appId !== game.appId) {
				continue;
			}

			if (existingGame.headerImageUrl === normalizedHeaderImageUrl) {
				return;
			}

			existingGame.headerImageUrl = normalizedHeaderImageUrl;
			didUpdate = true;
			break;
		}

		if (didUpdate) {
			await this.saveSettings();
		}
	}

	private mergeSyncedGames(
		games: SteamGame[],
		supplementalOwnedGames: Map<number, SteamGame>,
	): SteamGame[] {
		const customGames: SteamGame[] = [];
		const existingSteamGames = new Map<number, SteamGame>();
		const mergedGames: SteamGame[] = [];
		const syncedSteamIds = new Set<number>();

		for (const game of this.settings.games) {
			if (game.source === "custom") {
				customGames.push(game);
				continue;
			}

			const steamAppId = getSteamAppId(game);

			if (steamAppId) {
				existingSteamGames.set(steamAppId, game);
			}
		}

		for (const game of games) {
			const steamAppId = getSteamAppId(game);

			if (!steamAppId) {
				continue;
			}

			syncedSteamIds.add(steamAppId);

			const existingGame = existingSteamGames.get(steamAppId);

			mergedGames.push({
				...game,
				source: "steam",
				steamAppId,
				platform: "Steam",
				headerImageUrl: normalizeHeaderImageUrl(existingGame?.headerImageUrl)
					?? normalizeHeaderImageUrl(game.headerImageUrl),
				externalUrl: existingGame?.externalUrl ?? game.externalUrl,
				playtimeMinutes: mergePlaytimeMinutes(game.playtimeMinutes, existingGame?.playtimeMinutes),
				isManual: existingGame?.isManual ?? false,
				isSynced: true,
			});
		}

		for (const existingGame of existingSteamGames.values()) {
			const steamAppId = getSteamAppId(existingGame);

			if (!steamAppId || !existingGame.isManual || syncedSteamIds.has(steamAppId)) {
				continue;
			}

			const supplementalGame = supplementalOwnedGames.get(steamAppId);

			mergedGames.push({
				...(supplementalGame ?? existingGame),
				source: "steam",
				steamAppId,
				name: supplementalGame?.name ?? existingGame.name,
				platform: supplementalGame?.platform ?? existingGame.platform ?? "Steam",
				lastPlayedAt: supplementalGame?.lastPlayedAt ?? existingGame.lastPlayedAt,
				headerImageUrl: normalizeHeaderImageUrl(existingGame.headerImageUrl)
					?? normalizeHeaderImageUrl(supplementalGame?.headerImageUrl),
				externalUrl: existingGame.externalUrl ?? supplementalGame?.externalUrl ?? null,
				playtimeMinutes: normalizeManualSteamPlaytime(
					existingGame.playtimeMinutes,
					supplementalGame?.playtimeMinutes,
				),
				isManual: true,
				isSynced: false,
			});
		}

		return customGames.concat(mergedGames).sort(compareGamesByName);
	}

	private findSteamGameByAppId(appId: number): SteamGame | undefined {
		return this.settings.games.find((game) => getSteamAppId(game) === appId);
	}

	private getManualSteamAppIdsMissingFromSync(syncedGames: SteamGame[]): number[] {
		const syncedSteamIds = new Set<number>();

		for (const game of syncedGames) {
			const steamAppId = getSteamAppId(game);

			if (steamAppId) {
				syncedSteamIds.add(steamAppId);
			}
		}

		const manualSteamIds = new Set<number>();

		for (const game of this.settings.games) {
			if (!game.isManual || game.source !== "steam") {
				continue;
			}

			const steamAppId = getSteamAppId(game);

			if (steamAppId && !syncedSteamIds.has(steamAppId)) {
				manualSteamIds.add(steamAppId);
			}
		}

		return Array.from(manualSteamIds);
	}

	private getAvailableExportPath(baseName: string): string {
		const extensionIndex = baseName.lastIndexOf(".");
		const stem = extensionIndex === -1 ? baseName : baseName.slice(0, extensionIndex);
		const extension = extensionIndex === -1 ? "" : baseName.slice(extensionIndex);
		let counter = 1;

		while (true) {
			const suffix = counter === 1 ? "" : ` ${counter}`;
			const candidate = normalizePath(`${stem}${suffix}${extension}`);

			if (!this.app.vault.getAbstractFileByPath(candidate)) {
				return candidate;
			}

			counter += 1;
		}
	}
}

function normalizeHeaderImageUrl(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const normalizedValue = value.trim();

	return normalizedValue.length > 0 ? normalizedValue : null;
}

function getSteamAppId(game: SteamGame): number | null {
	if (game.source !== "steam") {
		return null;
	}

	return typeof game.steamAppId === "number" && game.steamAppId > 0
		? game.steamAppId
		: game.appId;
}

function createCustomGameId(games: SteamGame[]): number {
	const customIds = games
		.filter((game) => game.source === "custom")
		.map((game) => game.appId);
	const nextCustomId = customIds.length > 0
		? Math.max(...customIds, CUSTOM_GAME_ID_START - 1) + 1
		: CUSTOM_GAME_ID_START;

	return nextCustomId;
}

function compareGamesByName(left: SteamGame, right: SteamGame): number {
	return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

function getParentPath(path: string): string | null {
	const normalizedPath = normalizePath(path);
	const separatorIndex = normalizedPath.lastIndexOf("/");

	return separatorIndex === -1 ? null : normalizedPath.slice(0, separatorIndex);
}

function mergePlaytimeMinutes(
	syncedPlaytime: number | null,
	existingPlaytime: number | null | undefined,
): number | null {
	const candidates = [syncedPlaytime, existingPlaytime ?? null]
		.filter((value): value is number => typeof value === "number" && Number.isFinite(value));

	if (candidates.length === 0) {
		return null;
	}

	return Math.max(...candidates);
}

function normalizeManualSteamPlaytime(
	existingPlaytime: number | null,
	supplementalPlaytime?: number | null,
): number | null {
	if (typeof supplementalPlaytime === "number" && Number.isFinite(supplementalPlaytime)) {
		return supplementalPlaytime;
	}

	if (typeof existingPlaytime === "number" && existingPlaytime > 0) {
		return existingPlaytime;
	}

	return null;
}

const CUSTOM_GAME_ID_START = 2_000_000_000;
