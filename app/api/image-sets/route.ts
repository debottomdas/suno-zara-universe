import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type ImageFormat = "youtube" | "shorts";

export async function POST(request: Request) {
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

    const body = await request.json();

    const projectId = String(body.projectId || "").trim();
    const conceptId = String(body.conceptId || "").trim();
    const format = String(body.format || "").trim() as ImageFormat;

    if (!projectId || !conceptId) {
      return NextResponse.json(
        { error: "projectId and conceptId are required." },
        { status: 400 }
      );
    }

    if (format !== "youtube" && format !== "shorts") {
      return NextResponse.json(
        { error: "format must be youtube or shorts." },
        { status: 400 }
      );
    }

    // Confirm song ownership.
    const { data: song, error: songError } = await supabase
      .from("songs")
      .select("id")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .single();

    if (songError || !song) {
      return NextResponse.json(
        { error: "Song not found." },
        { status: 404 }
      );
    }

    // Confirm the visual concept belongs to this song/user.
    const { data: concept, error: conceptError } = await supabase
      .from("song_visual_concepts")
      .select("id")
      .eq("id", conceptId)
      .eq("song_id", projectId)
      .eq("user_id", user.id)
      .single();

    if (conceptError || !concept) {
      return NextResponse.json(
        { error: "Visual concept not found." },
        { status: 404 }
      );
    }

    // Find the current image set, if one exists.
    const { data: currentSets, error: currentSetError } =
      await supabase
        .from("song_image_sets")
        .select(
          `
          id,
          set_number,
          concept_id,
          is_current,
          created_at
          `
        )
        .eq("song_id", projectId)
        .eq("user_id", user.id)
        .eq("is_current", true)
        .order("set_number", {
          ascending: false,
        })
        .limit(1);

    if (currentSetError) {
      throw new Error(
        `Could not load current image set: ${currentSetError.message}`
      );
    }

    const currentSet = currentSets?.[0] || null;

    // Reuse the current set only when:
    // 1. it belongs to the same selected concept, and
    // 2. this format has not yet been generated into it.
    if (
      currentSet &&
      currentSet.concept_id === conceptId
    ) {
      const { data: existingFormatImages, error: formatCheckError } =
        await supabase
          .from("song_images")
          .select("id")
          .eq("song_id", projectId)
          .eq("user_id", user.id)
          .eq("image_set_id", currentSet.id)
          .eq("format", format)
          .limit(1);

      if (formatCheckError) {
        throw new Error(
          `Could not inspect current image set: ${formatCheckError.message}`
        );
      }

      if (!existingFormatImages?.length) {
        return NextResponse.json({
          imageSet: {
            id: currentSet.id,
            setNumber: currentSet.set_number,
            conceptId: currentSet.concept_id,
            isCurrent: true,
          },
          created: false,
        });
      }
    }

    // Find the next generation-set number.
    const { data: latestSets, error: latestSetError } =
      await supabase
        .from("song_image_sets")
        .select("set_number")
        .eq("song_id", projectId)
        .eq("user_id", user.id)
        .order("set_number", {
          ascending: false,
        })
        .limit(1);

    if (latestSetError) {
      throw new Error(
        `Could not determine next image set: ${latestSetError.message}`
      );
    }

    const nextSetNumber =
      (latestSets?.[0]?.set_number || 0) + 1;

    // Create the new set first.
    const { data: newSet, error: insertSetError } =
      await supabase
        .from("song_image_sets")
        .insert({
          song_id: projectId,
          user_id: user.id,
          concept_id: conceptId,
          set_number: nextSetNumber,
          is_current: true,
        })
        .select(
          `
          id,
          set_number,
          concept_id,
          is_current,
          created_at
          `
        )
        .single();

    if (insertSetError || !newSet) {
      throw new Error(
        `Could not create image set: ${
          insertSetError?.message || "Unknown error"
        }`
      );
    }

    // Previous generations become historical sets.
    const { error: oldSetsError } = await supabase
      .from("song_image_sets")
      .update({
        is_current: false,
      })
      .eq("song_id", projectId)
      .eq("user_id", user.id)
      .neq("id", newSet.id);

    if (oldSetsError) {
      throw new Error(
        `Image set was created but previous sets could not be archived: ${oldSetsError.message}`
      );
    }

    return NextResponse.json({
      imageSet: {
        id: newSet.id,
        setNumber: newSet.set_number,
        conceptId: newSet.concept_id,
        isCurrent: true,
      },
      created: true,
    });
  } catch (error) {
    console.error("Image set error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to prepare image generation set.",
      },
      { status: 500 }
    );
  }
}
