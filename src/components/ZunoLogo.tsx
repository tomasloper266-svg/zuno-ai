import { useId } from 'react'

/**
 * ZUNO mark — an original "Z" whose joints terminate in connection nodes,
 * standing for connected intelligence. Gradient flows cyan → violet.
 */
export function ZunoLogo({ size = 32 }: { size?: number }): React.JSX.Element {
  const gradientId = useId()
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <defs>
        <linearGradient id={gradientId} x1="6" y1="7" x2="30" y2="29" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-3)" />
        </linearGradient>
      </defs>
      <path
        d="M9 9.5h18L9 26.5h18"
        stroke={`url(#${gradientId})`}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="9" cy="9.5" r="2.5" fill="var(--accent)" />
      <circle cx="27" cy="9.5" r="2.5" fill="var(--accent-3)" />
      <circle cx="9" cy="26.5" r="2.5" fill="var(--accent-3)" />
      <circle cx="27" cy="26.5" r="2.5" fill="var(--accent)" />
    </svg>
  )
}

export function Brand({ compact = false }: { compact?: boolean }): React.JSX.Element {
  return (
    <span className={compact ? 'header-brand' : 'brand'} dir="ltr">
      <ZunoLogo size={compact ? 22 : 30} />
      <span>ZUNO</span>
      <span className="brand-ai">AI</span>
    </span>
  )
}
