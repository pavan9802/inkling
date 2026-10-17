import * as vscode from 'vscode';

/** Status-bar indicator + click target for the toggle command. */
export class StatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'inkling.toggle';
    this.item.show();
  }

  update(enabled: boolean, model: string): void {
    this.item.text = enabled ? `$(sparkle) Inkling` : `$(circle-slash) Inkling`;
    this.item.tooltip = enabled ? `Inkling: ${model}` : 'Inkling: disabled';
  }

  dispose(): void {
    this.item.dispose();
  }
}
