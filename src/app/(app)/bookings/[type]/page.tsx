import BookingsByType from "@/screens/BookingsByType";

export default async function BookingsByTypeRoute({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  return <BookingsByType type={type} />;
}
