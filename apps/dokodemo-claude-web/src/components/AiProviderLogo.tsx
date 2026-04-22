import type { AiProvider } from '../types';

interface AiProviderLogoProps {
  provider: AiProvider;
  className?: string;
}

export function AiProviderLogo({
  provider,
  className,
}: AiProviderLogoProps) {
  if (provider === 'claude') {
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className={className}
        fill="currentColor"
      >
        <path d="M12 2.5 13.9 7.4 19.2 5.8 17 10.5 21.5 12.5 17 14.5 19.2 19.2 13.9 17.6 12 22.5 10.1 17.6 4.8 19.2 7 14.5 2.5 12.5 7 10.5 4.8 5.8 10.1 7.4 12 2.5Z" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m12 2.5 7.5 4.25v8.5L12 19.5l-7.5-4.25v-8.5L12 2.5Z" />
      <path d="m8.25 9.25 3.75 2.25 3.75-2.25" />
      <path d="M8.25 14.75 12 12.5l3.75 2.25" />
    </svg>
  );
}

export default AiProviderLogo;
