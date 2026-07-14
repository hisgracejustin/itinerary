import { Skeleton } from "@/components/Skeleton";

// Fallback for the Calendar route (and any (app) route without its own
// loading.tsx). Shows during the server fetch on first load / hard navigation.
export default function CalendarLoading() {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <Skeleton className="h-7 w-40" />
        <div className="flex gap-1.5">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
      <div className="flex-1 mat-surface p-4">
        <div className="grid grid-cols-7 gap-2 h-full auto-rows-fr">
          {Array.from({ length: 35 }).map((_, i) => (
            <Skeleton key={i} className="min-h-14" />
          ))}
        </div>
      </div>
    </div>
  );
}
