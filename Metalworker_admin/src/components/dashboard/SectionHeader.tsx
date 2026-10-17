// src/components/dashboard/SectionHeader.tsx
import React from "react";

import { Section } from "../ui/Section";

export function SectionHeader({
  title,
  subtitle,
  rightElement,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle?: string;
  rightElement?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <Section
      title={title}
      subtitle={subtitle}
      right={rightElement}
      actionLabel={actionLabel}
      onAction={onAction}
    />
  );
}
