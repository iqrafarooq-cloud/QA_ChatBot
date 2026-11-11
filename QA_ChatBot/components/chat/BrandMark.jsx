// QA ChatBot's own mark: a friendly robot head whose mouth is a check mark ("the bot that verifies").
// Drawn by hand instead of using a stock icon so the brand doesn't read as a generic AI glyph.
export default function BrandMark({ size = 20, className = "", strokeWidth = 2 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <g transform="translate(0 1)">
        <circle cx="12" cy="3.2" r="1.3" fill="currentColor" stroke="none" />
        <path d="M12 4.8v2.7" />
        <rect x="4.5" y="7.5" width="15" height="11.5" rx="3.5" />
        <path d="M2.5 11.5v3.5M21.5 11.5v3.5" />
        <circle cx="9.2" cy="12" r="1.35" fill="currentColor" stroke="none" />
        <circle cx="14.8" cy="12" r="1.35" fill="currentColor" stroke="none" />
        <path d="M10.1 15.4l1.4 1.2 2.6-2.1" />
      </g>
    </svg>
  );
}
