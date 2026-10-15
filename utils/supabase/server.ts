import { createServerClient } from "@supabase/ssr";
import { createLocalDatabase } from "@/utils/local-first/database";
import { localModeAvailable } from "@/utils/local-first/store";
import { cookies, headers } from "next/headers";

export async function createClient() {
  const host = (await headers()).get("host");
  if (localModeAvailable() && ["localhost:3000", "127.0.0.1:3000"].includes(host || "")) {
    return createLocalDatabase() as unknown as Awaited<ReturnType<typeof createCloudClient>>;
  }
  return createCloudClient();
}

async function createCloudClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // This can happen when called from a Server Component.
            // Session refresh will be handled by middleware later.
          }
        },
      },
    }
  );
}
