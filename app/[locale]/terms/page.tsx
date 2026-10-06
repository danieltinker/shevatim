import type { Metadata } from "next";
import { pageMeta } from "@/components/site/meta";
import { getDict } from "@/lib/i18n";
import type { Locale } from "@/lib/types";
import s from "@/components/site/Page.module.css";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = (await params).locale as Locale;
  const t = getDict(locale);
  return pageMeta(locale, "/terms/", t.terms.title, t.meta.terms);
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const t = getDict((await params).locale as Locale);
  return (
    <div className={s.text}>
      <div className="wrap">
        <div className={s.prose}>
          <h1>{t.terms.title}</h1>
          <p className={s.note}>{t.terms.draft}</p>
          <ol className={s.list}>
            {[t.terms.t1, t.terms.t2, t.terms.t3, t.terms.t4, t.terms.t5, t.terms.t6].map((x) => <li key={x}>{x}</li>)}
          </ol>
        </div>
      </div>
    </div>
  );
}
