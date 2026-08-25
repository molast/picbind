import { getLang, getWorkspaceLabels, type Lang } from "../../locales";

export function workspacePersonName(name: string, lang: Lang = getLang()) {
  const normalized = name.trim();
  const labels = getWorkspaceLabels(lang);
  if (/^(guest|anonymous guest|collaborator)$/i.test(normalized)) return labels.guest;
  if (/^(owner|anonymous owner)$/i.test(normalized)) return labels.owner;
  return normalized;
}
