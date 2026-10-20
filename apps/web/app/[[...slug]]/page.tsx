import { notFound } from "next/navigation";
import { FeedView, feedPageCount } from "../../components/FeedView";

/**
 * FEED — "/" (page 1, with the top-stories strip) and "/page/<n>".
 * One optional catch-all so the static export always has ≥1 param
 * (a dynamic route with zero params is a build error in export mode).
 */
export const dynamicParams = false;

export async function generateStaticParams() {
  const pages = await feedPageCount();
  const params: Array<{ slug: string[] }> = [{ slug: [] }];
  for (let n = 2; n <= pages; n++) params.push({ slug: ["page", String(n)] });
  return params;
}

export default async function FeedPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const slug = (await params).slug ?? [];
  if (slug.length === 0) return <FeedView page={1} />;
  const page = Number(slug[1]);
  if (slug.length !== 2 || slug[0] !== "page" || !Number.isInteger(page) || page < 2) notFound();
  return <FeedView page={page} />;
}
