import { Skeleton } from "@/components/Skeleton";

export default function BookingsLoading() {
  return (
    <div className="h-full flex flex-col w-full max-w-5xl mx-auto">
      <Skeleton className="h-7 w-40 mb-5" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    </div>
  );
}
