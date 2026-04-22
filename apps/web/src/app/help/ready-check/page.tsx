import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export const metadata: Metadata = {
  title: "How Events Work — Ready Check System",
  description:
    "The Ready Check system: sign up, form groups on demand, run keys, earn event credit. A visual guide for event participants.",
};

export const dynamic = "force-dynamic";

// ───────────────────────── Visual primitives ─────────────────────────

function RoleIcon({
  role,
  filled = true,
  size = "md",
}: {
  role: "tank" | "healer" | "dps";
  filled?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClass = size === "lg" ? "h-6 w-6" : size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  const color = filled
    ? role === "tank"
      ? "text-blue-400"
      : role === "healer"
        ? "text-green-400"
        : "text-red-400"
    : "text-muted-foreground/40";

  if (role === "tank") {
    return (
      <svg className={`${sizeClass} ${color}`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2l8 3v7c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V5l8-3z" />
      </svg>
    );
  }
  if (role === "healer") {
    return (
      <svg className={`${sizeClass} ${color}`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2L9 9H2l5.5 4L5 20l7-4 7 4-2.5-7L22 9h-7z" />
      </svg>
    );
  }
  return (
    <svg className={`${sizeClass} ${color}`} viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 4l4 8-4 8h3l2-4 2 4h3l-4-8 4-8h-3l-2 4-2-4z" />
    </svg>
  );
}

function Slot({
  role,
  filled,
  label,
}: {
  role: "tank" | "healer" | "dps";
  filled: boolean;
  label?: string;
}) {
  return (
    <div
      className={`flex min-w-[110px] items-center gap-2 rounded-md border px-3 py-2 text-xs ${
        filled
          ? "border-border bg-card"
          : "border-dashed border-border/50 bg-background/50 text-muted-foreground"
      }`}
    >
      <RoleIcon role={role} filled={filled} />
      <span className={filled ? "font-medium" : "italic"}>
        {filled ? label ?? "Player" : "Open slot"}
      </span>
    </div>
  );
}

function Skeleton({
  name,
  slots,
  status,
}: {
  name: string;
  slots: Array<{ role: "tank" | "healer" | "dps"; filled: boolean; label?: string }>;
  status?: "full" | "forming" | "bounced";
}) {
  const statusBadge =
    status === "full" ? (
      <span className="rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">
        Ready to run
      </span>
    ) : status === "forming" ? (
      <span className="rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-xs font-medium text-gold">
        Needs pickups
      </span>
    ) : status === "bounced" ? (
      <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400">
        Not formed
      </span>
    ) : null;

  return (
    <div className="rounded-lg border border-border bg-card/50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold">{name}</h4>
        {statusBadge}
      </div>
      <div className="flex flex-wrap gap-2">
        {slots.map((slot, i) => (
          <Slot key={i} {...slot} />
        ))}
      </div>
    </div>
  );
}

function StepCard({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 rounded-lg border border-border bg-card p-5">
      <div className="mb-2 flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gold/20 text-sm font-bold text-gold">
          {n}
        </span>
        <h3 className="font-semibold">{title}</h3>
      </div>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function LifecycleStage({
  label,
  sub,
  active = false,
}: {
  label: string;
  sub: string;
  active?: boolean;
}) {
  return (
    <div
      className={`flex-1 rounded-lg border p-3 text-center ${
        active ? "border-gold/60 bg-gold/5" : "border-border bg-card/30"
      }`}
    >
      <div className={`text-sm font-bold ${active ? "text-gold" : "text-foreground"}`}>
        {label}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

// ───────────────────────── Page ─────────────────────────

export default async function ReadyCheckHelpPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = (await auth()) as any;
  if (!session) redirect("/api/auth/signin?callbackUrl=/help/ready-check");

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <Link
        href="/dashboard"
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        ← Back to dashboard
      </Link>

      {/* ── Hero ── */}
      <header className="mt-3">
        <p className="text-xs uppercase tracking-wider text-gold">Event Guide</p>
        <h1 className="mt-1 text-3xl font-bold">How Events Work</h1>
        <p className="mt-3 max-w-3xl text-muted-foreground">
          Events on this platform don&rsquo;t force you into a fixed group for the whole week.
          Instead, you sign up once, then &ldquo;Ready Check&rdquo; whenever you&rsquo;re
          actually online and want to play. The system forms groups on demand from
          whoever&rsquo;s currently ready. Your group runs a key, earns credit, and
          disbands. No cliques, no coordination tax, no getting locked out because one
          player can&rsquo;t make it that night.
        </p>
      </header>

      {/* ── 4-Step Flow ── */}
      <section className="mt-10">
        <h2 className="text-xl font-bold">The flow at a glance</h2>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <StepCard n={1} title="Sign up">
            Join the event roster. Pick your primary role and a flex role (or &ldquo;none&rdquo;).
            Signups stay open the entire event.
          </StepCard>
          <StepCard n={2} title="Ready Check">
            When you&rsquo;re online and ready to play, click Ready Check on the event embed.
            You have a 5-minute window for others to join you.
          </StepCard>
          <StepCard n={3} title="Groups form">
            At 5 minutes, the system auto-forms groups of 1 Tank / 1 Healer / 3 DPS
            from whoever checked in. Empty slots become open for in-game pickups.
          </StepCard>
          <StepCard n={4} title="Run &amp; credit">
            Run the key together. When the run uploads, it auto-matches to your group
            and earns event credit. Your group is done; next run = new Ready Check.
          </StepCard>
        </div>
      </section>

      {/* ── Event Lifecycle ── */}
      <section className="mt-12">
        <h2 className="text-xl font-bold">Event lifecycle</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Events move through four stages. Ready Check only goes live during{" "}
          <strong>In Progress</strong>.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <LifecycleStage label="Draft" sub="Not posted yet" />
          <LifecycleStage label="Posted" sub="Signups open" />
          <LifecycleStage label="In Progress" sub="Ready Check live" active />
          <LifecycleStage label="Complete" sub="Results posted" />
        </div>
      </section>

      {/* ── Signup ── */}
      <section className="mt-12 rounded-lg border border-border bg-card p-6">
        <h2 className="text-xl font-bold">Signing up</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Signing up adds you to the event roster. That&rsquo;s all it does — it doesn&rsquo;t
          commit you to a specific night or group. Signups stay open from the moment
          the event is posted until it ends.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-border bg-background/50 p-4">
            <h3 className="font-semibold">Primary role</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              The role you want to play by default. Tank, Healer, or DPS.
            </p>
            <div className="mt-3 flex gap-2">
              <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs">
                <RoleIcon role="tank" /> Tank
              </span>
              <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs">
                <RoleIcon role="healer" /> Healer
              </span>
              <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs">
                <RoleIcon role="dps" /> DPS
              </span>
            </div>
          </div>
          <div className="rounded-md border border-gold/30 bg-gold/5 p-4">
            <h3 className="font-semibold text-gold">Flex role</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              An alternate role you&rsquo;re willing to play if a group can&rsquo;t form
              without one. Choose &ldquo;none&rdquo; if you only want your primary.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              <strong className="text-foreground">Flex unlocks more groups.</strong>{" "}
              If 3 people mark DPS-with-healer-flex and the pool is short on healers,
              one of them gets pulled into a healer slot — and a whole group forms that
              otherwise wouldn&rsquo;t have. You don&rsquo;t get to decline the flex; if
              you don&rsquo;t like the assignment, you can vote to disband.
            </p>
          </div>
        </div>
      </section>

      {/* ── Ready Check ── */}
      <section className="mt-12">
        <h2 className="text-xl font-bold">Ready Check</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Ready Check is how groups form. When you click it, a 5-minute window opens
          and other ready players join the queue. When the timer ends, the system
          builds groups from whoever checked in.
        </p>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <div className="rounded-md border border-border bg-card p-4">
            <h3 className="font-semibold">First click starts it</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              The first person to click Ready Check opens the window. A fresh Ready
              Check message appears in the Discord channel with a live countdown.
            </p>
          </div>
          <div className="rounded-md border border-border bg-card p-4">
            <h3 className="font-semibold">Everyone else joins it</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Subsequent clicks — on the event embed or the Ready Check message —
              add you to the queue. Only one Ready Check runs at a time per event.
            </p>
          </div>
          <div className="rounded-md border border-border bg-card p-4">
            <h3 className="font-semibold">Cancel in the first 4 minutes</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Changed your mind? You can leave the queue during minutes 0–4. The final
              minute is locked so mis-clicks don&rsquo;t pull someone out right as
              groups form.
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-md border border-border bg-card/50 p-5">
          <h3 className="font-semibold">What a Ready Check window looks like</h3>
          <div className="mt-3 rounded-md border border-border bg-background p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gold/20 text-lg text-gold">
                  ⏱
                </span>
                <div>
                  <div className="text-sm font-semibold">Ready Check active</div>
                  <div className="text-xs text-muted-foreground">
                    5 players checked in · 2:47 remaining
                  </div>
                </div>
              </div>
              <button
                className="cursor-default rounded-md border border-gold/50 bg-gold/20 px-3 py-1.5 text-xs font-semibold text-gold"
                disabled
              >
                Join Ready Check
              </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-xs">
                <RoleIcon role="tank" /> Shift
              </span>
              <span className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-xs">
                <RoleIcon role="healer" /> Serenitey
              </span>
              <span className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-xs">
                <RoleIcon role="dps" /> Kua
              </span>
              <span className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-xs">
                <RoleIcon role="dps" /> Darkjaye
              </span>
              <span className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-xs">
                <RoleIcon role="dps" /> Tabhunter
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Skeleton ── */}
      <section className="mt-12">
        <h2 className="text-xl font-bold">What a group looks like</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Every group has the same shape:{" "}
          <strong>1 Tank · 1 Healer · 3 DPS</strong>. We call this a{" "}
          <em>skeleton</em>. Each slot is either <strong>filled</strong> by a real
          event player or <strong>open</strong> — an open slot is a PUG seat that
          can be filled by any friend / guildmate / LFG pickup in-game.
        </p>
        <div className="mt-5 space-y-4">
          <Skeleton
            name="Full group — ready to run"
            status="full"
            slots={[
              { role: "tank", filled: true, label: "Wankfumuch" },
              { role: "healer", filled: true, label: "Brotherchaos" },
              { role: "dps", filled: true, label: "Darkjaye" },
              { role: "dps", filled: true, label: "Tabhunter" },
              { role: "dps", filled: true, label: "Deleitlama" },
            ]}
          />
          <Skeleton
            name="Partial group — needs 1 DPS pickup"
            status="forming"
            slots={[
              { role: "tank", filled: true, label: "Lichpleaze" },
              { role: "healer", filled: true, label: "Serenitey" },
              { role: "dps", filled: true, label: "Kua" },
              { role: "dps", filled: true, label: "Fearbladé" },
              { role: "dps", filled: false },
            ]}
          />
          <Skeleton
            name="Thin group — needs 3 DPS pickups"
            status="forming"
            slots={[
              { role: "tank", filled: true, label: "Shift" },
              { role: "healer", filled: true, label: "Tanavast (flex)" },
              { role: "dps", filled: false },
              { role: "dps", filled: false },
              { role: "dps", filled: false },
            ]}
          />
        </div>
        <div className="mt-4 rounded-md border border-border/60 bg-background/50 p-4 text-sm text-muted-foreground">
          <strong className="text-foreground">Why open slots exist:</strong> when
          the ready-checked pool is unbalanced (lots of tanks, few DPS, etc.) we&rsquo;d
          rather form <em>more</em> partial groups that people can flesh out with
          pickups than form fewer &ldquo;full&rdquo; groups and bench everyone else.
        </div>
      </section>

      {/* ── Scenarios ── */}
      <section className="mt-12">
        <h2 className="text-xl font-bold">Scenario examples</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A few common Ready Check pools and what the system produces from them.
        </p>

        <div className="mt-5 space-y-6">
          {/* Scenario 1 */}
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">11 ready-checked · 3T / 3H / 5 DPS</h3>
              <span className="text-xs text-muted-foreground">DPS is the scarce role</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Anchor math: 3 tanks + 3 healers = up to 3 skeletons. 5 DPS split
              round-robin across those 3. The leftover DPS slots stay open for
              pickups. <strong className="text-foreground">All 11 players are assigned.</strong>
            </p>
            <div className="mt-4 space-y-3">
              <Skeleton
                name="Group 1"
                status="full"
                slots={[
                  { role: "tank", filled: true },
                  { role: "healer", filled: true },
                  { role: "dps", filled: true },
                  { role: "dps", filled: true },
                  { role: "dps", filled: true },
                ]}
              />
              <Skeleton
                name="Group 2"
                status="forming"
                slots={[
                  { role: "tank", filled: true },
                  { role: "healer", filled: true },
                  { role: "dps", filled: true },
                  { role: "dps", filled: true },
                  { role: "dps", filled: false },
                ]}
              />
              <Skeleton
                name="Group 3"
                status="forming"
                slots={[
                  { role: "tank", filled: true },
                  { role: "healer", filled: true },
                  { role: "dps", filled: false },
                  { role: "dps", filled: false },
                  { role: "dps", filled: false },
                ]}
              />
            </div>
          </div>

          {/* Scenario 2 */}
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">5 ready-checked · 1T / 1H / 3 DPS</h3>
              <span className="text-xs text-muted-foreground">Perfectly balanced</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Exactly one complete group. No open slots, no leftovers.
            </p>
            <div className="mt-4">
              <Skeleton
                name="Group 1"
                status="full"
                slots={[
                  { role: "tank", filled: true },
                  { role: "healer", filled: true },
                  { role: "dps", filled: true },
                  { role: "dps", filled: true },
                  { role: "dps", filled: true },
                ]}
              />
            </div>
          </div>

          {/* Scenario 3 */}
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">2 ready-checked · 1 DPS, 1 DPS</h3>
              <span className="text-xs text-muted-foreground">Minimum viable group</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Two players is the minimum. They form a thin group with Tank, Healer,
              and one DPS slot open — they&rsquo;ll need 3 pickups in-game.
            </p>
            <div className="mt-4">
              <Skeleton
                name="Group 1"
                status="forming"
                slots={[
                  { role: "tank", filled: false },
                  { role: "healer", filled: false },
                  { role: "dps", filled: true },
                  { role: "dps", filled: true },
                  { role: "dps", filled: false },
                ]}
              />
            </div>
          </div>

          {/* Scenario 4 */}
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Only 1 person checks in</h3>
              <span className="text-xs text-muted-foreground">Not enough</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Minimum 2 players required. The lone ready-checker gets a polite
              message: &ldquo;No one else checked in — try again later.&rdquo;
            </p>
            <div className="mt-4">
              <Skeleton
                name="No group formed"
                status="bounced"
                slots={[
                  { role: "tank", filled: false },
                  { role: "healer", filled: false },
                  { role: "dps", filled: false },
                  { role: "dps", filled: false },
                  { role: "dps", filled: false },
                ]}
              />
            </div>
          </div>

          {/* Scenario 5 */}
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">All same role · 10 tanks check in</h3>
              <span className="text-xs text-muted-foreground">Impossible mix</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Every group needs exactly 1 tank. 10 tanks = at most 10 one-tank
              groups, each with only 1 real player. That fails the 2-real-player
              minimum, so no group forms.{" "}
              <strong className="text-foreground">
                Everyone gets a nudge to enable flex next time.
              </strong>
            </p>
          </div>
        </div>
      </section>

      {/* ── Priority flag ── */}
      <section className="mt-12 rounded-lg border border-gold/30 bg-gold/5 p-6">
        <h2 className="text-xl font-bold text-gold">Priority flag</h2>
        <p className="mt-2 text-sm">
          If you ready-checked but no group could be formed (you were alone, or the
          role mix didn&rsquo;t work), the system remembers. In the next Ready Check
          you join, you get <strong>priority slotting</strong> — you&rsquo;re placed
          into a skeleton first, before other players of your role.
        </p>
        <p className="mt-2 text-sm">
          The flag clears as soon as you&rsquo;re assigned to a group. It&rsquo;s a
          safety net against getting repeatedly bounced when the pool is unlucky.
        </p>
      </section>

      {/* ── Disband & Lock ── */}
      <section className="mt-12">
        <h2 className="text-xl font-bold">Leaving a group</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-md border border-border bg-card p-5">
            <h3 className="font-semibold">Vote to disband</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              If 2 members of your group vote to disband, the group dissolves and
              everyone is released back to the pool. Vote available any time
              <strong className="text-foreground"> before a run is associated</strong>.
              Once your group completes and matches a run, it&rsquo;s locked in.
            </p>
          </div>
          <div className="rounded-md border border-border bg-card p-5">
            <h3 className="font-semibold">Auto-disband after 2 hours</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              If your group hasn&rsquo;t completed a matching run within 2 hours of
              forming, it auto-disbands. At the 1h45m mark, the bot DMs each member
              with a 15-minute warning so ghost groups don&rsquo;t silently expire.
            </p>
          </div>
        </div>
        <div className="mt-4 rounded-md border border-border/60 bg-background/50 p-4 text-sm">
          <strong>While you&rsquo;re in a group:</strong> you can&rsquo;t start or
          join a new Ready Check until that group is done (matched, disbanded, or
          timed out). This keeps you from being double-booked.
        </div>
      </section>

      {/* ── Credit ── */}
      <section className="mt-12 rounded-lg border border-border bg-card p-6">
        <h2 className="text-xl font-bold">How runs earn event credit</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A run earns event credit when four things line up:
        </p>
        <ul className="mt-3 space-y-2 text-sm">
          <li className="flex gap-2">
            <span className="text-green-400">✓</span>
            The event is <strong>In Progress</strong>
          </li>
          <li className="flex gap-2">
            <span className="text-green-400">✓</span>
            The run meets the event&rsquo;s dungeon and key-level rules
          </li>
          <li className="flex gap-2">
            <span className="text-green-400">✓</span>
            Every real member of a Ready-Check group is in the run
          </li>
          <li className="flex gap-2">
            <span className="text-green-400">✓</span>
            The group hasn&rsquo;t already been matched to a different run
          </li>
        </ul>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-4">
            <h3 className="text-sm font-semibold text-green-400">Counts for credit</h3>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              <li>• Players who signed up AND were assigned to the group via Ready Check</li>
              <li>• The group is &ldquo;matched&rdquo; to this specific run (1:1)</li>
            </ul>
          </div>
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-4">
            <h3 className="text-sm font-semibold text-red-400">Doesn&rsquo;t count</h3>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              <li>• In-game pickups filling open slots (even if they&rsquo;re event signups)</li>
              <li>• Runs with event-signed-up players who didn&rsquo;t Ready Check as a group</li>
              <li>• Extra runs by a group already matched to one run</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ── Multi-run events ── */}
      <section className="mt-12">
        <h2 className="text-xl font-bold">Multi-run events (Marathon / Best Average)</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Most events credit one run per group. Some event types — Marathon, Best
          Average — need a team to run <em>multiple</em> keys. Since groups are
          ephemeral, the system identifies a team by{" "}
          <strong>the set of 5 characters</strong> that Ready Checked together more
          than once.
        </p>
        <div className="mt-4 rounded-md border border-border bg-card p-5">
          <div className="grid gap-3 text-sm">
            <div>
              <strong>Run 1:</strong> Shift · Serenitey · Kua · Fearbladé · Tabhunter →
              <em> Group 1a</em>
            </div>
            <div>
              <strong>Run 2:</strong> same 5 characters ready-check again →
              <em> Group 1b</em>
            </div>
            <div className="rounded bg-background/50 p-3 text-xs text-muted-foreground">
              Groups 1a + 1b aggregate into <strong className="text-foreground">Team 1</strong>
              {" "}for scoring. Both runs credit Team 1. Specs/roles can differ between
              runs (Kua Balance → Kua Feral is fine) — the match is on character
              identity, not spec.
            </div>
          </div>
        </div>
      </section>

      {/* ── Where things happen ── */}
      <section className="mt-12">
        <h2 className="text-xl font-bold">Where everything happens</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-md border border-[#5865F2]/30 bg-[#5865F2]/5 p-5">
            <h3 className="font-semibold text-[#5865F2]">Discord — live action</h3>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>• Event embed with signup + Ready Check buttons</li>
              <li>• Ready Check message with live countdown and roster</li>
              <li>• Group-formed announcements</li>
              <li>• Auto-disband warning DMs</li>
              <li>• Run completion posts</li>
            </ul>
          </div>
          <div className="rounded-md border border-gold/30 bg-gold/5 p-5">
            <h3 className="font-semibold text-gold">Website — the record</h3>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>• Event detail page with formed groups + their runs</li>
              <li>• Disbanded and timed-out groups are hidden</li>
              <li>• Historical results and leaderboards</li>
              <li>• Admin controls (create, repost, close early)</li>
              <li>• Training content (this page!)</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="mt-12">
        <h2 className="text-xl font-bold">Quick FAQ</h2>
        <div className="mt-4 space-y-3">
          <details className="rounded-md border border-border bg-card p-4">
            <summary className="cursor-pointer font-semibold">
              Do I have to play every night of a multi-day event?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              No. You Ready Check only when you&rsquo;re actually online and want to
              play. Miss a night, miss a week — the roster stays with you and you can
              jump back in whenever.
            </p>
          </details>
          <details className="rounded-md border border-border bg-card p-4">
            <summary className="cursor-pointer font-semibold">
              What if my friend group wants to always play together?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              Two options. (1) You can coordinate and Ready Check at the same time —
              the system will pull you all into a skeleton together if the numbers
              work out. (2) For locked-in rosters, use a <strong>Team event</strong>{" "}
              instead of a group event. Team events are designed for pre-assembled
              rosters.
            </p>
          </details>
          <details className="rounded-md border border-border bg-card p-4">
            <summary className="cursor-pointer font-semibold">
              Can I bring a guildie who isn&rsquo;t signed up?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              Yes — they can fill any open slot in your group in-game. They just
              won&rsquo;t earn event credit for the run. Only players who signed up
              and were assigned to the skeleton get event credit.
            </p>
          </details>
          <details className="rounded-md border border-border bg-card p-4">
            <summary className="cursor-pointer font-semibold">
              What&rsquo;s a flex role actually good for?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              It helps the group-formation math when the pool is unbalanced. If
              everyone who ready-checks is DPS, flex healers/tanks unlock groups that
              otherwise couldn&rsquo;t form. If you don&rsquo;t want to flex, pick
              &ldquo;none&rdquo; — you&rsquo;ll never be forced.
            </p>
          </details>
          <details className="rounded-md border border-border bg-card p-4">
            <summary className="cursor-pointer font-semibold">
              What happens if my Ready Check formed a group I don&rsquo;t like?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              Any 2 members of a group can vote to disband it. Once disbanded,
              everyone goes back to the pool and can Ready Check again fresh.
            </p>
          </details>
          <details className="rounded-md border border-border bg-card p-4">
            <summary className="cursor-pointer font-semibold">
              My group didn&rsquo;t complete a run — am I stuck?
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              After 2 hours without a completed event-eligible run, your group
              auto-disbands. You&rsquo;ll get a DM warning at the 1h45m mark. You can
              also vote-disband any time before the 2-hour mark.
            </p>
          </details>
        </div>
      </section>

      <div className="mt-12 rounded-md border border-border/60 bg-background/50 p-4 text-xs text-muted-foreground">
        <strong>Still designing:</strong> this system is in design review. The
        current events page may behave differently than what&rsquo;s described here
        until implementation lands.
      </div>
    </main>
  );
}
