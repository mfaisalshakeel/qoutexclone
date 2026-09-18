interface Props {
  className?: string;
}

const base = 'h-5 w-5';

export const IconChart = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
    <path d="M4 19V5M4 19h16" strokeLinecap="round" />
    <path d="M8 15v-3M12 17V8M16 13V6" strokeLinecap="round" />
  </svg>
);

export const IconWallet = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
    <path d="M3 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1" />
    <rect x="3" y="8" width="18" height="11" rx="2" />
    <circle cx="16.5" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export const IconHistory = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
    <path d="M3 12a9 9 0 1 0 3-6.7" strokeLinecap="round" />
    <path d="M3 4v4h4M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconUser = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" strokeLinecap="round" />
  </svg>
);

export const IconShield = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
    <path d="M12 3l7 3v6c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6l7-3z" strokeLinejoin="round" />
    <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconCopy = ({ className = 'h-4 w-4' }: Props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a1 1 0 0 1 1-1h9" strokeLinecap="round" />
  </svg>
);

export const IconArrowUp = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={className}>
    <path d="M12 19V5M6 11l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconArrowDown = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={className}>
    <path d="M12 5v14M6 13l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconCup = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
    <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" strokeLinejoin="round" />
    <path d="M7 6H4.5v1.5A3.5 3.5 0 0 0 8 11M17 6h2.5v1.5A3.5 3.5 0 0 1 16 11" strokeLinecap="round" />
    <path d="M12 14v3M9 20h6M10 17h4l.5 3h-5z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconBell = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
    <path
      d="M6 9a6 6 0 0 1 12 0c0 3.2.6 4.8 1.5 6H4.5C5.4 13.8 6 12.2 6 9z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M10 18a2 2 0 0 0 4 0" strokeLinecap="round" />
  </svg>
);

export const IconBellOff = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
    <path d="M8.2 6.2A6 6 0 0 1 18 9c0 3.2.6 4.8 1.5 6H8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M6 9v0c0 3.2-.6 4.8-1.5 6" strokeLinecap="round" />
    <path d="M4 4l16 16" strokeLinecap="round" />
  </svg>
);

export const IconVolume = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
    <path d="M4 10v4h3l4 3V7l-4 3H4z" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M15 9.5a3.5 3.5 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10" strokeLinecap="round" />
  </svg>
);

export const IconLogo = ({ className = 'h-7 w-7' }: Props) => (
  <svg viewBox="0 0 32 32" fill="none" className={className}>
    <rect width="32" height="32" rx="9" fill="#3d7bff" />
    <path
      d="M8 21l5-6 4 3.5L24 10"
      stroke="#fff"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="24" cy="10" r="2.3" fill="#12b886" stroke="#0a0e17" strokeWidth="1.2" />
  </svg>
);
