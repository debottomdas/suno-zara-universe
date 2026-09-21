import { NextResponse } from "next/server";

import { createClient } from "@/utils/supabase/server";

export async function GET(request: Request) {
  try {
    /*
     * 1. Verify logged-in user.
     */
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        {
          error:
            "Please sign in to view version history.",
        },
        { status: 401 }
      );
    }

    /*
     * 2. Read project ID.
     */
    const { searchParams } =
      new URL(request.url);

    const projectId =
      searchParams.get("projectId");

    if (
      typeof projectId !== "string" ||
      !projectId.trim()
    ) {
      return NextResponse.json(
        { error: "Invalid project." },
        { status: 400 }
      );
    }

    /*
     * 3. Load current song.
     *
     * RLS ensures the user can only see
     * their own project.
     */
    const {
      data: project,
      error: projectError,
    } = await supabase
      .from("songs")
      .select(`
        id,
        title,
        lyrics,
        updated_at
      `)
      .eq("id", projectId)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        {
          error:
            "Song not found or you do not have access to it.",
        },
        { status: 404 }
      );
    }

    /*
     * 4. Load saved versions oldest first.
     *
     * This preserves the same numerical
     * index behaviour used by the existing UI.
     */
    const {
      data: savedVersions,
      error: versionsError,
    } = await supabase
      .from("song_versions")
      .select(`
        id,
        title,
        lyrics,
        version_type,
        original_text,
        replacement_text,
        occurrence_index,
        created_at
      `)
      .eq("song_id", projectId)
      .order("created_at", {
        ascending: true,
      });

    if (versionsError) {
      console.error(
        "Version history load error:",
        versionsError
      );

      return NextResponse.json(
        {
          error:
            "Failed to load version history.",
        },
        { status: 500 }
      );
    }

    const versions =
      (savedVersions ?? []).map(
        (version, index) => ({
          index,

          savedAt:
            version.created_at,

          type:
            version.version_type,

          title:
            version.title,

          lyrics:
            version.lyrics,

          /*
           * Preserve fields expected by
           * the existing Studio UI.
           */
          rewrittenSection:
            version.version_type ===
            "before-section-rewrite"
              ? version.original_text ||
                undefined
              : undefined,

          instruction:
            version.version_type ===
            "before-section-rewrite"
              ? version.replacement_text ||
                undefined
              : undefined,

          restoredFromVersion:
            version.version_type ===
            "before-version-restore"
              ? version.occurrence_index ??
                undefined
              : undefined,

          originalText:
            version.original_text ||
            undefined,

          replacementText:
            version.replacement_text ||
            undefined,

          occurrenceIndex:
            version.occurrence_index ??
            undefined,
        })
      );

    return NextResponse.json({
      current: {
        title:
          project.title || "",
        lyrics:
          project.lyrics || "",
        updatedAt:
          project.updated_at || null,
      },

      versions,
    });
  } catch (error) {
    console.error(
      "Version history load error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to load version history.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    /*
     * 1. Verify logged-in user.
     */
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        {
          error:
            "Please sign in to restore a version.",
        },
        { status: 401 }
      );
    }

    /*
     * 2. Validate request.
     */
    const body = await request.json();

    const {
      projectId,
      versionIndex,
    } = body;

    if (
      typeof projectId !== "string" ||
      !projectId.trim()
    ) {
      return NextResponse.json(
        { error: "Invalid project." },
        { status: 400 }
      );
    }

    if (
      typeof versionIndex !== "number" ||
      !Number.isInteger(versionIndex) ||
      versionIndex < 0
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid version selected.",
        },
        { status: 400 }
      );
    }

    /*
     * 3. Load current song.
     */
    const {
      data: project,
      error: projectError,
    } = await supabase
      .from("songs")
      .select(`
        id,
        title,
        lyrics,
        status,
        created_at,
        updated_at
      `)
      .eq("id", projectId)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        {
          error:
            "Song not found or you do not have access to it.",
        },
        { status: 404 }
      );
    }

    /*
     * 4. Load versions in exactly the same
     * order used by GET.
     */
    const {
      data: savedVersions,
      error: versionsError,
    } = await supabase
      .from("song_versions")
      .select(`
        id,
        title,
        lyrics,
        created_at
      `)
      .eq("song_id", projectId)
      .order("created_at", {
        ascending: true,
      });

    if (versionsError) {
      console.error(
        "Version lookup error:",
        versionsError
      );

      return NextResponse.json(
        {
          error:
            "Failed to load saved versions.",
        },
        { status: 500 }
      );
    }

    const version =
      savedVersions?.[versionIndex];

    if (
      !version ||
      typeof version.lyrics !== "string"
    ) {
      return NextResponse.json(
        {
          error:
            "Saved version not found.",
        },
        { status: 404 }
      );
    }

    const now =
      new Date().toISOString();

    /*
     * 5. Preserve CURRENT song before
     * restoring the older version.
     */
    if (project.lyrics) {
      const {
        error: preserveError,
      } = await supabase
        .from("song_versions")
        .insert({
          song_id: project.id,
          user_id: user.id,

          title:
            project.title,

          lyrics:
            project.lyrics,

          version_type:
            "before-version-restore",

          occurrence_index:
            versionIndex,

          created_at:
            project.updated_at || now,
        });

      if (preserveError) {
        console.error(
          "Current version preservation error:",
          preserveError
        );

        return NextResponse.json(
          {
            error:
              "The current song could not be preserved, so the restore was cancelled.",
          },
          { status: 500 }
        );
      }
    }

    /*
     * 6. Restore selected version
     * into the main songs table.
     */
    const restoredTitle =
      version.title ||
      project.title ||
      null;

    const {
      data: restoredSong,
      error: restoreError,
    } = await supabase
      .from("songs")
      .update({
        title:
          restoredTitle,

        lyrics:
          version.lyrics,

        status:
          "song-generated",

        updated_at:
          now,
      })
      .eq("id", project.id)
      .select(`
        id,
        title,
        lyrics,
        status,
        updated_at
      `)
      .single();

    if (
      restoreError ||
      !restoredSong
    ) {
      console.error(
        "Version restore update error:",
        restoreError
      );

      return NextResponse.json(
        {
          error:
            "Failed to restore version.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      restored: true,

      title:
        restoredSong.title || "",

      lyrics:
        restoredSong.lyrics,
    });
  } catch (error) {
    console.error(
      "Version restore error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to restore version.",
      },
      { status: 500 }
    );
  }
}
