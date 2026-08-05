import { Skeleton } from "@/components/Skeleton";

export default function ConsideringLoading() {
  return (
    <div className="w-full max-w-5xl mx-auto">
      <Skeleton className="h-7 w-40 mb-2" />
      <Skeleton className="h-4 w-72 mb-5" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
