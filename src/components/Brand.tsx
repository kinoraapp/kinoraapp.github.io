import { useId } from "react";
import { env } from "../config/env";
import { brand } from "../config/brand";

/** The app mark: two stacked vertical video cards with a play button. Keep in sync with scripts/generate-icons.mjs. */
export function LogoMark({ size = 32 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={brand.primary} />
          <stop offset="1" stopColor={brand.secondary} />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${id})`} />
      <rect x="23" y="12" width="23" height="37" rx="6" fill="#fff" fillOpacity=".42" transform="rotate(12 34.5 30.5)" />
      <rect x="17" y="14" width="23" height="37" rx="6" fill="#fff" transform="rotate(-6 28.5 32.5)" />
      <path
        d="M25.6 26.2c0-1.6 1.8-2.6 3.2-1.7l8.3 5.6c1.2.8 1.2 2.6 0 3.4l-8.3 5.6c-1.4.9-3.2-.1-3.2-1.7z"
        fill={`url(#${id})`}
      />
    </svg>
  );
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <span className="logo-text">{env.appName}</span>
    </span>
  );
}

export function Avatar({
  src,
  name,
  size = 40,
}: {
  src: string | null | undefined;
  name: string;
  size?: number;
}) {
  const initial = (name || "?").replace(/^@/, "").charAt(0).toUpperCase();
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {src ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span aria-hidden>{initial}</span>}
    </span>
  );
}
