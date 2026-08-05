import { requirePageUser } from "@/lib/page-auth";
import { getOptionSetsForUser } from "@/lib/queries";
import Considering from "@/screens/Considering";

export const dynamic = "force-dynamic";

export default async function ConsideringRoute() {
  const user = await requirePageUser();
  const optionSets = await getOptionSetsForUser(user.id, null);
  return <Considering initialSets={optionSets} />;
}
