import { Workspace } from "@/components/app/workspace";

// The workspace — the main page. Prompt-first; submitting runs the build →
// validation → verdict thread (mocked, ready to wire to the API).
export default function WorkspacePage() {
  return <Workspace />;
}
