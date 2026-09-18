import { t } from "../core/i18n";
import { type App, Modal } from "obsidian";

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Shown when the user asks to edit a file above the size threshold. The editor
 * for a large file costs memory and time on a phone, so preview is the default;
 * the modal says so and lets the user go ahead anyway. No Cancel button:
 * tapping outside dismisses, and the space goes to the one action.
 */
export class LargeFileModal extends Modal {
  readonly title: string;
  private readonly sizeBytes: number;
  private readonly thresholdBytes: number;
  private readonly onEdit: () => void;

  constructor(app: App, opts: { sizeBytes: number; thresholdBytes: number; onEdit: () => void }) {
    super(app);
    this.title = t("largeFile.title");
    this.sizeBytes = opts.sizeBytes;
    this.thresholdBytes = opts.thresholdBytes;
    this.onEdit = opts.onEdit;
  }

  override onOpen(): void {
    this.titleEl.setText(this.title);
    this.contentEl.addClass("nfe-modal");
    this.contentEl.createEl("p", {
      text: t("largeFile.body", { size: formatBytes(this.sizeBytes), limit: formatBytes(this.thresholdBytes) }),
    });
    this.contentEl.createEl("p", {
      text: t("largeFile.limitNote"),
      cls: "nfe-modal-note",
    });
    const actions = this.contentEl.createDiv({ cls: "nfe-modal-actions" });
    const btn = actions.createEl("button", { text: t("largeFile.editAnyway"), cls: "mod-cta" });
    btn.addEventListener("click", () => {
      this.close();
      this.onEdit();
    });
  }
}
