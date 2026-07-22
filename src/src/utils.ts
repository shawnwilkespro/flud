export function parseTags(tagsStr?: string | null): string[] {
  if (!tagsStr) return [];
  try {
    if (tagsStr.startsWith('[')) return JSON.parse(tagsStr) as string[];
    return tagsStr.split(',').map((t) => t.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
