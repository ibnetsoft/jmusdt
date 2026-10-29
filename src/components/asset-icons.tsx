type IconProps = { label: string };
export function LuckyBagIcon({label}: IconProps) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={label}>
    <path d="M8.1 8.4C7 6.9 5.4 5.2 6.5 3.8c.9-1.1 2.4.5 3.3-.2.7-.6.4-1.8 1.8-1.8 1.8 0 1.9 1.8 3.3 2.1 1.2.2 2.3-.7 3.1.3 1 1.4-.8 3.3-2 4.2" />
    <path d="M8.1 8.4h7.8a1.1 1.1 0 0 1 0 2.2H8.1a1.1 1.1 0 0 1 0-2.2Z" />
    <path d="M8.5 10.6C5.4 12.6 3 15.8 3 18.6c0 2.5 3.2 3.2 7.5 3.2h3c4.3 0 7.5-.7 7.5-3.2 0-2.8-2.4-6-5.5-8" />
    <path d="M9.2 10.6v3m0 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Zm-.8 2.6-.3 3.6h2.2l-.3-3.6M18.5 3v2M17.5 4h2" />
  </svg>;
}
export function TreasureChestIcon({label}: IconProps) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={label}>
    <path d="M3 10V8a6 6 0 0 1 6-6h6a6 6 0 0 1 6 6v2M2.5 10h19v9a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-9ZM2.5 14h19M2.5 18h19M6 10v11M18 10v11" />
    <path d="M9.3 9h5.4v3a2.7 2.7 0 0 1-5.4 0V9ZM12 10.5v1M8 5h2M14 5h2" />
  </svg>;
}
