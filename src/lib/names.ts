import type { Area } from "../../shared/analyze.ts";

/** Display order of areas, in the graph and the list. */
export const AREA_ORDER: Area[] = ["Screens", "APIs", "Permissions", "Notifications", "Reports", "Data", "Logic", "Config", "Tests"];

export function shortName(id: string): string {
  return id.replace(/^(table|event):/, "").split("/").pop()!;
}
