import Link from "next/link";

// Public landing page. The studio itself (/studio) needs sign-in.

const features = [
  {
    icon: "🎶",
    title: "Karaoke from any song",
    body: "Upload a song you own and AI removes the singer's voice, leaving clean music to sing over. Already have a karaoke track? Use it as is.",
  },
  {
    icon: "📝",
    title: "Lyrics that follow you",
    body: "Find timed lyrics online, or tap along once to time them yourself. The line you're singing lights up and scrolls, like a music app.",
  },
  {
    icon: "🎙️",
    title: "Studio voice",
    body: "Your voice gets the treatment a sound engineer would give it: clarity, smooth levels and a touch of reverb, mixed cleanly with the music.",
  },
  {
    icon: "🌄",
    title: "Blur or change your background",
    body: "Hide a messy room with background blur, sing on a stage or at sunset, or use any photo of your own.",
  },
  {
    icon: "🎧",
    title: "Headphones or speaker",
    body: "Sing with headphones for the clearest sound, or play the music out loud and let echo cancelling keep it out of the mic.",
  },
  {
    icon: "📲",
    title: "Made for your phone",
    body: "Full HD video shaped for your screen: tall on a phone, wide on a laptop. Save it and post it anywhere.",
  },
];

const steps = [
  { n: "1", title: "Add a song", body: "Upload a song you own. The music track is ready in about a minute." },
  { n: "2", title: "Get the lyrics", body: "Find them online or paste your own, in Tamil, Hindi, English or any language." },
  { n: "3", title: "Tap Sing", body: "Put on headphones, follow the glowing lyrics, and your video is ready when the song ends." },
];

export default function Landing() {
  return (
    <div className="relative flex-1 overflow-hidden">
      {/* Soft stage-light glow behind the page */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[42rem] bg-[radial-gradient(60%_50%_at_20%_0%,rgba(236,72,153,0.28),transparent),radial-gradient(50%_45%_at_85%_10%,rgba(168,85,247,0.25),transparent)]"
      />

      <nav className="relative mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <span className="text-lg font-bold">🎤 Song Recorder</span>
        <Link
          href="/studio"
          className="rounded-full bg-white/10 px-4 py-2 text-sm font-medium ring-1 ring-white/15 hover:bg-white/15"
        >
          Sign in
        </Link>
      </nav>

      <main className="relative">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-8 pb-20 sm:px-6 md:grid-cols-[1.1fr_0.9fr] md:pt-16">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs text-white/70 ring-1 ring-white/10">
              <span lang="ta">தமிழ்</span>
              <span className="text-white/30">·</span>
              <span lang="hi">हिन्दी</span>
              <span className="text-white/30">·</span>
              English
            </p>
            <h1 className="text-4xl leading-[1.05] font-extrabold tracking-tight text-balance sm:text-6xl">
              Sing it. Record it.{" "}
              <span className="bg-gradient-to-r from-pink-400 to-fuchsia-400 bg-clip-text text-transparent">
                Share it.
              </span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-pretty text-white/70">
              Your own karaoke studio on your phone. Turn songs you love into karaoke tracks, follow the
              lyrics line by line, and record a video with studio-quality sound.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/studio"
                className="rounded-xl bg-pink-600 px-6 py-3.5 text-base font-semibold shadow-lg shadow-pink-600/30 hover:bg-pink-500"
              >
                Open the studio
              </Link>
              <a
                href="#how"
                className="rounded-xl bg-white/10 px-6 py-3.5 text-base font-semibold ring-1 ring-white/15 hover:bg-white/15"
              >
                How it works
              </a>
            </div>
          </div>

          <PhoneMock />
        </section>

        {/* Features */}
        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <h2 className="mb-8 text-2xl font-bold sm:text-3xl">Everything a singer needs</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/10">
                <div className="mb-3 text-2xl" aria-hidden>
                  {f.icon}
                </div>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-white/65">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-6 px-4 pb-20 sm:px-6">
          <h2 className="mb-8 text-2xl font-bold sm:text-3xl">How it works</h2>
          <ol className="grid gap-4 md:grid-cols-3">
            {steps.map((s) => (
              <li key={s.n} className="flex gap-4 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/10">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pink-600 font-bold">
                  {s.n}
                </span>
                <div>
                  <h3 className="font-semibold">{s.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-white/65">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Closing call to action */}
        <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
          <div className="rounded-3xl bg-gradient-to-br from-pink-600/30 via-fuchsia-600/20 to-indigo-600/20 p-8 text-center ring-1 ring-white/10 sm:p-12">
            <h2 className="text-2xl font-bold text-balance sm:text-3xl">Ready for your next song?</h2>
            <p className="mx-auto mt-2 max-w-md text-white/70">Grab your headphones and step into the studio.</p>
            <Link
              href="/studio"
              className="mt-6 inline-block rounded-xl bg-white px-6 py-3.5 font-semibold text-neutral-900 hover:bg-white/90"
            >
              Open the studio
            </Link>
          </div>
        </section>
      </main>

      <footer className="relative mx-auto max-w-6xl px-4 pb-10 text-sm text-white/40 sm:px-6">
        🎤 Song Recorder · A private studio. Sign-in required.
      </footer>
    </div>
  );
}

// A phone showing the recorder: stage background, glowing lyric line, REC badge.
function PhoneMock() {
  return (
    <div className="mx-auto w-[260px] sm:w-[290px]" aria-hidden>
      <div className="relative aspect-[9/19] overflow-hidden rounded-[2.6rem] bg-neutral-950 p-2.5 shadow-2xl shadow-fuchsia-900/40 ring-1 ring-white/15">
        <div className="relative h-full w-full overflow-hidden rounded-[2.1rem] bg-[#0b0614]">
          {/* stage lights */}
          <div className="absolute -top-10 left-[8%] h-[70%] w-24 -rotate-12 bg-gradient-to-b from-pink-500/50 to-transparent blur-md" />
          <div className="absolute -top-10 left-[40%] h-[75%] w-24 bg-gradient-to-b from-purple-500/45 to-transparent blur-md" />
          <div className="absolute -top-10 right-[6%] h-[70%] w-24 rotate-12 bg-gradient-to-b from-blue-500/45 to-transparent blur-md" />
          {/* singer silhouette */}
          <div className="absolute top-[22%] left-1/2 h-20 w-20 -translate-x-1/2 rounded-full bg-gradient-to-b from-neutral-500 to-neutral-700" />
          <div className="absolute top-[36%] left-1/2 h-48 w-44 -translate-x-1/2 rounded-t-[5rem] bg-gradient-to-b from-neutral-600 to-neutral-800" />
          {/* top bar */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4 pt-6 text-[10px]">
            <span className="rounded-full bg-black/50 px-2 py-1">✕ Close</span>
            <span className="flex items-center gap-1 rounded-full bg-red-600 px-2 py-1 font-semibold">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> 1:24
            </span>
          </div>
          {/* lyrics */}
          <div className="absolute inset-x-0 bottom-0 space-y-2 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pt-16 pb-8 text-center">
            <p className="text-xs text-white/35">Every song begins with one note</p>
            <p className="text-lg leading-tight font-bold">Sing it like the whole world listens</p>
            <p className="text-xs text-white/60" lang="ta">
              என் பாடல், என் குரல்
            </p>
            <p className="text-xs text-white/60" lang="hi">
              मेरा गीत, मेरी आवाज़
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
