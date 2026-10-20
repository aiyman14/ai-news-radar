import { notFound } from "next/navigation";
import { FeedView, feedPageCount } from "../../../components/FeedView";
import { KINDS } from "../../../lib/kinds";

/** KIND feeds — "/kind/<kind>" and "/kind/<kind>/page/<n>". */
export const dynamicParams = false;

export async function generateStaticParams() {
  const params: Array<{ slug: string[] }> = [];
  for (const kind of KINDS) {
    params.push({ slug: [kind] });
    const pages = await feedPageCount(kind);
    for (let n = 2; n <= pages; n++) params.push({ slug: [kind, "page", String(n)] });
  }
  return params;
}

export default async function KindPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const slug = (await params).slug;
  const kind = slug[0] ?? "";
  if (!(KINDS as readonly string[]).includes(kind)) notFound();
  if (slug.length === 1) return <FeedView kind={kind} page={1} />;
  const page = Number(slug[2]);
  if (slug.length !== 3 || slug[1] !== "page" || !Number.isInteger(page) || page < 2) notFound();
  return <FeedView kind={kind} page={page} />;
}
