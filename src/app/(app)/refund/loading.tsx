import { Skeleton } from "@/components/Skeleton";

export default function RefundLoading() {
  return (
    <div className="h-full flex flex-col w-full max-w-5xl lg:max-w-6xl mx-auto">
      <Skeleton className="h-7 w-24 mb-5" />
      <Skeleton className="h-96" />
    </div>
  );
}
