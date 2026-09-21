import { NextResponse } from "next/server";

import { createClient } from "@/utils/supabase/server";

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
            "Please sign in to apply an alternative.",
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
      originalText,
      replacementText,
      occurrenceIndex,
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
      typeof originalText !== "string" ||
      !originalText.trim()
    ) {
      return NextResponse.json(
        {
          error:
            "Original lyric text is required.",
        },
        { status: 400 }
      );
    }

    if (
      typeof replacementText !== "string" ||
      !replacementText.trim()
    ) {
      return NextResponse.json(
        {
          error:
            "Replacement lyric text is required.",
        },
        { status: 400 }
      );
    }

    if (
      typeof occurrenceIndex !== "number" ||
      !Number.isInteger(occurrenceIndex) ||
      occurrenceIndex < 0
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid lyric occurrence selected.",
        },
        { status: 400 }
      );
    }

    /*
     * 3. Load current song from Supabase.
     *
     * RLS ensures only the owner can access it.
     */
    const {
      data: project,
      error: projectError,
    } = await supabase
      .from("songs")
      .select(`
        id,
        title,
        idea,
        language,
        script,
        mood,
        genre,
        freedom,
        hooks,
        selected_hook,
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

    if (
      typeof project.lyrics !== "string" ||
      !project.lyrics.trim()
    ) {
      return NextResponse.json(
        {
          error:
            "This project does not have a full song yet.",
        },
        { status: 400 }
      );
    }

    /*
     * 4. Find every exact occurrence.
     *
     * This preserves the behaviour you already tested:
     * only the selected occurrence gets replaced.
     */
    const source =
      originalText.trim();

    const replacement =
      replacementText.trim();

    const positions: number[] = [];

    let searchFrom = 0;

    while (true) {
      const foundAt =
        project.lyrics.indexOf(
          source,
          searchFrom
        );

      if (foundAt === -1) {
        break;
      }

      positions.push(foundAt);

      searchFrom =
        foundAt + source.length;
    }

    if (positions.length === 0) {
      return NextResponse.json(
        {
          error:
            "The selected lyric could not be found in the current song. It may have changed since the analysis was created.",
        },
        { status: 409 }
      );
    }

    if (
      occurrenceIndex >=
      positions.length
    ) {
      return NextResponse.json(
        {
          error:
            "That lyric occurrence is no longer available.",
        },
        { status: 409 }
      );
    }

    /*
     * 5. Replace only the selected occurrence.
     */
    const replaceAt =
      positions[occurrenceIndex];

    const updatedLyrics =
      project.lyrics.slice(
        0,
        replaceAt
      ) +
      replacement +
      project.lyrics.slice(
        replaceAt + source.length
      );

    const now =
      new Date().toISOString();

    /*
     * 6. Preserve current full song before
     * applying the alternative.
     */
    const {
      error: versionError,
    } = await supabase
      .from("song_versions")
      .insert({
        song_id:
          project.id,

        user_id:
          user.id,

        title:
          project.title,

        lyrics:
          project.lyrics,

        version_type:
          "before-alternative-replacement",

        original_text:
          source,

        replacement_text:
          replacement,

        occurrence_index:
          occurrenceIndex,

        created_at:
          project.updated_at || now,
      });

    if (versionError) {
      console.error(
        "Alternative version save error:",
        versionError
      );

      return NextResponse.json(
        {
          error:
            "The previous version could not be preserved, so the alternative was not applied.",
        },
        { status: 500 }
      );
    }

    /*
     * 7. Save updated song in Supabase.
     */
    const {
      data: updatedSong,
      error: updateError,
    } = await supabase
      .from("songs")
      .update({
        lyrics:
          updatedLyrics,

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
      updateError ||
      !updatedSong
    ) {
      console.error(
        "Alternative update error:",
        updateError
      );

      return NextResponse.json(
        {
          error:
            "Failed to save the alternative.",
        },
        { status: 500 }
      );
    }


    /*
     * 9. Return same response shape
     * expected by the current UI.
     */
    return NextResponse.json({
      saved: true,

      title:
        updatedSong.title || "",

      lyrics:
        updatedSong.lyrics,

      replacementText:
        replacement,

      occurrenceCount:
        positions.length,
    });
  } catch (error) {
    console.error(
      "Apply alternative error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to apply the alternative.",
      },
      { status: 500 }
    );
  }
}
