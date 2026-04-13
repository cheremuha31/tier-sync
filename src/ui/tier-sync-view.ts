import { ItemView, Menu, WorkspaceLeaf } from "obsidian";
import Sortable from "sortablejs";
import type TierSyncPlugin from "../main";
import {
	UNASSIGNED_SECTION_ID,
	VIEW_TYPE_TIER_SYNC,
} from "../constants";
import { buildGameMap, getUnassignedGameIds } from "../tier-data";
import type { SteamGame, TierDefinition } from "../types";
import {
	formatPlaytime,
	getReadableTextColor,
	getSteamHeaderImageUrl,
} from "../utils";

export class TierSyncView extends ItemView {
	private readonly plugin: TierSyncPlugin;
	private searchQuery = "";
	private sortables: Sortable[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: TierSyncPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_TIER_SYNC;
	}

	getDisplayText(): string {
		return "Tier sync";
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	async onClose(): Promise<void> {
		this.destroySortables();
	}

	refresh(): void {
		this.render();
	}

	private render(): void {
		this.destroySortables();

		const { contentEl } = this;
		const visibleGames = this.plugin.getVisibleGames();
		const query = this.searchQuery.toLowerCase();
		const isFiltering = query.length > 0;
		const gameMap = buildGameMap(visibleGames);
		const unassignedGameIds = this.plugin.hasBacklogTier()
			? []
			: getUnassignedGameIds(visibleGames, this.plugin.settings.placements);

		contentEl.empty();
		contentEl.addClass("tier-sync-view");
		this.applyCardSizeVariables(contentEl);

		const header = contentEl.createDiv({ cls: "tier-sync-header" });
		const titleGroup = header.createDiv({ cls: "tier-sync-header-copy" });
		titleGroup.createEl("h2", { text: "Tier sync" });
		titleGroup.createEl("p", {
			cls: "tier-sync-subtitle",
			text: this.getSummaryText(visibleGames.length, unassignedGameIds.length),
		});

		const actions = header.createDiv({ cls: "tier-sync-actions" });
		const searchInput = actions.createEl("input", {
			cls: "tier-sync-search",
			attr: {
				type: "search",
				placeholder: "Filter games",
				"aria-label": "Filter games",
			},
		});
		if (searchInput instanceof HTMLInputElement) {
			searchInput.value = this.searchQuery;
			searchInput.addEventListener("input", () => {
				this.searchQuery = searchInput.value.trim();
				this.render();
			});
		}

		const syncButton = actions.createEl("button", {
			text: this.plugin.syncInProgress ? "Syncing..." : "Sync from Steam",
			cls: "mod-cta",
		});
		syncButton.disabled = this.plugin.syncInProgress;
		syncButton.addEventListener("click", () => {
			void this.plugin.syncSteamLibrary();
		});

		const exportButton = actions.createEl("button", {
			text: "Export as Markdown",
		});
		exportButton.disabled = visibleGames.length === 0;
		exportButton.addEventListener("click", () => {
			void this.plugin.exportTierListMarkdown();
		});

		if (!this.plugin.hasSteamCredentials() && this.plugin.settings.games.length === 0) {
			this.renderMessage(
				contentEl,
				"Add your Steam Web API key and Steam ID in the plugin settings, then run a sync.",
			);
		}

		if (visibleGames.length === 0) {
			const emptyMessage = this.plugin.settings.games.length > 0
				? "No games are visible. Check the playtime filter or excluded game IDs."
				: "No games loaded yet. Sync your Steam library to populate the board.";

			this.renderMessage(
				contentEl,
				emptyMessage,
			);
			return;
		}

		if (isFiltering) {
			contentEl.createEl("p", {
				cls: "tier-sync-filter-note",
				text: "Drag and drop is disabled while a filter is active.",
			});
		}

		const board = contentEl.createDiv({ cls: "tier-sync-board" });
		let renderedRows = 0;

		for (const tier of this.plugin.settings.tiers) {
			const allIds = this.plugin.settings.placements[tier.id] ?? [];
			const visibleIds = isFiltering
				? this.filterGameIds(allIds, gameMap, query)
				: allIds;

			if (isFiltering && visibleIds.length === 0) {
				continue;
			}

			this.renderTierRow(board, tier, visibleIds, gameMap, isFiltering);
			renderedRows += 1;
		}

		const visibleUnassignedIds = isFiltering
			? this.filterGameIds(unassignedGameIds, gameMap, query)
			: unassignedGameIds;

		if (visibleUnassignedIds.length > 0) {
			this.renderTierRow(
				board,
				{
					id: UNASSIGNED_SECTION_ID,
					name: "Unassigned",
					color: "#64748b",
				},
				visibleUnassignedIds,
				gameMap,
				isFiltering,
			);
			renderedRows += 1;
		}

		if (renderedRows === 0) {
			this.renderMessage(contentEl, "No games match the current filter.");
		}
	}

	private renderTierRow(
		board: HTMLElement,
		tier: TierDefinition,
		gameIds: number[],
		gameMap: Map<number, SteamGame>,
		isFiltering: boolean,
	): void {
		const row = board.createDiv({ cls: "tier-sync-row" });
		const label = row.createDiv({ cls: "tier-sync-label" });
		const tierTextColor = this.plugin.settings.autoTierTextColor
			? getReadableTextColor(tier.color)
			: "#111827";

		label.style.setProperty("--tier-color", tier.color);
		label.style.setProperty("--tier-text-color", tierTextColor);

		label.createEl("span", { text: tier.name, cls: "tier-sync-label-name" });

		const items = row.createDiv({ cls: "tier-sync-items" });
		items.setAttribute("data-tier-id", tier.id);

		for (const gameId of gameIds) {
			const game = gameMap.get(gameId);

			if (!game) {
				continue;
			}

			this.renderGameCard(items, game);
		}

		if (!isFiltering) {
			this.initializeSortable(items);
		}
	}

	private renderGameCard(container: HTMLElement, game: SteamGame): void {
		const card = container.createDiv({ cls: "tier-sync-card" });
		const cardDetailsMode = this.plugin.settings.cardDetails;
		const initialImageUrl = this.getInitialImageUrl(game);
		const playtimeText = formatPlaytime(game.playtimeMinutes);
		let resolvedFallback = false;

		card.setAttribute("data-app-id", `${game.appId}`);
		card.setAttribute("aria-label", game.name);
		card.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			this.openGameMenu(event, game);
		});

		if (!initialImageUrl) {
			card.addClass("is-image-missing");
		}

		if (initialImageUrl) {
			const image = card.createEl("img", {
				attr: {
					src: initialImageUrl,
					alt: game.name,
					loading: "lazy",
				},
			});

			image.addEventListener("load", () => {
				image.removeClass("tier-sync-image-fallback");
				card.removeClass("is-image-missing");
			});

			image.addEventListener("error", () => {
				if (resolvedFallback) {
					image.addClass("tier-sync-image-fallback");
					card.addClass("is-image-missing");
					return;
				}

				resolvedFallback = true;
				void this.recoverGameCardImage(card, image, game);
			});
		}

		if (cardDetailsMode !== "none") {
			const overlay = card.createDiv({ cls: "tier-sync-card-overlay" });

			if (cardDetailsMode === "title" || cardDetailsMode === "both") {
				overlay.createEl("span", {
					text: game.name,
					cls: "tier-sync-card-title",
				});
			}

			if (
				(cardDetailsMode === "playtime" || cardDetailsMode === "both") &&
				playtimeText
			) {
				overlay.createEl("span", {
					text: playtimeText,
					cls: "tier-sync-card-playtime",
				});
			}
		}
	}

	private async recoverGameCardImage(
		card: HTMLElement,
		image: HTMLImageElement,
		game: SteamGame,
	): Promise<void> {
		const fallbackImageUrl = await this.plugin.resolveGameHeaderImage(game, true);
		const currentImageUrl = image.getAttribute("src") ?? "";

		if (!fallbackImageUrl || fallbackImageUrl === currentImageUrl) {
			image.addClass("tier-sync-image-fallback");
			card.addClass("is-image-missing");
			return;
		}

		image.removeClass("tier-sync-image-fallback");
		card.removeClass("is-image-missing");
		image.setAttribute("src", fallbackImageUrl);
	}

	private initializeSortable(items: HTMLElement): void {
		const sortable = Sortable.create(items, {
			group: "tier-sync-board",
			animation: 70,
			draggable: ".tier-sync-card",
			ghostClass: "tier-sync-ghost",
			dragClass: "tier-sync-dragging",
			onEnd: () => {
				void this.saveNewOrder();
			},
		});

		this.sortables.push(sortable);
	}

	private async saveNewOrder(): Promise<void> {
		const nextPlacements: Record<string, number[]> = {};

		for (const tier of this.plugin.settings.tiers) {
			nextPlacements[tier.id] = [];
		}

		const containers = Array.from(
			this.contentEl.querySelectorAll(".tier-sync-items[data-tier-id]"),
		);

		for (const container of containers) {
			if (!(container instanceof HTMLElement)) {
				continue;
			}

			const tierId = container.getAttribute("data-tier-id");

			if (!tierId || tierId === UNASSIGNED_SECTION_ID || !(tierId in nextPlacements)) {
				continue;
			}

			const ids: number[] = [];
			const cards = Array.from(
				container.querySelectorAll(".tier-sync-card[data-app-id]"),
			);

			for (const card of cards) {
				if (!(card instanceof HTMLElement)) {
					continue;
				}

				const rawAppId = card.getAttribute("data-app-id");

				if (!rawAppId) {
					continue;
				}

				const appId = Number.parseInt(rawAppId, 10);

				if (!Number.isNaN(appId)) {
					ids.push(appId);
				}
			}

			nextPlacements[tierId] = ids;
		}

		this.plugin.settings.placements = nextPlacements;
		await this.plugin.saveSettings();
	}

	private filterGameIds(
		gameIds: number[],
		gameMap: Map<number, SteamGame>,
		query: string,
	): number[] {
		return gameIds.filter((gameId) => {
			const game = gameMap.get(gameId);

			return game ? game.name.toLowerCase().includes(query) : false;
		});
	}

	private getSummaryText(totalGames: number, unassignedCount: number): string {
		const placedGames = totalGames - unassignedCount;
		const sections = [`${totalGames} games`, `${placedGames} placed`];

		if (unassignedCount > 0) {
			sections.push(`${unassignedCount} unassigned`);
		}

		return sections.join(" | ");
	}

	private renderMessage(container: HTMLElement, message: string): void {
		container.createDiv({ cls: "tier-sync-message", text: message });
	}

	private applyCardSizeVariables(container: HTMLElement): void {
		const scale = this.plugin.settings.cardSize / 100;
		const labelWidth = Math.max(4.4, 5.75 * scale);
		const cardWidth = Math.max(5.2, 7.1 * scale);
		const cardWidthMobile = Math.max(4.75, 5.95 * scale);

		container.style.setProperty("--tier-sync-label-width", `${labelWidth.toFixed(2)}rem`);
		container.style.setProperty("--tier-sync-card-width", `${cardWidth.toFixed(2)}rem`);
		container.style.setProperty(
			"--tier-sync-card-width-mobile",
			`${cardWidthMobile.toFixed(2)}rem`,
		);
	}

	private openGameMenu(event: MouseEvent, game: SteamGame): void {
		const menu = new Menu();

		if (game.isManual) {
			menu.addItem((item) => {
				item
					.setTitle(game.source === "steam" && game.isSynced ? "Remove manual add" : "Remove from board")
					.setIcon("trash")
					.onClick(() => {
						void this.plugin.removeManualGame(game.appId);
					});
			});
		}

		if (game.source === "steam") {
			const steamAppId = typeof game.steamAppId === "number" && game.steamAppId > 0
				? game.steamAppId
				: game.appId;

			menu.addItem((item) => {
				item
					.setTitle("Exclude from sync")
					.setIcon("minus-circle")
					.onClick(() => {
						void this.plugin.excludeGameFromSync(steamAppId);
					});
			});
		}

		menu.showAtMouseEvent(event);
	}

	private getInitialImageUrl(game: SteamGame): string | null {
		if (game.headerImageUrl) {
			return game.headerImageUrl;
		}

		if (game.source !== "steam") {
			return null;
		}

		const steamAppId = typeof game.steamAppId === "number" && game.steamAppId > 0
			? game.steamAppId
			: game.appId;

		return getSteamHeaderImageUrl(steamAppId);
	}

	private destroySortables(): void {
		for (const sortable of this.sortables) {
			sortable.destroy();
		}

		this.sortables = [];
	}
}
