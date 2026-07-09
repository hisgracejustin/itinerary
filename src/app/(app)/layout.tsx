import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = {
    email: session.user.email ?? "",
    name: session.user.name ?? null,
  };

  return <AppShell user={user}>{children}</AppShell>;
}
