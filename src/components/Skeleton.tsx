/** A pulsing placeholder block for loading.tsx skeletons. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-surface-container ${className}`} />;
}
