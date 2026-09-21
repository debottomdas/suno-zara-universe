import { NextResponse } from "next/server";
import OpenAI from "openai";
import sharp from "sharp";
import { createClient } from "@/utils/supabase/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type ImageFormat = "youtube" | "shorts";

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function fittedFontSize(
  value: string,
  width: number,
  preferred: number,
  minimum: number
) {
  const length = Math.max(Array.from(value).length, 1);

  return Math.max(
    minimum,
    Math.min(
      preferred,
      Math.floor((width * 0.78) / (length * 0.58))
    )
  );
}

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
    const imageNumber = Number(body.imageNumber);

    const imageSetId = String(
      body.imageSetId || ""
    ).trim();

    const shotBrief = String(
      body.shotBrief || ""
    ).trim();

    const imageCustomText = String(
      body.imageCustomText || ""
    ).trim();

    const imageUseSongTitle =
      body.imageUseSongTitle !== false;

    const imageIncludeBranding =
      body.imageIncludeBranding !== false;

    const requestedTextPosition = String(
      body.imageTextPosition || "bottom"
    );

    const imageTextPosition:
      | "top"
      | "center"
      | "bottom" =
      requestedTextPosition === "top" ||
      requestedTextPosition === "center"
        ? requestedTextPosition
        : "bottom";

    const requestedFontStyle = String(
      body.imageFontStyle || "cinematic"
    );

    const imageFontStyle:
      | "minimal"
      | "elegant"
      | "cinematic"
      | "retro"
      | "handwritten" =
      requestedFontStyle === "minimal" ||
      requestedFontStyle === "elegant" ||
      requestedFontStyle === "retro" ||
      requestedFontStyle === "handwritten"
        ? requestedFontStyle
        : "cinematic";

    const requestedFontSize = String(
      body.imageFontSize || "medium"
    );

    const imageFontSize:
      | "small"
      | "medium"
      | "large"
      | "xlarge" =
      requestedFontSize === "small" ||
      requestedFontSize === "large" ||
      requestedFontSize === "xlarge"
        ? requestedFontSize
        : "medium";

    if (!projectId || !conceptId) {
      return NextResponse.json(
        { error: "projectId and conceptId are required." },
        { status: 400 }
      );
    }

    if (format !== "youtube" && format !== "shorts") {
      return NextResponse.json(
        { error: "format must be either youtube or shorts." },
        { status: 400 }
      );
    }

    if (
      !Number.isInteger(imageNumber) ||
      imageNumber < 1 ||
      imageNumber > 10
    ) {
      return NextResponse.json(
        { error: "imageNumber must be between 1 and 10." },
        { status: 400 }
      );
    }

    const { data: song, error: songError } = await supabase
      .from("songs")
      .select(
        `
        id,
        user_id,
        title,
        lyrics,
        language,
        mood,
        genre
        `
      )
      .eq("id", projectId)
      .eq("user_id", user.id)
      .single();

    if (songError || !song) {
      return NextResponse.json(
        { error: "Song not found." },
        { status: 404 }
      );
    }

    const { data: concept, error: conceptError } = await supabase
      .from("song_visual_concepts")
      .select(
        `
        id,
        song_id,
        user_id,
        title,
        description,
        image_prompt,
        user_ideas
        `
      )
      .eq("id", conceptId)
      .eq("song_id", song.id)
      .eq("user_id", user.id)
      .single();

    if (conceptError || !concept) {
      return NextResponse.json(
        { error: "Visual concept not found." },
        { status: 404 }
      );
    }

    let imageSetNumber: number | null = null;

    if (imageSetId) {
      const { data: imageSet, error: imageSetError } =
        await supabase
          .from("song_image_sets")
          .select("id, set_number, concept_id")
          .eq("id", imageSetId)
          .eq("song_id", song.id)
          .eq("user_id", user.id)
          .eq("concept_id", concept.id)
          .single();

      if (imageSetError || !imageSet) {
        return NextResponse.json(
          { error: "Image generation set not found." },
          { status: 404 }
        );
      }

      imageSetNumber = imageSet.set_number;
    }

    const isYouTube = format === "youtube";

    const size = isYouTube
      ? "1536x864"
      : "864x1536";

    const aspectInstruction = isYouTube
      ? `
Create a cinematic 16:9 landscape composition for a full YouTube music video.

Important composition rules:
- exact landscape framing
- strong central or rule-of-thirds visual focus
- leave some natural breathing room where title typography could later be placed
- do NOT actually render any title, logo, watermark or lettering
- composition must still work when viewed as a YouTube thumbnail
`
      : `
Create a cinematic 9:16 vertical composition for YouTube Shorts, Instagram Reels and TikTok.

Important composition rules:
- exact portrait framing
- important subject matter must remain inside the central safe area
- avoid placing important faces or details at the extreme top or bottom
- create strong immediate visual impact for mobile viewing
- do NOT render any title, logo, watermark or lettering
`;

    const youtubeVariationInstructions: Record<number, string> = {
      1: `
VARIATION ROLE: CINEMATIC ESTABLISHING IMAGE.

Create a wide, atmospheric interpretation of the selected concept.

- emphasise environment, location and visual world
- use a noticeably wider camera perspective
- subject may be smaller or placed off-centre
- create strong foreground, middle-ground and background depth
- establish the emotional world of the song
- avoid a conventional centred portrait
- this must feel like an establishing frame from a film
`,

      2: `
VARIATION ROLE: HUMAN / EMOTIONAL IMAGE.

Create a different moment from the same concept, centred on emotion and body language.

- use a medium or medium-close composition
- make the human emotional moment the strongest element
- use clearly different subject placement from the establishing image
- change camera height or viewing angle
- choose a different gesture, interaction or moment in the story
- do not simply reproduce the same pose or background
- favour natural candid cinematic behaviour over a posed poster
`,

      3: `
VARIATION ROLE: ARTISTIC / SYMBOLIC IMAGE.

Reinterpret the selected concept through a substantially different visual idea.

- do NOT repeat the obvious establishing scene
- use an unusual cinematic composition
- consider close detail, silhouette, reflection, foreground obstruction,
  negative space, symbolic object, visual metaphor or unexpected perspective
- show a different emotional beat or moment in the story
- the result should immediately look different from a normal character portrait
- preserve the song's emotional meaning while taking a more art-directed approach
`,
    };

    const shortsVariationInstructions: Record<number, string> = {
      1: `
VARIATION ROLE: VERTICAL ESTABLISHING FRAME.
Show the visual world and environment with strong vertical depth.
Use layered foreground/background composition and avoid a centred portrait.
`,

      2: `
VARIATION ROLE: INTIMATE CHARACTER FRAME.
Use a medium-close emotional moment with expressive but natural body language.
Choose a noticeably different scene or moment.
`,

      3: `
VARIATION ROLE: MOVEMENT FRAME.
Capture walking, turning, reaching, leaving, arriving or another meaningful action.
The image should feel like a frame caught during motion.
`,

      4: `
VARIATION ROLE: SYMBOLIC FRAME.
Use an important object, environment detail, reflection, shadow or visual metaphor
connected to the song rather than relying on a conventional portrait.
`,

      5: `
VARIATION ROLE: CINEMATIC NEGATIVE-SPACE FRAME.
Use strong architecture, landscape, foreground obstruction or negative space.
Place the subject unusually within the vertical composition.
`,

      6: `
VARIATION ROLE: EMOTIONAL CLOSE FRAME.
Create a visually intimate final variation with a close detail, profile,
back-view, silhouette or other emotionally expressive perspective.
Do not repeat the composition of the other variations.
`,
    };

    const variationInstruction = `
This is artwork variation ${imageNumber}.

${
  isYouTube
    ? youtubeVariationInstructions[imageNumber] ||
      youtubeVariationInstructions[1]
    : shortsVariationInstructions[imageNumber] ||
      shortsVariationInstructions[1]
}

CRITICAL VARIATION RULES:

- treat this variation role as mandatory, not optional
- do not default to the same centred subject composition
- vary the narrative moment, framing and visual hierarchy
- the images in this set must look clearly different at thumbnail size
- preserve the selected concept's identity and the song's emotional meaning
- variation means a genuinely different image, not merely another colour grade
`;

    const prompt = `
You are creating premium artwork for an original song.

SONG TITLE:
${song.title || "Untitled"}

LANGUAGE:
${song.language || "Not specified"}

MOOD:
${song.mood || "Not specified"}

GENRE:
${song.genre || "Not specified"}

SELECTED VISUAL CONCEPT:
${concept.title}

CONCEPT DESCRIPTION:
${concept.description}

MASTER ART DIRECTION:
${concept.image_prompt}

OPTIONAL CREATOR NOTES:
${concept.user_ideas || "No additional notes."}

${aspectInstruction}

${variationInstruction}

${
  shotBrief
    ? `
MANDATORY UNIQUE SHOT BRIEF:

${shotBrief}

This shot brief overrides any generic composition tendency.
Follow its camera distance, scene, subject treatment, narrative moment,
visual focus and composition closely.

The resulting image must NOT collapse back into a generic centred
music-poster composition.
`
    : ""
}

ARTWORK RULES:
- professional music-release artwork
- cinematic and emotionally specific
- natural human anatomy
- believable hands and faces
- coherent clothing and environment
- no random text
- no subtitles
- no logos
- no watermark
- no UI elements
- no collage
- no split-screen
- no copyrighted characters
- no celebrity likeness
- avoid generic AI-poster aesthetics
- do not make the image unnecessarily dark
- preserve culturally appropriate Indian/Bengali/Hindi context when relevant
- the image should feel like a frame from a beautifully art-directed music film

Generate one finished image.
`.trim();

    const result = await openai.images.generate({
      model: "gpt-image-2.5-flare",
      prompt,
      size: size as any,
      quality: "medium",
      output_format: "png",
    });

    const imageBase64 = result.data?.[0]?.b64_json;

    if (!imageBase64) {
      throw new Error("OpenAI did not return image data.");
    }

    const imageBuffer = Buffer.from(imageBase64, "base64");

    const outputWidth = isYouTube ? 1536 : 864;
    const outputHeight = isYouTube ? 864 : 1536;

    const titleText =
      imageUseSongTitle && song.title
        ? String(song.title).trim()
        : "";

    const customText = imageCustomText;

    const mainTextLines = [
      titleText,
      customText,
    ].filter(Boolean);

    let finalImageBuffer = imageBuffer;

    if (
      mainTextLines.length > 0 ||
      imageIncludeBranding
    ) {
      const fontSizeMultiplier =
        imageFontSize === "small"
          ? 0.78
          : imageFontSize === "large"
          ? 1.20
          : imageFontSize === "xlarge"
          ? 1.40
          : 1;

      const preferredTitleSize = Math.round(
        (isYouTube ? 78 : 58) * fontSizeMultiplier
      );

      const preferredCustomSize = Math.round(
        (isYouTube ? 48 : 40) * fontSizeMultiplier
      );

      const minimumTitleSize = Math.max(
        28,
        Math.round(
          (isYouTube ? 42 : 34) * fontSizeMultiplier
        )
      );

      const minimumCustomSize = Math.max(
        24,
        Math.round(
          (isYouTube ? 32 : 28) * fontSizeMultiplier
        )
      );

      const fontStyleConfig =
        imageFontStyle === "elegant"
          ? {
              family:
                "Noto Serif Bengali, Noto Serif Devanagari, Noto Serif, Georgia, serif",
              weight: 600,
              letterSpacing: 0,
              italic: true,
            }
          : imageFontStyle === "retro"
          ? {
              family:
                "Noto Serif Bengali, Noto Serif Devanagari, Noto Serif, Georgia, serif",
              weight: 700,
              letterSpacing: 3,
              italic: false,
            }
          : imageFontStyle === "handwritten"
          ? {
              family:
                "Noto Sans Bengali, Noto Sans Devanagari, Noto Sans, cursive",
              weight: 500,
              letterSpacing: 1,
              italic: true,
            }
          : imageFontStyle === "minimal"
          ? {
              family:
                "Noto Sans Bengali, Noto Sans Devanagari, Noto Sans, Arial, sans-serif",
              weight: 500,
              letterSpacing: 1,
              italic: false,
            }
          : {
              family:
                "Noto Sans Bengali, Noto Sans Devanagari, Noto Sans, Arial, sans-serif",
              weight: 800,
              letterSpacing: 4,
              italic: false,
            };

      let mainY =
        imageTextPosition === "top"
          ? outputHeight * 0.16
          : imageTextPosition === "center"
          ? outputHeight * 0.50
          : outputHeight * 0.74;

      const titleSize = titleText
        ? fittedFontSize(
            titleText,
            outputWidth,
            preferredTitleSize,
            minimumTitleSize
          )
        : 0;

      const customSize = customText
        ? fittedFontSize(
            customText,
            outputWidth,
            preferredCustomSize,
            minimumCustomSize
          )
        : 0;

      const lineGap = isYouTube ? 28 : 22;

      if (titleText && customText) {
        mainY -= (titleSize + customSize + lineGap) / 4;
      }

      const titleSvg = titleText
        ? `
          <text
            x="${outputWidth / 2}"
            y="${mainY}"
            text-anchor="middle"
            dominant-baseline="middle"
            font-family="${fontStyleConfig.family}"
            font-size="${titleSize}"
            font-weight="${fontStyleConfig.weight}"
            font-style="${fontStyleConfig.italic ? "italic" : "normal"}"
            letter-spacing="${fontStyleConfig.letterSpacing}"
            fill="white"
            stroke="rgba(0,0,0,0.80)"
            stroke-width="${isYouTube ? 6 : 5}"
            paint-order="stroke fill"
          >${escapeSvgText(titleText)}</text>
        `
        : "";

      const customY =
        mainY +
        (titleText
          ? titleSize * 0.82 + lineGap
          : 0);

      const customSvg = customText
        ? `
          <text
            x="${outputWidth / 2}"
            y="${customY}"
            text-anchor="middle"
            dominant-baseline="middle"
            font-family="${fontStyleConfig.family}"
            font-size="${customSize}"
            font-weight="${fontStyleConfig.weight}"
            font-style="${fontStyleConfig.italic ? "italic" : "normal"}"
            letter-spacing="${fontStyleConfig.letterSpacing}"
            fill="white"
            stroke="rgba(0,0,0,0.80)"
            stroke-width="${isYouTube ? 5 : 4}"
            paint-order="stroke fill"
          >${escapeSvgText(customText)}</text>
        `
        : "";

      const brandingSvg = imageIncludeBranding
        ? `
          <text
            x="${outputWidth / 2}"
            y="${outputHeight * 0.945}"
            text-anchor="middle"
            dominant-baseline="middle"
            font-family="Arial, sans-serif"
            font-size="${isYouTube ? 28 : 24}"
            font-weight="600"
            letter-spacing="2"
            fill="white"
            stroke="rgba(0,0,0,0.75)"
            stroke-width="3"
            paint-order="stroke fill"
          >Suno Zara Original</text>
        `
        : "";

      const overlaySvg = Buffer.from(`
        <svg
          width="${outputWidth}"
          height="${outputHeight}"
          xmlns="http://www.w3.org/2000/svg"
        >
          ${titleSvg}
          ${customSvg}
          ${brandingSvg}
        </svg>
      `);

      finalImageBuffer = await sharp(imageBuffer)
        .resize(outputWidth, outputHeight, {
          fit: "cover",
        })
        .composite([
          {
            input: overlaySvg,
            top: 0,
            left: 0,
          },
        ])
        .png()
        .toBuffer();
    }

    const storagePath = imageSetId
      ? `${user.id}/${song.id}/sets/set-${imageSetNumber}/${format}/image-${imageNumber}.png`
      : `${user.id}/${song.id}/${format}/image-${imageNumber}.png`;

    const { error: uploadError } = await supabase.storage
      .from("song-images")
      .upload(storagePath, finalImageBuffer, {
        contentType: "image/png",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(
        `Could not save image to storage: ${uploadError.message}`
      );
    }

    let deleteRowQuery = supabase
      .from("song_images")
      .delete()
      .eq("song_id", song.id)
      .eq("user_id", user.id)
      .eq("format", format)
      .eq("image_number", imageNumber);

    deleteRowQuery = imageSetId
      ? deleteRowQuery.eq("image_set_id", imageSetId)
      : deleteRowQuery.is("image_set_id", null);

    const { error: deleteRowError } = await deleteRowQuery;

    if (deleteRowError) {
      throw new Error(
        `Could not replace previous image record: ${deleteRowError.message}`
      );
    }

    const { data: savedImage, error: insertError } = await supabase
      .from("song_images")
      .insert({
        song_id: song.id,
        concept_id: concept.id,
        image_set_id: imageSetId || null,
        user_id: user.id,
        format,
        image_number: imageNumber,
        storage_path: storagePath,
        generation_prompt: `${prompt}

TEXT OVERLAY SETTINGS:
Use song title: ${imageUseSongTitle ? "yes" : "no"}
Custom text: ${imageCustomText || "none"}
Include branding: ${imageIncludeBranding ? "yes" : "no"}
Main text position: ${imageTextPosition}
Font style: ${imageFontStyle}
Font size: ${imageFontSize}`,
      })
      .select(
        `
        id,
        song_id,
        concept_id,
        image_set_id,
        format,
        image_number,
        storage_path,
        created_at
        `
      )
      .single();

    if (insertError || !savedImage) {
      throw new Error(
        `Could not save image record: ${
          insertError?.message || "Unknown error"
        }`
      );
    }

    const { data: signedUrlData, error: signedUrlError } =
      await supabase.storage
        .from("song-images")
        .createSignedUrl(storagePath, 60 * 60);

    if (signedUrlError || !signedUrlData?.signedUrl) {
      throw new Error(
        `Image was saved but preview URL could not be created: ${
          signedUrlError?.message || "Unknown error"
        }`
      );
    }

    return NextResponse.json({
      image: {
        id: savedImage.id,
        conceptId: savedImage.concept_id,
        imageSetId: savedImage.image_set_id,
        imageSetNumber,
        format: savedImage.format,
        imageNumber: savedImage.image_number,
        storagePath: savedImage.storage_path,
        url: signedUrlData.signedUrl,
      },
      saved: true,
    });
  } catch (error) {
    console.error("Generate image error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to generate image.",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
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

    const { searchParams } = new URL(request.url);

    const projectId = String(
      searchParams.get("projectId") || ""
    ).trim();

    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required." },
        { status: 400 }
      );
    }

    const { data: song, error: songError } = await supabase
      .from("songs")
      .select("id, title")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .single();

    if (songError || !song) {
      return NextResponse.json(
        { error: "Song not found." },
        { status: 404 }
      );
    }

    const { data: imageSets, error: imageSetsError } =
      await supabase
        .from("song_image_sets")
        .select("id, set_number, is_current")
        .eq("song_id", projectId)
        .eq("user_id", user.id)
        .order("set_number", {
          ascending: false,
        });

    if (imageSetsError) {
      throw new Error(
        `Could not load image generation sets: ${imageSetsError.message}`
      );
    }

    const imageSetNumberMap = new Map(
      (imageSets || []).map((set) => [
        set.id,
        {
          setNumber: set.set_number,
          isCurrent: Boolean(set.is_current),
        },
      ])
    );

    const { data: savedImages, error: imagesError } =
      await supabase
        .from("song_images")
        .select(
          `
          id,
          song_id,
          concept_id,
          image_set_id,
          format,
          image_number,
          storage_path,
          created_at
          `
        )
        .eq("song_id", projectId)
        .eq("user_id", user.id)
        .order("format", {
          ascending: true,
        })
        .order("image_number", {
          ascending: true,
        });

    if (imagesError) {
      throw new Error(
        `Could not load saved images: ${imagesError.message}`
      );
    }

    const images = [];

    for (const image of savedImages || []) {
      const { data: signedUrlData, error: signedUrlError } =
        await supabase.storage
          .from("song-images")
          .createSignedUrl(image.storage_path, 60 * 60);

      if (signedUrlError || !signedUrlData?.signedUrl) {
        continue;
      }

      images.push({
        id: image.id,
        songId: image.song_id,
        conceptId: image.concept_id,
        imageSetId: image.image_set_id,
        imageSetNumber: image.image_set_id
          ? imageSetNumberMap.get(image.image_set_id)?.setNumber ?? null
          : null,
        imageSetIsCurrent: image.image_set_id
          ? imageSetNumberMap.get(image.image_set_id)?.isCurrent ?? false
          : false,
        format: image.format,
        imageNumber: image.image_number,
        storagePath: image.storage_path,
        createdAt: image.created_at,
        url: signedUrlData.signedUrl,
      });
    }

    return NextResponse.json({
      projectId,
      songTitle: song.title || "Untitled",
      images,
    });
  } catch (error) {
    console.error("Load generated images error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load generated images.",
      },
      { status: 500 }
    );
  }
}

