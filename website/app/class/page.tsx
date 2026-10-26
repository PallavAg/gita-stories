import { ClassReview } from "@/components/review/class-review";

export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id = "" } = await searchParams;
  // key on id so switching classes starts from a clean slate
  return <ClassReview key={id} id={id} />;
}
