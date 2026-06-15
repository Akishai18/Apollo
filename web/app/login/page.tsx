import { redirect } from "next/navigation";

// Auth comes later — for now, entering the app drops you straight into the workspace.
export default function LoginPage() {
  redirect("/app");
}
