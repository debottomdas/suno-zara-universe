import PublicFooter from "@/components/PublicFooter";
export const metadata = {
  title: "Privacy Policy | Suno Zara Universe",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#07111c] px-6 py-16 text-slate-200">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold text-white">Privacy Policy</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: 14 September 2026</p>

        <div className="mt-10 space-y-8 leading-7">
          <section>
            <h2 className="text-xl font-semibold text-white">1. Information we process</h2>
            <p className="mt-2">
              Suno Zara Universe may process account information, song and project metadata,
              publishing settings, social-media content, connected-account identifiers and
              publishing history needed to operate the service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">2. Local media</h2>
            <p className="mt-2">
              When local-media storage is selected, large audio and video files remain on the
              user&apos;s own computer unless the user chooses to upload or publish them to a
              third-party service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">3. Connected platforms</h2>
            <p className="mt-2">
              When you connect services such as TikTok, YouTube, Facebook or Instagram,
              authentication tokens and account identifiers may be stored securely so the
              application can perform actions you request. Passwords for those third-party
              accounts are not collected by Suno Zara Universe.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">4. How information is used</h2>
            <p className="mt-2">
              Information is used to operate the application, save projects and campaign
              settings, connect authorised accounts, publish content at your request and
              record publishing results.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">5. Sharing of information</h2>
            <p className="mt-2">
              Information is shared with third-party platforms only when necessary to provide
              features you request, such as authentication, media publishing or storage.
              Personal information is not sold to advertisers.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">6. Data retention and deletion</h2>
            <p className="mt-2">
              Data is retained only as needed for the operation of the service or as required
              by connected platforms. You may request deletion of your Suno Zara Universe data
              by contacting us.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">7. Contact</h2>
            <p className="mt-2">
              Privacy questions or deletion requests can be sent to{" "}
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
