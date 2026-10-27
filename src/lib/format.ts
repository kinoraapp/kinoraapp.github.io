export function compactNumber(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (v < 1000) return String(v);
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const abs = Math.abs(seconds);
  const sign = seconds >= 0 ? -1 : 1;
  if (abs < 60) return sign < 0 ? "just now" : "in a moment";
  if (abs < 3600) return rtf.format(sign * Math.floor(abs / 60), "minute");
  if (abs < 86400) return rtf.format(sign * Math.floor(abs / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(sign * Math.floor(abs / 86400), "day");
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function duration(seconds: number | null | undefined): string {
  if (!seconds && seconds !== 0) return "";
  const s = Math.round(Number(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function bytes(n: number | null | undefined): string {
  let v = Number(n ?? 0);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/** Value for <input type="datetime-local"> in the browser's time zone. */
export function toLocalInput(date: Date): string {
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Splits a caption into text and #hashtag parts for rendering links. */
export function captionParts(caption: string): { text: string; tag?: string }[] {
  const parts: { text: string; tag?: string }[] = [];
  const re = /#([\p{L}\p{N}_]{1,50})/gu;
  let last = 0;
  for (const m of caption.matchAll(re)) {
    if (m.index! > last) parts.push({ text: caption.slice(last, m.index) });
    parts.push({ text: m[0], tag: m[1].toLowerCase() });
    last = m.index! + m[0].length;
  }
  if (last < caption.length) parts.push({ text: caption.slice(last) });
  return parts;
}

/** Parses "#a, b c" into ["a", "b", "c"]. */
export function parseHashtags(input: string): string[] {
  const tags = input
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#+/, "").toLowerCase())
    .filter((t) => /^[\p{L}\p{N}_]{1,50}$/u.test(t));
  return Array.from(new Set(tags)).slice(0, 30);
}

export const visibilityLabel: Record<string, string> = {
  public: "Public",
  unlisted: "Unlisted",
  private: "Private",
  selected: "Selected users",
};

export const reportReasonLabel: Record<string, string> = {
  spam: "Spam or scam",
  harassment: "Harassment or bullying",
  hate: "Hate speech",
  violence: "Violence or dangerous acts",
  sexual: "Nudity or sexual content",
  self_harm: "Self-harm",
  misinformation: "False information",
  copyright: "Copyright infringement",
  other: "Something else",
};
