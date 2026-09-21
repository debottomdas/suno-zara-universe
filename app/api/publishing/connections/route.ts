import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "You must be signed in." },
        { status: 401 }
      );
    }

    const { data, error } = await supabase
      .from("publishing_connections")
      .select(
        `
        id,
        platform,
        external_account_id,
        display_name,
        handle,
        account_type,
        status,
        is_primary,
        scopes,
        metadata,
        connected_at,
        last_verified_at,
        created_at,
        updated_at
        `
      )
      .eq("user_id", user.id)
      .order("platform", { ascending: true })
      .order("is_primary", { ascending: false });

    if (error) {
      throw new Error(`Could not load publishing connections: ${error.message}`);
    }

    return NextResponse.json({ connections: data || [] });
  } catch (error) {
    console.error("Publishing connections GET error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load publishing connections.",
      },
      { status: 500 }
    );
  }
}
