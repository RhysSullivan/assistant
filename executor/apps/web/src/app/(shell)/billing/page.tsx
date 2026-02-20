import { redirect } from "next/navigation";

export default function BillingRedirectPage() {
  redirect("/organization?tab=billing");
}
