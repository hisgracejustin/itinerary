import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="mat-surface p-8 max-w-sm w-full text-center">
        <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center mb-4 mx-auto">
          <span className="text-2xl">🧭</span>
        </div>
        <p className="text-sm font-medium text-on-surface">Page not found</p>
        <p className="text-xs mt-1 text-on-surface-variant/70">
          That link doesn&apos;t go anywhere.
        </p>
        <Link href="/" className="mat-btn-filled mt-5">
          Back to your trips
        </Link>
      </div>
    </div>
  );
}
