import Link from "next/link";
import { getClassColor, getClassName } from "@/lib/class-colors";
import { getClassIconUrl } from "@mplus/wow-constants";

interface ClassBadgeProps {
  name: string;
  realm: string;
  region: string;
  classSlug: string;
  linked?: boolean;
  showIcon?: boolean;
  thumbnailUrl?: string | null;
}

export function ClassBadge({
  name,
  realm,
  region,
  classSlug,
  linked = true,
  showIcon = true,
  thumbnailUrl,
}: ClassBadgeProps) {
  const color = getClassColor(classSlug);
  const title = `${name} - ${getClassName(classSlug)}`;
  const iconUrl = getClassIconUrl(classSlug, "small");

  const content = (
    <span className="inline-flex items-center gap-1.5">
      {showIcon && (
        <img
          src={thumbnailUrl ?? iconUrl}
          alt={getClassName(classSlug)}
          className="h-5 w-5 rounded-sm"
          loading="lazy"
        />
      )}
      <span style={{ color }} title={title} className="font-medium">
        {name}
      </span>
    </span>
  );

  if (!linked) return content;

  return (
    <Link
      href={`/players/${region}/${realm}/${name}`}
      className="hover:underline"
    >
      {content}
    </Link>
  );
}
