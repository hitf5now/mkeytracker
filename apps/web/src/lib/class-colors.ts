import { CLASSES } from "@mplus/wow-constants";

/**
 * Returns the CSS hex color for a WoW class slug.
 * e.g. getClassColor("death-knight") → "#C41E3A"
 */
export function getClassColor(classSlug: string): string {
  const cls = CLASSES[classSlug];
  if (!cls) return "#FFFFFF";
  return `#${cls.color.toString(16).padStart(6, "0").toUpperCase()}`;
}

/**
 * Returns the display name for a WoW class slug.
 * e.g. getClassName("death-knight") → "Death Knight"
 */
export function getClassName(classSlug: string): string {
  return CLASSES[classSlug]?.name ?? classSlug;
}
