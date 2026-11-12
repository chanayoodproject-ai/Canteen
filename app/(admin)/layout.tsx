import { AppShell } from "@/components/shell";
import { isSupabaseConfigured } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AppShell supabase={isSupabaseConfigured()}>{children}</AppShell>;
}
