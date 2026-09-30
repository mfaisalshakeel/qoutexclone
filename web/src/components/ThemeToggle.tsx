import { useTheme, type ThemeChoice } from '../store/theme';

const OPTIONS: { value: ThemeChoice; label: string; icon: JSX.Element }[] = [
  {
    value: 'light',
    label: 'Light',
    icon: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
      </>
    ),
  },
  {
    value: 'system',
    label: 'System',
    icon: (
      <>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </>
    ),
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  },
];

/**
 * Light / system / dark, as one segmented control rather than a toggle: a
 * two-state switch cannot express "follow the OS", which is what most people
 * actually want and what the app starts on.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const choice = useTheme((s) => s.choice);
  const setChoice = useTheme((s) => s.setChoice);

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={`flex items-center gap-0.5 rounded-lg border border-ink-600 bg-ink-700/60 p-0.5 ${className}`}
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={choice === option.value}
          aria-label={option.label}
          title={option.label}
          onClick={() => setChoice(option.value)}
          className={`rounded-md p-1.5 transition ${
            choice === option.value
              ? 'bg-ink-900 text-accent shadow-sm'
              : 'text-slate-500 hover:text-slate-200'
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {option.icon}
          </svg>
        </button>
      ))}
    </div>
  );
}
