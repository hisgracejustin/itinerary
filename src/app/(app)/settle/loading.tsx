import { Skeleton } from "@/components/Skeleton";

export default function SettleLoading() {
  return (
    <div className="h-full flex flex-col w-full max-w-3xl mx-auto">
      <Skeleton className="h-7 w-28 mb-5" />
      <div className="space-y-4">
        <Skeleton className="h-40" />
        <Skeleton className="h-32" />
        <Skeleton className="h-24" />
      </div>
    </div>
  );
}
