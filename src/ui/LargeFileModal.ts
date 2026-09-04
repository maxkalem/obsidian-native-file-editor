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
    this.title = "Large file";
    this.sizeBytes = opts.sizeBytes;
    this.thresholdBytes = opts.thresholdBytes;
    this.onEdit = opts.onEdit;
  }

  override onOpen(): void {
    this.titleEl.setText(this.title);
    this.contentEl.addClass("nfe-modal");
    this.contentEl.createEl("p", {
      text: `This file is ${formatBytes(this.sizeBytes)}, above the ${formatBytes(this.thresholdBytes)} limit for opening in the editor. It is shown as a preview. Editing a file this size can be slow and use a lot of memory, especially on a phone.`,
    });
    this.contentEl.createEl("p", {
      text: "The limit is a per-device setting of Native File Editor.",
      cls: "nfe-modal-note",
    });
    const actions = this.contentEl.createDiv({ cls: "nfe-modal-actions" });
    const btn = actions.createEl("button", { text: "Edit anyway", cls: "mod-cta" });
    btn.addEventListener("click", () => {
      this.close();
      this.onEdit();
    });
  }
}
