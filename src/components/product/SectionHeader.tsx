/**
 * NIZAM · Product section header
 * Implemented by: PFOS Contract 04 / Visual Upgrade Wave 1
 * Owning requirements: consistent information hierarchy and accessible section labelling.
 * Depends on: React only.
 */
import type { ReactNode } from 'react';

export interface SectionHeaderProps {
  readonly eyebrow?: string;
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly level?: 1 | 2 | 3;
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  action,
  level = 2,
}: SectionHeaderProps) {
  const Heading = `h${level}` as 'h1' | 'h2' | 'h3';
  return (
    <div className="section-header">
      <div className="section-header-copy">
        {eyebrow ? <span className="section-eyebrow">{eyebrow}</span> : null}
        <Heading>{title}</Heading>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="section-header-action">{action}</div> : null}
    </div>
  );
}
