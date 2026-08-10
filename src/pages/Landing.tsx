import { motion } from "framer-motion";
import { Link } from "react-router";
import { ClippyLogo } from "@/components/ClippyLogo";
import { ScoreRing } from "@/components/studio/ScoreRing";
import { Button } from "@/components/ui/button";
import {
  Captions,
  Clapperboard,
  Film,
  Gauge,
  KeyRound,
  Mic,
  Play,
  Scissors,
  Sparkles,
  Wand2,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.55, ease: "easeOut" as const },
};

const STEPS = [
  {
    n: "01",
    title: "Upload a long video",
    body: "Drop a podcast episode, webinar, interview or vlog. Files up to 2GB, analyzed locally in your browser.",
    icon: <Film className="size-6" />,
    tint: "clay-peach",
  },
  {
    n: "02",
    title: "AI understands it",
    body: "Real signal analysis extracts speech energy, pauses, scene changes and the active region — no black boxes.",
    icon: <Gauge className="size-6" />,
    tint: "clay-sky",
  },
  {
    n: "03",
    title: "AI finds the moments",
    body: "Every candidate is scored on hook strength, speech density, standalone completeness, intensity and pacing.",
    icon: <Zap className="size-6" />,
    tint: "clay-mint",
  },
  {
    n: "04",
    title: "You get why",
    body: "Every clip shows its score and the reasons behind it. Pick a strategy: viral, educational, storytelling and more.",
    icon: <Sparkles className="size-6" />,
    tint: "clay-lilac",
  },
  {
    n: "05",
    title: "Publish-ready",
    body: "Trim, reframe to 9:16, add word-accurate captions, choose a hook, then render and export a real video file.",
    icon: <Clapperboard className="size-6" />,
    tint: "clay-butter",
  },
];

const FEATURES = [
  {
    title: "Clip scoring you can read",
    body: "A 0–100 score per clip with human-readable reasons: strong opening, clean in/out points, emotional intensity.",
    icon: <Gauge className="size-5" />,
  },
  {
    title: "10 clip strategies",
    body: "Viral, educational, funny, storytelling, motivational, podcast, business, news, interview — or custom.",
    icon: <Scissors className="size-5" />,
  },
  {
    title: "Hooks & platform titles",
    body: "Five hook angles per clip plus Shorts, TikTok and Instagram titles, hashtags and keywords.",
    icon: <Wand2 className="size-5" />,
  },
  {
    title: "Smart reframing",
    body: "Content-aware 9:16 / 1:1 / 4:5 / 16:9 crops that follow the active region instead of just center-cropping.",
    icon: <Clapperboard className="size-5" />,
  },
  {
    title: "Word-level captions",
    body: "Semantically emphasized keywords, six styles, automatic line breaking — timed to the millisecond.",
    icon: <Captions className="size-5" />,
  },
  {
    title: "Real rendering",
    body: "No fake progress bars. Export composes every frame with captions and reframing right in your browser.",
    icon: <Film className="size-5" />,
  },
];

const EXAMPLE_CLIPS = [
  { score: 97, time: "00:13:24", len: "38s", reason: "Strong hook · complete thought", tint: "clay-mint" },
  { score: 94, time: "00:31:12", len: "42s", reason: "High intensity · clean cut", tint: "clay-sky" },
  { score: 92, time: "01:04:44", len: "35s", reason: "Standalone story · great ending", tint: "clay-lilac" },
];

export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* nav */}
      <header className="px-4 pt-3 sm:px-6">
        <div className="clay mx-auto flex max-w-6xl items-center justify-between gap-3 rounded-full px-5 py-2.5">
          <div className="flex items-center gap-2">
            <ClippyLogo size={30} alt="" />
            <span className="text-base font-extrabold tracking-tight">Clippy</span>
          </div>
          <nav className="hidden items-center gap-1 md:flex">
            {["How it works", "Features", "Strategies"].map((item) => (
              <a
                key={item}
                href={`#${item.toLowerCase().replace(/ /g, "-")}`}
                className="rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {item}
              </a>
            ))}
          </nav>
          <Link to="/auth?returnTo=/dashboard">
            <Button className="clay-press gap-2 rounded-full">
              <Sparkles className="size-4" />
              Start creating
            </Button>
          </Link>
        </div>
      </header>

      {/* hero */}
      <section className="relative mx-auto w-full max-w-6xl px-4 pt-14 sm:px-6 sm:pt-20">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          >
            <div className="clay-chip mb-5 inline-flex items-center gap-2 bg-accent/60 px-3 py-1.5 text-xs font-bold text-accent-foreground">
              <Mic className="size-3.5" />
              AI clip discovery · captions · hooks · export
            </div>
            <h1 className="text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-6xl">
              One long video.
              <br />
              <span className="text-primary">A week of clips.</span>
            </h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">
              Clippy watches your podcast or webinar, finds the moments people actually want to
              watch, and scores every clip — so you ship short-form content instead of scrubbing
              timelines.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link to="/auth?returnTo=/dashboard">
                <Button size="lg" className="clay-press gap-2 rounded-full px-7">
                  <Play className="size-4" fill="currentColor" />
                  Find my best clips
                </Button>
              </Link>
              <a href="#how-it-works">
                <Button size="lg" variant="secondary" className="clay-press rounded-full px-7">
                  See how it works
                </Button>
              </a>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Free to start · no credit card · analysis runs in your browser
            </p>
          </motion.div>

          {/* hero mock */}
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, ease: "easeOut", delay: 0.15 }}
            className="relative"
          >
            <div className="clay mx-auto flex max-w-sm flex-col gap-3 p-5">
              <div className="flex items-center gap-2">
                <div className="clay-inset flex size-9 items-center justify-center rounded-xl">
                  <Mic className="size-4" />
                </div>
                <div>
                  <p className="text-sm font-bold leading-tight">“The 90-minute podcast”</p>
                  <p className="text-[11px] text-muted-foreground">Viral strategy · 12 clips found</p>
                </div>
                <span className="clay-chip ml-auto bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary">
                  LIVE DEMO
                </span>
              </div>
              {EXAMPLE_CLIPS.map((c, i) => (
                <motion.div
                  key={c.time}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.35 + i * 0.12, duration: 0.5, ease: "easeOut" }}
                  className={cn("clay flex items-center gap-3 p-3", c.tint)}
                >
                  <ScoreRing score={c.score} size={48} />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold tabular-nums">{c.time}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{c.reason}</p>
                  </div>
                  <span className="clay-chip bg-background px-2 py-1 text-[10px] font-bold">{c.len}</span>
                </motion.div>
              ))}
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>Example output — your scores depend on your video</span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* how it works */}
      <section id="how-it-works" className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
        <motion.div {...fadeUp} className="mb-10 text-center">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">From source to publish</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            A real pipeline — upload, understand, discover, decide, export. Nothing is simulated.
          </p>
        </motion.div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map((s, i) => (
            <motion.div
              key={s.n}
              {...fadeUp}
              transition={{ duration: 0.5, delay: i * 0.06, ease: "easeOut" }}
              className={cn("clay flex flex-col gap-3 p-5", s.tint)}
            >
              <div className="flex items-center justify-between">
                <div className="clay-inset flex size-11 items-center justify-center rounded-2xl">{s.icon}</div>
                <span className="text-2xl font-extrabold text-foreground/15">{s.n}</span>
              </div>
              <h3 className="font-bold leading-snug">{s.title}</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">{s.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* features */}
      <section id="features" className="bg-card/40 py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <motion.div {...fadeUp} className="mb-10 text-center">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              Built like a creative tool, not a wrapper
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
              Every feature works end to end — scores, captions, hooks and exports are computed, not
              stubbed.
            </p>
          </motion.div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                {...fadeUp}
                transition={{ duration: 0.5, delay: i * 0.05, ease: "easeOut" }}
                className="clay group p-5 transition-shadow hover:shadow-xl"
              >
                <div className="clay-inset mb-4 flex size-11 items-center justify-center rounded-2xl bg-accent/40 text-primary transition-transform group-hover:scale-105">
                  {f.icon}
                </div>
                <h3 className="font-bold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* strategies strip */}
      <section id="strategies" className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
        <motion.div {...fadeUp} className="mb-8 text-center">
          <h2 className="text-3xl font-extrabold tracking-tight">One video, every strategy</h2>
          <p className="mx-auto mt-3 max-w-lg text-muted-foreground">
            The same source, scored differently depending on the goal.
          </p>
        </motion.div>
        <div className="flex flex-wrap justify-center gap-2.5">
          {[
            ["🔥", "Viral"], ["🧠", "Educational"], ["😂", "Funny"], ["📖", "Storytelling"],
            ["💪", "Motivational"], ["🎙️", "Podcast"], ["📈", "Business"], ["📰", "News"],
            ["🎤", "Interview"], ["✨", "Custom"],
          ].map(([emoji, label], i) => (
            <motion.span
              key={label}
              initial={{ opacity: 0, scale: 0.8 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.04, duration: 0.3 }}
              className="clay-press clay-chip flex items-center gap-1.5 bg-card px-4 py-2.5 text-sm font-semibold"
            >
              <span>{emoji}</span> {label}
            </motion.span>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6">
        <motion.div {...fadeUp} className="clay clay-peach relative overflow-hidden p-10 text-center sm:p-14">
          <div className="pointer-events-none absolute -right-10 -top-10 size-48 rounded-full bg-white/30 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-16 -left-10 size-56 rounded-full bg-white/20 blur-2xl" />
          <div className="relative">
            <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-white/40">
              <Clapperboard className="size-7" />
            </div>
            <h2 className="mx-auto max-w-lg text-3xl font-extrabold tracking-tight sm:text-4xl">
              Your next post is already inside your last upload.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
              Upload a video, let the AI find the moments, and export clips with captions and hooks
              in minutes.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link to="/auth?returnTo=/dashboard">
                <Button size="lg" className="clay-press gap-2 rounded-full px-8">
                  <KeyRound className="size-4" />
                  Start free
                </Button>
              </Link>
            </div>
          </div>
        </motion.div>
      </section>

      <footer className="border-t border-border/60 px-4 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <ClippyLogo size={20} alt="" />
            <span className="font-bold text-foreground">Clippy</span>
            — AI video clipping platform
          </div>
          <div className="flex items-center gap-4">
            <span>Privacy</span>
            <span>Terms</span>
            <span>© {new Date().getFullYear()} Clippy</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
