import PublicFooter from "@/components/PublicFooter";
export const metadata = {
  title: "Terms of Service | Suno Zara Universe",
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#07111c] px-6 py-16 text-slate-200">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold text-white">Terms of Service</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: 14 September 2026</p>

        <div className="mt-10 space-y-8 leading-7">
          <section>
            <h2 className="text-xl font-semibold text-white">1. About Suno Zara Universe</h2>
            <p className="mt-2">
              Suno Zara Universe is a creative workflow and publishing application used to
              prepare music-related content, media, metadata and social-media posts.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">2. Your content</h2>
            <p className="mt-2">
              You remain responsible for the music, lyrics, images, videos, captions,
              metadata and other material you create, upload or publish through the service.
              You must have the necessary rights and permissions to use and publish that
              content.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">3. Third-party platforms</h2>
            <p className="mt-2">
              Suno Zara Universe may connect to third-party services such as TikTok, YouTube,
              Facebook, Instagram and other publishing or storage providers. Your use of
              those services is also subject to their own terms, policies and platform rules.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">4. Publishing</h2>
            <p className="mt-2">
              You are responsible for reviewing titles, captions, privacy settings,
              disclosures, schedules and media before publishing. Suno Zara Universe does not
              guarantee that a third-party platform will accept, distribute or retain any post.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">5. Availability</h2>
            <p className="mt-2">
              The service is provided on an as-available basis. Features may change or become
              unavailable because of software updates, third-party API changes or service
              interruptions.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">6. Contact</h2>
            <p className="mt-2">
              Questions about these terms can be sent to{" "}
              <a
                className="text-cyan-300 hover:underline"
                href="mailto:iam.sunozara@gmail.com"
              >
                iam.sunozara@gmail.com
              </a>.
            </p>
          </section>
        </div>
      </div>
      <PublicFooter />

    </main>
  );
}
