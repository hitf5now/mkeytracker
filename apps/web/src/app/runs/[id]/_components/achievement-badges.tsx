"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { RunDetailAchievement } from "@/types/api";
import { cn } from "@/lib/utils";

// ─── Badge ────────────────────────────────────────────────────────────────

interface AchievementBadgeProps {
  achievement: RunDetailAchievement;
  delayMs?: number;
}

export function AchievementBadge({
  achievement,
  delayMs = 0,
}: AchievementBadgeProps) {
  const [open, setOpen] = useState(false);
  const severityClass =
    achievement.severity === "negative"
      ? "ach-negative"
      : achievement.severity === "positive"
        ? "ach-positive"
        : "ach-neutral";
  const rarityClass = `ach-rarity-${achievement.rarity}`;

  return (
    <>
      <button
        type="button"
        className={cn("ach-badge", severityClass, rarityClass)}
        style={{ animationDelay: `${delayMs}ms` }}
        title={achievement.flavorText}
        onClick={() => setOpen(true)}
        aria-label={`Achievement: ${achievement.name}`}
      >
        {achievement.name}
      </button>
      {open && (
        <AchievementDetailModal
          achievement={achievement}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ─── List ─────────────────────────────────────────────────────────────────

interface AchievementListProps {
  achievements: RunDetailAchievement[];
  baseDelayMs?: number;
  stepMs?: number;
  /** "row" = inline flex-wrap (default). "col" = one badge per row. */
  direction?: "row" | "col";
  className?: string;
}

export function AchievementList({
  achievements,
  baseDelayMs = 0,
  stepMs = 70,
  direction = "row",
  className,
}: AchievementListProps) {
  if (achievements.length === 0) return null;
  const layout =
    direction === "col"
      ? "flex flex-col items-start gap-1"
      : "flex flex-wrap gap-1";
  return (
    <div className={cn(layout, className)}>
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

// ─── Detail modal ─────────────────────────────────────────────────────────

interface ModalProps {
  achievement: RunDetailAchievement;
  onClose: () => void;
}

function AchievementDetailModal({ achievement, onClose }: ModalProps) {
  // ESC-to-close + body scroll lock while open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const severityClass =
    achievement.severity === "negative"
      ? "ach-modal-negative"
      : achievement.severity === "positive"
        ? "ach-modal-positive"
        : "ach-modal-neutral";

  const severityLabel =
    achievement.severity === "negative"
      ? "Roast"
      : achievement.severity === "positive"
        ? "Praise"
        : "Note";

  return createPortal(
    <div
      className="ach-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ach-modal-title"
    >
      <div
        className={cn("ach-modal-card", severityClass)}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="ach-modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>

        <div className="ach-modal-icon" aria-hidden>
          {achievement.icon}
        </div>

        <div className="ach-modal-severity">
          {severityLabel} · <span className="capitalize">{achievement.rarity}</span>
        </div>
        <h3 id="ach-modal-title" className="ach-modal-title">
          {achievement.name}
        </h3>
        <p className="ach-modal-flavor">{achievement.flavorText}</p>

        <p className="ach-modal-description">{achievement.description}</p>

        <div className="ach-modal-reason">
          <div className="ach-modal-reason-label">Why you earned this</div>
          <div className="ach-modal-reason-body">{achievement.reason}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
