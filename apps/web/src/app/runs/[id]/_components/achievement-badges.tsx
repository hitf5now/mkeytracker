"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { AwardedAchievement } from "@/lib/achievements";
import { cn } from "@/lib/utils";

// ─── Badge ────────────────────────────────────────────────────────────────

interface AchievementBadgeProps {
  awarded: AwardedAchievement;
  delayMs?: number;
}

export function AchievementBadge({
  awarded,
  delayMs = 0,
}: AchievementBadgeProps) {
  const [open, setOpen] = useState(false);
  const { def } = awarded;
  const severityClass =
    def.severity === "negative"
      ? "ach-negative"
      : def.severity === "positive"
        ? "ach-positive"
        : "ach-neutral";

  return (
    <>
      <button
        type="button"
        className={cn("ach-badge", severityClass)}
        style={{ animationDelay: `${delayMs}ms` }}
        title={def.flavor}
        onClick={() => setOpen(true)}
        aria-label={`Achievement: ${def.name}`}
      >
        <span className="ach-badge-icon" aria-hidden>
          {def.icon}
        </span>
        <span>{def.name}</span>
      </button>
      {open && <AchievementDetailModal awarded={awarded} onClose={() => setOpen(false)} />}
    </>
  );
}

// ─── List ─────────────────────────────────────────────────────────────────

interface AchievementListProps {
  awarded: AwardedAchievement[];
  baseDelayMs?: number;
  stepMs?: number;
  className?: string;
}

export function AchievementList({
  awarded,
  baseDelayMs = 0,
  stepMs = 70,
  className,
}: AchievementListProps) {
  if (awarded.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {awarded.map((a, i) => (
        <AchievementBadge
          key={a.def.id}
          awarded={a}
          delayMs={baseDelayMs + i * stepMs}
        />
      ))}
    </div>
  );
}

// ─── Detail modal ─────────────────────────────────────────────────────────

interface ModalProps {
  awarded: AwardedAchievement;
  onClose: () => void;
}

function AchievementDetailModal({ awarded, onClose }: ModalProps) {
  const { def, reason } = awarded;

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
    def.severity === "negative"
      ? "ach-modal-negative"
      : def.severity === "positive"
        ? "ach-modal-positive"
        : "ach-modal-neutral";

  const severityLabel =
    def.severity === "negative"
      ? "Roast"
      : def.severity === "positive"
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
          {def.icon}
        </div>

        <div className="ach-modal-severity">{severityLabel}</div>
        <h3 id="ach-modal-title" className="ach-modal-title">
          {def.name}
        </h3>
        <p className="ach-modal-flavor">{def.flavor}</p>

        <p className="ach-modal-description">{def.description}</p>

        <div className="ach-modal-reason">
          <div className="ach-modal-reason-label">Why you earned this</div>
          <div className="ach-modal-reason-body">{reason}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
