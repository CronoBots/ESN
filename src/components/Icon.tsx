import type { JSX, SVGProps } from 'react';

const PATHS = {
  home: (
    <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5.5v-6h-5v6H4a1 1 0 0 1-1-1z" fill="currentColor" />
  ),
  calendar: (
    <>
      <rect x="3" y="4.5" width="18" height="16.5" rx="3.5" fill="none" stroke="currentColor" strokeWidth="2.1" />
      <path d="M3.5 9.5h17" stroke="currentColor" strokeWidth="2" />
      <g fill="currentColor">
        <circle cx="8" cy="13.5" r="1.25" />
        <circle cx="12" cy="13.5" r="1.25" />
        <circle cx="16" cy="13.5" r="1.25" />
        <circle cx="8" cy="17.3" r="1.25" />
        <circle cx="12" cy="17.3" r="1.25" />
      </g>
      <path d="M8 2.5v4M16 2.5v4" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </>
  ),
  trophy: (
    <path
      d="M7 3h10v2h3v2.5a4.5 4.5 0 0 1-4.1 4.48A5 5 0 0 1 13 14.9V18h3v3H8v-3h3v-3.1a5 5 0 0 1-2.9-2.92A4.5 4.5 0 0 1 4 7.5V5h3zm0 4H6v.5a2.5 2.5 0 0 0 1.1 2.07A5 5 0 0 1 7 9zm10 0v2a5 5 0 0 1-.1.57A2.5 2.5 0 0 0 18 7.5V7z"
      fill="currentColor"
    />
  ),
  chart: (
    <>
      <path d="M4 20h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M5 15.5 9.5 11l3.5 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="19" cy="7" r="2" fill="currentColor" />
    </>
  ),
  gear: (
    <path
      fillRule="evenodd"
      d="M10.3 2.6a1 1 0 0 1 1-.6h1.4a1 1 0 0 1 1 .6l.6 1.7c.5.2.9.4 1.4.7l1.7-.6a1 1 0 0 1 1.1.3l1 1a1 1 0 0 1 .3 1.1l-.6 1.7c.3.4.5.9.7 1.4l1.7.6a1 1 0 0 1 .6 1v1.4a1 1 0 0 1-.6 1l-1.7.6c-.2.5-.4 1-.7 1.4l.6 1.7a1 1 0 0 1-.3 1.1l-1 1a1 1 0 0 1-1.1.3l-1.7-.6c-.4.3-.9.5-1.4.7l-.6 1.7a1 1 0 0 1-1 .6h-1.4a1 1 0 0 1-1-.6l-.6-1.7c-.5-.2-1-.4-1.4-.7l-1.7.6a1 1 0 0 1-1.1-.3l-1-1a1 1 0 0 1-.3-1.1l.6-1.7c-.3-.4-.5-.9-.7-1.4l-1.7-.6a1 1 0 0 1-.6-1v-1.4a1 1 0 0 1 .6-1l1.7-.6c.2-.5.4-1 .7-1.4l-.6-1.7a1 1 0 0 1 .3-1.1l1-1a1 1 0 0 1 1.1-.3l1.7.6c.4-.3.9-.5 1.4-.7zM12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7"
      fill="currentColor"
    />
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.6" fill="currentColor" />
      <path d="M2 19.5c0-3.6 3.1-6 7-6s7 2.4 7 6V20H2z" fill="currentColor" />
      <circle cx="17" cy="9" r="2.8" fill="currentColor" opacity=".75" />
      <path d="M17.5 13.6c2.7.3 4.5 2.2 4.5 4.9v1.5h-4.4v-.5c0-2.3-.9-4.3-2.6-5.6.8-.2 1.6-.3 2.5-.3" fill="currentColor" opacity=".75" />
    </>
  ),
  chevronLeft: <path d="M15 4.5 7.5 12l7.5 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />,
  chevronRight: <path d="M9 4.5 16.5 12 9 19.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />,
  chevronDown: <path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />,
  plus: <path d="M12 4.5v15M4.5 12h15" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />,
  close: <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />,
  check: <path d="M4.5 12.5 9.5 17.5 19.5 6.5" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />,
  heart: (
    <path
      d="M12 20.5s-8-4.9-8-11A4.6 4.6 0 0 1 8.6 5c1.5 0 2.7.7 3.4 1.9C12.7 5.7 13.9 5 15.4 5A4.6 4.6 0 0 1 20 9.5c0 6.1-8 11-8 11z"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
  ),
  heartFill: (
    <path
      d="M12 20.5s-8-4.9-8-11A4.6 4.6 0 0 1 8.6 5c1.5 0 2.7.7 3.4 1.9C12.7 5.7 13.9 5 15.4 5A4.6 4.6 0 0 1 20 9.5c0 6.1-8 11-8 11z"
      fill="currentColor"
    />
  ),
  stopwatch: (
    <>
      <circle cx="12" cy="13.5" r="7.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M12 13.5V9.5M10 2.8h4M18.5 6.5l1.3-1.3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </>
  ),
  flag: (
    <path d="M5 21V4m0 0h11l-2 4 2 4H5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="10" r="2.3" fill="currentColor" />
    </>
  ),
  pool: (
    <>
      <path d="M2.5 16c1.6 0 1.6-1.2 3.2-1.2S7.3 16 8.9 16s1.6-1.2 3.1-1.2S13.6 16 15.2 16s1.6-1.2 3.1-1.2S20 16 21.5 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M2.5 20c1.6 0 1.6-1.2 3.2-1.2S7.3 20 8.9 20s1.6-1.2 3.1-1.2S13.6 20 15.2 20s1.6-1.2 3.1-1.2S20 20 21.5 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 13V5.5a2 2 0 0 1 4 0M16 13V5.5a2 2 0 0 0-4 0M8 8.5h8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  download: (
    <path d="M12 3.5v11m0 0-4.5-4.5M12 14.5l4.5-4.5M4.5 16.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  ),
  upload: (
    <path d="M12 15.5v-11m0 0L7.5 9M12 4.5 16.5 9M4.5 16.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  ),
  share: (
    <path d="M12 3.5v11M12 3.5 8 7.5M12 3.5l4 4M7 11H5.5a1 1 0 0 0-1 1v7.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V12a1 1 0 0 0-1-1H17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  ),
  external: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M9.5 14.5l6-6m0 0h-4.5m4.5 0V13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  edit: (
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
  ),
  trash: (
    <path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1l1-13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </>
  ),
  medal: (
    <>
      <path d="M8 2.5h3l2 5H10zM13 2.5h3l-2 5" fill="currentColor" opacity=".7" />
      <circle cx="12" cy="15" r="6.2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 12v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="4.2" fill="currentColor" />
      <path d="M3.5 21c0-4.4 3.8-7.5 8.5-7.5s8.5 3.1 8.5 7.5z" fill="currentColor" />
    </>
  ),
  bolt: <path d="M13.5 2 5 13.5h6L10 22l9-12h-6z" fill="currentColor" />,
  sparkles: (
    <path d="M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6zM18 13l.9 2.1L21 16l-2.1.9L18 19l-.9-2.1L15 16l2.1-.9z" fill="currentColor" />
  ),
  link: (
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3A4.5 4.5 0 0 0 13 4.6l-1.2 1.2M14 10a4.5 4.5 0 0 0-6.4 0l-3 3A4.5 4.5 0 0 0 11 19.4l1.2-1.2" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
  ),
  clipboard: (
    <>
      <rect x="5" y="4.5" width="14" height="17" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="8.5" y="2.5" width="7" height="4" rx="1.5" fill="currentColor" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 11v5.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="7.6" r="1.3" fill="currentColor" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5" fill="currentColor" />,
  bell: (
    <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
  ),
  phone: (
    <>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M10.5 18.5h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  list: (
    <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  ),
  swap: (
    <path d="M7 4.5 3.5 8 7 11.5M3.5 8h13M17 12.5l3.5 3.5-3.5 3.5M20.5 16h-13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  ),
  ranking: (
    <>
      <rect x="9" y="5" width="6" height="15" rx="1.5" fill="currentColor" />
      <rect x="2.5" y="10" width="6" height="10" rx="1.5" fill="currentColor" opacity=".7" />
      <rect x="15.5" y="13" width="6" height="7" rx="1.5" fill="currentColor" opacity=".5" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="m15.5 15.5 5 5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </>
  ),
  shield: (
    <path d="M12 2.5 4.5 5.5V11c0 5 3.2 8.6 7.5 10.5 4.3-1.9 7.5-5.5 7.5-10.5V5.5z" fill="currentColor" />
  ),
  qr: (
    <>
      <g fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2" />
        <rect x="14" y="3.5" width="6.5" height="6.5" rx="1.2" />
        <rect x="3.5" y="14" width="6.5" height="6.5" rx="1.2" />
      </g>
      <g fill="currentColor">
        <rect x="5.75" y="5.75" width="2" height="2" />
        <rect x="16.25" y="5.75" width="2" height="2" />
        <rect x="5.75" y="16.25" width="2" height="2" />
        <rect x="13.5" y="13.5" width="3" height="3" rx=".5" />
        <rect x="18" y="13.5" width="2.5" height="2.5" rx=".5" />
        <rect x="16" y="17.5" width="3" height="3" rx=".5" />
        <rect x="13.5" y="18.5" width="2" height="2" rx=".5" />
      </g>
    </>
  ),
  /** Bouton « ⋯ » de Safari (iOS 26) */
  more: (
    <g fill="currentColor">
      <circle cx="5.5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="18.5" cy="12" r="2" />
    </g>
  ),
  /** Menu « ⋮ » de Chrome */
  dotsV: (
    <g fill="currentColor">
      <circle cx="12" cy="5.5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="18.5" r="2" />
    </g>
  ),
  /** « Sur l'écran d'accueil » (iPhone) */
  addSquare: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  /** Installer (ordinateur) : écran et flèche */
  install: (
    <>
      <rect x="3" y="4" width="18" height="12.5" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8.5 20.5h7M12 7v6.5M9.5 11l2.5 2.5 2.5-2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
} satisfies Record<string, JSX.Element>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...rest}>
      {PATHS[name]}
    </svg>
  );
}
