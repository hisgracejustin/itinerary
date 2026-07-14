import { Skeleton } from "@/components/Skeleton";

export default function CostsLoading() {
  return (
    <div className="h-full flex flex-col w-full max-w-5xl mx-auto">
      <Skeleton className="h-7 w-24 mb-5" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-28 lg:col-span-2" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
