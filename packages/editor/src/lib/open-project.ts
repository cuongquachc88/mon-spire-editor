import { ProjectStore } from "@mse/core";
import { open } from "@tauri-apps/plugin-dialog";
import { TauriFs } from "./tauri-fs";
import { tauriBackend, useProject } from "../state/project";

const LAST = "mse:lastProject";
const remember = (dir: string) => {
  try {
    localStorage.setItem(LAST, dir);
  } catch {
    /* storage unavailable: just don't remember */
  }
};
const RECENT = "mse:recentProjects";
export const recentProjects = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
};
const addRecent = (dir: string) => {
  try {
    localStorage.setItem(RECENT, JSON.stringify([dir, ...recentProjects().filter((d) => d !== dir)].slice(0, 6)));
  } catch {
    /* storage unavailable */
  }
};
const lastProject = () => {
  try {
    return localStorage.getItem(LAST) ?? undefined;
  } catch {
    return undefined;
  }
};

/** Drop a folder that can no longer be opened from "recent" and from the reopen-last memory. */
export function forgetProject(dir: string) {
  try {
    localStorage.setItem(RECENT, JSON.stringify(recentProjects().filter((d) => d !== dir)));
    if (localStorage.getItem(LAST) === dir) localStorage.removeItem(LAST);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Open a folder that already holds project.json. Throws if it doesn't.
 * `remember: false` is for folders passed on the command line, which should not replace the user's own history.
 */
export async function openProjectDir(dir: string, { remember: keep = true } = {}) {
  const fs = new TauriFs();
  if (!(await fs.exists(`${dir}/project.json`))) throw new Error(`No project.json in ${dir}`);
  await useProject.getState().open(tauriBackend(dir));
  if (keep) {
    remember(dir);
    addRecent(dir);
  }
}

/** Reopen the last project if it still exists. Returns false when there is nothing to reopen. */
export async function reopenLast() {
  const dir = lastProject();
  if (!dir) return false;
  try {
    await openProjectDir(dir);
    return true;
  } catch {
    forgetProject(dir); // moved or deleted: don't keep offering it
    return false;
  }
}

/**
 * Pick a folder. An existing project opens as-is; an empty/other folder is turned into a new project
 * only when `confirmCreate` says yes. Returns the chosen dir or undefined if the dialog was cancelled.
 */
export async function pickAndOpen(confirmCreate: (dir: string) => Promise<boolean>) {
  const dir = await open({ directory: true, multiple: false, recursive: true, title: "Choose a project folder" });
  if (typeof dir !== "string") return undefined;
  const fs = new TauriFs();
  if (!(await fs.exists(`${dir}/project.json`))) {
    if (!(await confirmCreate(dir))) return undefined;
    const name = dir.split(/[\\/]/).filter(Boolean).pop() ?? "project";
    await new ProjectStore(fs, dir).init(name);
  }
  await openProjectDir(dir);
  return dir;
}
