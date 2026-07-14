import { Skeleton } from "@/components/Skeleton";

export default function TodosLoading() {
  return (
    <div className="h-full flex flex-col w-full max-w-3xl mx-auto">
      <Skeleton className="h-7 w-28 mb-5" />
      <Skeleton className="h-16 w-full mb-4" />
      <div className="space-y-1.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}
