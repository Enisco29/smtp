import { redirect } from "next/navigation";
import { getSessionDestination } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function Home() {
  redirect(await getSessionDestination());
}
