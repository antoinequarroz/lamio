/** The word that mentions everyone in the conversation. */
export const EVERYONE = "tous";

type Named = { id: string; name: string };

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}_]/u.test(ch);

/**
 * Finds the mentions in a message: "@Full Name" for a person, "@tous" for everybody.
 * Returns one segment per piece of text, in order; a mention segment carries who it is for.
 * Longer names win ("@Ana Maria" is not "@Ana" followed by " Maria"), case does not matter,
 * and an "@" glued to a word before it (an e-mail address) is not a mention.
 */
export function splitMentions(text: string, people: Named[]): { text: string; userId?: string; everyone?: boolean }[] {
  const names = [...people.filter((p) => p.name.trim()).map((p) => ({ key: p.name.trim().toLowerCase(), userId: p.id as string | undefined })), { key: EVERYONE, userId: undefined }].sort((a, b) => b.key.length - a.key.length);
  const lower = text.toLowerCase();
  const out: { text: string; userId?: string; everyone?: boolean }[] = [];
  let plain = 0;
  for (let i = text.indexOf("@"); i !== -1; i = text.indexOf("@", i + 1)) {
    if (isWordChar(text[i - 1])) continue;
    const hit = names.find((n) => lower.startsWith(n.key, i + 1) && !isWordChar(text[i + 1 + n.key.length]));
    if (!hit) continue;
    const end = i + 1 + hit.key.length;
    if (i > plain) out.push({ text: text.slice(plain, i) });
    out.push(hit.userId ? { text: text.slice(i, end), userId: hit.userId } : { text: text.slice(i, end), everyone: true });
    plain = end;
    i = end - 1;
  }
  if (plain < text.length) out.push({ text: text.slice(plain) });
  return out;
}

/** Who a message mentions, among the people who can read the conversation. */
export function mentionedIds(text: string, people: Named[]): string[] {
  const ids = new Set<string>();
  for (const part of splitMentions(text, people)) {
    if (part.userId) ids.add(part.userId);
    else if (part.everyone) for (const p of people) ids.add(p.id);
  }
  return [...ids];
}
