import { create } from "zustand";

export type Tab = "assets" | "pixel" | "map";

interface UiState {
  tab: Tab;
  setTab(t: Tab): void;
  /** Asset (sheet id) open in the pixel editor, or "new". */
  pixelTarget?: string;
  openPixel(sheetId: string): void;
  mapId?: string;
  setMapId(id?: string): void;
  /** Home screen over an open project (so the welcome page is always reachable). */
  welcome: boolean;
  setWelcome(v: boolean): void;
  connect: boolean;
  setConnect(v: boolean): void;
}

export const useUi = create<UiState>((set) => ({
  tab: "assets",
  setTab: (tab) => set({ tab }),
  openPixel: (sheetId) => set({ pixelTarget: sheetId, tab: "pixel" }),
  setMapId: (mapId) => set({ mapId }),
  welcome: false,
  setWelcome: (welcome) => set({ welcome }),
  connect: false,
  setConnect: (connect) => set({ connect }),
}));
