import { redirect } from "next/navigation";

// Auth comes later — for now, signing up drops you straight into the workspace.
export default function SignupPage() {
  redirect("/app");
}
