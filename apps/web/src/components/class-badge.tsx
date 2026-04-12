import Link from "next/link";
import { getClassColor, getClassName } from "@/lib/class-colors";

interface ClassBadgeProps {
  name: string;
  realm: string;
  region: string;
  classSlug: string;
  linked?: boolean;
}

export function ClassBadge({
  name,
  realm,
  region,
  classSlug,
  linked = true,
}: ClassBadgeProps) {
  const color = getClassColor(classSlug);
  const title = `${name} - ${getClassName(classSlug)}`;

  const content = (
    <span style={{ color }} title={title} className="font-medium">
      {name}
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
