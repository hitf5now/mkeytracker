import type { AchievementDef } from "@/lib/achievements";
import { cn } from "@/lib/utils";

interface AchievementBadgeProps {
  achievement: AchievementDef;
  delayMs?: number;
}

export function AchievementBadge({
  achievement,
  delayMs = 0,
}: AchievementBadgeProps) {
  return (
    <span
      className={cn(
        "ach-badge",
        achievement.severity === "negative" && "ach-negative",
        achievement.severity === "positive" && "ach-positive",
        achievement.severity === "neutral" && "ach-neutral",
      )}
      style={{ animationDelay: `${delayMs}ms` }}
      title={achievement.flavor}
    >
      {achievement.name}
    </span>
  );
}

interface AchievementListProps {
  achievements: AchievementDef[];
  /** Base delay applied to every badge before stagger kicks in. */
  baseDelayMs?: number;
  /** Override stagger step. Default 70ms. */
  stepMs?: number;
  className?: string;
}

export function AchievementList({
  achievements,
  baseDelayMs = 0,
  stepMs = 70,
  className,
}: AchievementListProps) {
  if (achievements.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {achievements.map((a, i) => (
        <AchievementBadge
          key={a.id}
          achievement={a}
          delayMs={baseDelayMs + i * stepMs}
        />
      ))}
    </div>
  );
}
