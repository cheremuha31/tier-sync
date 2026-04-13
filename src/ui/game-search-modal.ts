import { App, Modal, Notice } from "obsidian";
import { searchRawgGames } from "../metadata/rawg-client";
import { searchSteamStoreGames } from "../steam/steam-client";
import type { CustomGameSearchResult, SteamStoreSearchResult } from "../types";

interface SteamSearchModalOptions {
	kind: "steam";
	onSelect: (result: SteamStoreSearchResult) => Promise<void>;
}

interface CustomSearchModalOptions {
	kind: "custom";
	rawgApiKey: string;
	onSelect: (result: CustomGameSearchResult) => Promise<void>;
}

type GameSearchModalOptions = SteamSearchModalOptions | CustomSearchModalOptions;

export class GameSearchModal extends Modal {
	private readonly options: GameSearchModalOptions;
	private searchInputEl: HTMLInputElement | null = null;
	private statusEl: HTMLElement | null = null;
	private resultsEl: HTMLElement | null = null;
	private activeSearchToken = 0;
	private pendingSearchId: number | null = null;

	constructor(app: App, options: GameSearchModalOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		const { contentEl } = this;

		contentEl.empty();
		contentEl.addClass("tier-sync-search-modal");

		contentEl.createEl("h2", { text: this.options.kind === "steam" ? "Add Steam game" : "Add custom game" });
		contentEl.createEl("p", {
			cls: "tier-sync-search-modal-copy",
			text: this.options.kind === "steam"
				? "Search Steam by title to manually include short games or titles from family sharing."
				: "Search RAWG by title to add games from other platforms with better cover art.",
		});

		const input = contentEl.createEl("input", {
			cls: "tier-sync-search-modal-input",
			attr: {
				type: "search",
				placeholder: this.options.kind === "steam" ? "Search Steam titles" : "Search RAWG titles",
				"aria-label": this.options.kind === "steam" ? "Search Steam titles" : "Search RAWG titles",
			},
		});
		const statusEl = contentEl.createDiv({ cls: "tier-sync-search-modal-status" });
		const resultsEl = contentEl.createDiv({ cls: "tier-sync-search-results" });

		this.searchInputEl = input instanceof HTMLInputElement ? input : null;
		this.statusEl = statusEl;
		this.resultsEl = resultsEl;

		if (this.searchInputEl) {
			this.searchInputEl.focus();
			this.searchInputEl.addEventListener("input", () => {
				this.scheduleSearch();
			});
			this.searchInputEl.addEventListener("keydown", (event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					void this.runSearch(this.searchInputEl?.value ?? "");
				}
			});
		}

		this.setStatus("Type at least 2 characters to search.");
	}

	onClose(): void {
		if (this.pendingSearchId !== null) {
			window.clearTimeout(this.pendingSearchId);
		}

		this.contentEl.empty();
	}

	private scheduleSearch(): void {
		if (this.pendingSearchId !== null) {
			window.clearTimeout(this.pendingSearchId);
		}

		this.pendingSearchId = window.setTimeout(() => {
			this.pendingSearchId = null;
			void this.runSearch(this.searchInputEl?.value ?? "");
		}, 250);
	}

	private async runSearch(query: string): Promise<void> {
		const trimmedQuery = query.trim();

		if (!this.resultsEl) {
			return;
		}

		if (trimmedQuery.length < 2) {
			this.resultsEl.empty();
			this.setStatus("Type at least 2 characters to search.");
			return;
		}

		const searchToken = this.activeSearchToken + 1;

		this.activeSearchToken = searchToken;
		this.setStatus("Searching...");
		this.resultsEl.empty();

		try {
			if (this.options.kind === "steam") {
				const results = await searchSteamStoreGames(trimmedQuery);

				if (this.activeSearchToken !== searchToken) {
					return;
				}

				if (results.length === 0) {
					this.setStatus("No matches found.");
					return;
				}

				this.setStatus("");
				this.renderSteamResults(results);
			} else {
				const results = await searchRawgGames(this.options.rawgApiKey, trimmedQuery);

				if (this.activeSearchToken !== searchToken) {
					return;
				}

				if (results.length === 0) {
					this.setStatus("No matches found.");
					return;
				}

				this.setStatus("");
				this.renderCustomResults(results);
			}
		} catch (error: unknown) {
			if (this.activeSearchToken !== searchToken) {
				return;
			}

			const message = error instanceof Error ? error.message : "Search failed.";
			this.setStatus(message);
		}
	}

	private renderSteamResults(results: SteamStoreSearchResult[]): void {
		if (!this.resultsEl) {
			return;
		}

		this.resultsEl.empty();

		for (const result of results) {
			const item = this.resultsEl.createDiv({ cls: "tier-sync-search-result" });
			const imageUrl = result.tinyImageUrl;
			const title = result.name;
			const subtitle = result.platformLabel;

			if (imageUrl) {
				item.createEl("img", {
					cls: "tier-sync-search-result-image",
					attr: {
						src: imageUrl,
						alt: title,
						loading: "lazy",
					},
				});
			} else {
				item.createDiv({ cls: "tier-sync-search-result-placeholder" });
			}

			const copy = item.createDiv({ cls: "tier-sync-search-result-copy" });

			copy.createEl("div", {
				cls: "tier-sync-search-result-title",
				text: title,
			});
			copy.createEl("div", {
				cls: "tier-sync-search-result-subtitle",
				text: subtitle,
			});

			const addButton = item.createEl("button", {
				text: "Add",
				cls: "mod-cta",
			});

			addButton.addEventListener("click", () => {
				void this.selectResult(result);
			});
		}
	}

	private renderCustomResults(results: CustomGameSearchResult[]): void {
		if (!this.resultsEl) {
			return;
		}

		this.resultsEl.empty();

		for (const result of results) {
			const item = this.resultsEl.createDiv({ cls: "tier-sync-search-result" });
			const imageUrl = result.imageUrl;
			const title = result.title;
			const subtitle = result.description ?? result.platformLabel ?? "RAWG result";

			if (imageUrl) {
				item.createEl("img", {
					cls: "tier-sync-search-result-image",
					attr: {
						src: imageUrl,
						alt: title,
						loading: "lazy",
					},
				});
			} else {
				item.createDiv({ cls: "tier-sync-search-result-placeholder" });
			}

			const copy = item.createDiv({ cls: "tier-sync-search-result-copy" });

			copy.createEl("div", {
				cls: "tier-sync-search-result-title",
				text: title,
			});
			copy.createEl("div", {
				cls: "tier-sync-search-result-subtitle",
				text: subtitle,
			});

			const addButton = item.createEl("button", {
				text: "Add",
				cls: "mod-cta",
			});

			addButton.addEventListener("click", () => {
				void this.selectResult(result);
			});
		}
	}

	private async selectResult(
		result: SteamStoreSearchResult | CustomGameSearchResult,
	): Promise<void> {
		try {
			if (this.options.kind === "steam") {
				await this.options.onSelect(result as SteamStoreSearchResult);
			} else {
				await this.options.onSelect(result as CustomGameSearchResult);
			}

			this.close();
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Could not add the game.";
			new Notice(message, 6000);
		}
	}

	private setStatus(message: string): void {
		if (!this.statusEl) {
			return;
		}

		this.statusEl.setText(message);
		this.statusEl.toggleClass("is-empty", message.length === 0);
	}
}
