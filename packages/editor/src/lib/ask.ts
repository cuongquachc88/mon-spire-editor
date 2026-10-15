import { ask as tauriAsk, message as tauriMessage } from "@tauri-apps/plugin-dialog";
import { isTauri } from "./tauri-fs";

/** Yes/no prompt: native dialog in the desktop app (webview confirm() is unreliable), window.confirm in the browser. */
export async function confirmAsk(text: string): Promise<boolean> {
  return isTauri() ? tauriAsk(text, { kind: "warning" }) : window.confirm(text);
}

export async function notify(text: string): Promise<void> {
  if (isTauri()) await tauriMessage(text, { kind: "error" });
  else window.alert(text);
}
