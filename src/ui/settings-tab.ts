import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type TierSyncPlugin from "../main";
import { createNextTierName } from "../settings";
import type { SteamGame } from "../types";
import { formatPlaytime } from "../utils";

export class TierSyncSettingTab extends PluginSettingTab {
	private readonly plugin: TierSyncPlugin;

	constructor(app: App, plugin: TierSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		containerEl.addClass("tier-sync-settings");
		new Setting(containerEl).setName("Steam").setHeading();

		new Setting(containerEl)
			.setName("Steam web API key")
			.setDesc("Stored locally in this vault.")
			.addText((text) => {
				text.setPlaceholder("Paste your key");
				text.setValue(this.plugin.settings.steamApiKey);
				text.inputEl.type = "password";
				text.inputEl.spellcheck = false;
				text.onChange((value) => {
					void this.plugin.updateSteamApiKey(value);
				});
			});

		new Setting(containerEl)
			.setName("Steam ID or vanity URL")
			.setDesc(
				"Supports a numeric ID, vanity name, or full profile URL.",
			)
			.addText((text) => {
				text.setPlaceholder("Numeric ID or vanity name");
				text.setValue(this.plugin.settings.steamId);
				text.inputEl.spellcheck = false;
				text.onChange((value) => {
					void this.plugin.updateSteamId(value);
				});
			});

		new Setting(containerEl)
			.setName("Minimum playtime")
			.setDesc("Hide games with less total playtime than this many minutes.")
			.addText((text) => {
				text.setValue(`${this.plugin.settings.minPlaytime}`);
				text.inputEl.type = "number";
				text.inputEl.min = "0";
				text.onChange((value) => {
					const nextValue = Number.parseInt(value, 10);

					if (Number.isNaN(nextValue) || nextValue < 0) {
						return;
					}

					void this.plugin.updateMinPlaytime(nextValue);
				});
			});

		new Setting(containerEl)
			.setName("Excluded games")
			.setDesc(
				"Games in this list stay out of the board and future syncs. Use it for hidden games or other exclusions.",
			)
			.addTextArea((text) => {
				text.setPlaceholder("12345, 67890");
				text.setValue(this.plugin.getExcludedAppIdsText());
				text.inputEl.rows = 3;
				text.onChange((value) => {
					void this.plugin.updateExcludedAppIds(value);
				});
			})
			.addButton((button) => {
				button.setButtonText("Clear");
				button.onClick(() => {
					void this.clearExcludedGamesAndRefresh();
				});
			});

		new Setting(containerEl).setName("Manual games").setHeading();
		containerEl.createEl("p", {
			cls: "tier-sync-settings-copy",
			text: "Add short games, family sharing titles, or custom games by searching their names.",
		});

		new Setting(containerEl)
			.setName("Custom game API key")
			.setDesc("Required for custom game search and cover art. Stored locally in this vault.")
			.addText((text) => {
				text.setPlaceholder("Paste your API key");
				text.setValue(this.plugin.settings.rawgApiKey);
				text.inputEl.type = "password";
				text.inputEl.spellcheck = false;
				text.onChange((value) => {
					void this.plugin.updateRawgApiKey(value);
				});
			});

		new Setting(containerEl)
			.setName("Add game")
			.setDesc("Search by title and add the selected result directly to the board.")
			.addButton((button) => {
				button.setButtonText("Add steam game");
				button.onClick(() => {
					this.plugin.openAddSteamGameModal(() => {
						this.display();
					});
				});
			})
			.addButton((button) => {
				button.setButtonText("Add custom game");
				button.onClick(() => {
					this.plugin.openAddCustomGameModal(() => {
						this.display();
					});
				});
			});

		const manualGames = this.plugin.getManualGames();

		if (manualGames.length === 0) {
			containerEl.createEl("p", {
				cls: "tier-sync-settings-copy",
				text: "No manual games yet.",
			});
		} else {
			for (const game of manualGames) {
				new Setting(containerEl)
					.setName(game.name)
					.setDesc(this.getManualGameDescription(game))
					.addButton((button) => {
						button.setButtonText(
							game.source === "steam" && game.isSynced
								? "Remove manual add"
								: "Remove",
						);
						button.onClick(() => {
							void this.removeManualGameAndRefresh(game.appId);
						});
					});
			}
		}

		new Setting(containerEl)
			.setName("Card info")
			.setDesc("Choose what the board shows on top of each preview.")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("title", "Title")
					.addOption("playtime", "Playtime")
					.addOption("both", "Title + playtime")
					.addOption("none", "Preview only");
				dropdown.setValue(this.plugin.settings.cardDetails);
				dropdown.onChange((value) => {
					void this.plugin.updateCardDetailsMode(
						value as typeof this.plugin.settings.cardDetails,
					);
				});
			});

		new Setting(containerEl)
			.setName("Card size")
			.setDesc("Adjust how large the game previews should be on the board.")
			.addSlider((slider) => {
				slider
					.setLimits(70, 400, 1)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.cardSize);
				slider.onChange((value) => {
					void this.plugin.updateCardSize(value);
				});
			});

		new Setting(containerEl)
			.setName("Auto tier text color")
			.setDesc("Switch between black and white tier text based on the background color.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.autoTierTextColor);
				toggle.onChange((value) => {
					void this.plugin.updateAutoTierTextColor(value);
				});
			});

		new Setting(containerEl)
			.setName("Actions")
			.setDesc("Run a sync after changing settings or filters.")
			.addButton((button) => {
				button.setButtonText("Sync now");
				button.setCta();
				button.onClick(() => {
					void this.plugin.syncSteamLibrary({ revealView: true });
				});
			})
			.addButton((button) => {
				button.setButtonText("Open board");
				button.onClick(() => {
					void this.plugin.activateView();
				});
			});

		new Setting(containerEl).setName("Tiers").setHeading();
		containerEl.createEl("p", {
			cls: "tier-sync-settings-copy",
			text: "Rename tiers, recolor rows, reorder them, or add custom ones.",
		});

		for (let index = 0; index < this.plugin.settings.tiers.length; index += 1) {
			const tier = this.plugin.settings.tiers[index];

			if (!tier) {
				continue;
			}

			const setting = new Setting(containerEl)
				.setName(`Tier ${index + 1}`)
				.setDesc(`${this.plugin.getTierSize(tier.id)} games`);

			setting.addText((text) => {
				text.setPlaceholder("Tier name");
				text.setValue(tier.name);
				text.onChange((value) => {
					void this.plugin.renameTier(tier.id, value);
				});
			});

			const colorInput = setting.controlEl.createEl("input", {
				cls: "tier-sync-settings-color",
				attr: {
					type: "color",
					"aria-label": `Color for ${tier.name}`,
				},
			});

			if (colorInput instanceof HTMLInputElement) {
				colorInput.value = tier.color;
				colorInput.addEventListener("input", () => {
					void this.plugin.updateTierColor(tier.id, colorInput.value);
				});
			}

			setting.addExtraButton((button) => {
				button.setIcon("up-chevron-glyph");
				button.setTooltip("Move tier up");
				button.extraSettingsEl.classList.toggle("is-disabled", index === 0);
				button.onClick(() => {
					if (index === 0) {
						return;
					}

					void this.moveTierAndRefresh(tier.id, -1);
				});
			});

			setting.addExtraButton((button) => {
				button.setIcon("down-chevron-glyph");
				button.setTooltip("Move tier down");
				button.extraSettingsEl.classList.toggle(
					"is-disabled",
					index === this.plugin.settings.tiers.length - 1,
				);
				button.onClick(() => {
					if (index === this.plugin.settings.tiers.length - 1) {
						return;
					}

					void this.moveTierAndRefresh(tier.id, 1);
				});
			});

			setting.addExtraButton((button) => {
				button.setIcon("trash");
				button.setTooltip("Delete tier");
				button.onClick(() => {
					void this.deleteTierAndRefresh(tier.id);
				});
			});
		}

		new Setting(containerEl)
			.setName("Add tier")
			.setDesc(`Next tier: ${createNextTierName(this.plugin.settings.tiers)}`)
			.addButton((button) => {
				button.setButtonText("Add tier");
				button.onClick(() => {
					void this.addTierAndRefresh();
				});
			});
	}

	private async addTierAndRefresh(): Promise<void> {
		await this.plugin.addTier();
		this.display();
	}

	private async moveTierAndRefresh(
		tierId: string,
		direction: -1 | 1,
	): Promise<void> {
		await this.plugin.moveTier(tierId, direction);
		this.display();
	}

	private async deleteTierAndRefresh(tierId: string): Promise<void> {
		const removed = await this.plugin.removeTier(tierId);

		if (!removed) {
			new Notice("At least one tier must remain in the board.");
			return;
		}

		this.display();
	}

	private async clearExcludedGamesAndRefresh(): Promise<void> {
		await this.plugin.clearExcludedAppIds();
		this.display();
	}

	private async removeManualGameAndRefresh(gameId: number): Promise<void> {
		await this.plugin.removeManualGame(gameId);
		this.display();
	}

	private getManualGameDescription(game: SteamGame): string {
		const labels: string[] = [];
		const playtime = formatPlaytime(game.playtimeMinutes);

		if (game.source === "steam") {
			labels.push(game.isSynced ? "Steam sync + manual include" : "Manual Steam include");
		} else {
			labels.push("Non-Steam game");
		}

		if (game.platform && game.platform !== "Steam" && game.platform !== "Other platform") {
			labels.push(game.platform);
		}

		if (playtime) {
			labels.push(playtime);
		}

		return labels.join(" | ");
	}
}
