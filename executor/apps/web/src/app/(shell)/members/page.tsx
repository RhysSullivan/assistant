import { redirect } from "next/navigation";

export default function MembersRedirectPage() {
  redirect("/organization?tab=members");
}
