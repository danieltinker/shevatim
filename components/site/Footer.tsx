"use client";
import Link from "next/link";
import media from "@/content/media.json";
import { asset } from "@/lib/asset";
import { useCatalog } from "@/lib/catalog";
import { tr } from "@/lib/format";
import { LangSwitch } from "./Header";
import { useI18n } from "./Providers";
import s from "./Footer.module.css";

export default function Footer() {
  const { locale, t } = useI18n();
  const { categories, settings } = useCatalog();
  const home = `/${locale}/`;
  const hasContact = !!(settings.whatsapp || settings.instagram || settings.email);
  return (
    <footer className={`onBlack ${s.footer}`}>
      <div className={`wrap ${s.grid}`}>
        <div className={s.brand}>
          <img src={asset(media.brand.wordmarkWhiteSmall)} alt="Shevatim" width={626} height={242} loading="lazy" />
          <p className={s.promise}>{t.footer.line}</p>
        </div>
        <nav aria-label={t.footer.shop}>
          <h2 className={s.h}>{t.footer.shop}</h2>
          <ul>
            <li><Link href={`${home}collection/`}>{t.nav.collection}</Link></li>
            {categories.filter((c) => c.visible).sort((a, b) => a.sort - b.sort).map((c) => (
              <li key={c.key}><Link href={`${home}shop/?cat=${c.key}`}>{tr(c.name, locale)}</Link></li>
            ))}
          </ul>
        </nav>
        <nav aria-label={t.footer.more}>
          <h2 className={s.h}>{t.footer.more}</h2>
          <ul>
            <li><Link href={`${home}#tribes`}>{t.nav.tribes}</Link></li>
            <li><Link href={`${home}about/`}>{t.nav.about}</Link></li>
            <li><Link href={`${home}reserve/`}>{t.nav.bag}</Link></li>
            <li><Link href={`${home}terms/`}>{t.nav.terms}</Link></li>
          </ul>
        </nav>
        <div>
          {hasContact ? (
            <>
              <h2 className={s.h}>{t.footer.contact}</h2>
              <ul>
                {settings.whatsapp ? <li><a href={`https://wa.me/${settings.whatsapp}`} target="_blank" rel="noopener noreferrer">{t.footer.whatsapp}</a></li> : null}
                {settings.instagram ? <li><a href={settings.instagram} target="_blank" rel="noopener noreferrer">{t.footer.instagram}</a></li> : null}
                {settings.email ? <li><a href={`mailto:${settings.email}`}><bdi dir="ltr">{settings.email}</bdi></a></li> : null}
              </ul>
            </>
          ) : null}
          <h2 className={s.h} style={hasContact ? { marginBlockStart: 24 } : undefined}>{t.footer.language}</h2>
          <LangSwitch className={s.lang} />
        </div>
      </div>
      <p className={`wrap small muted ${s.legal}`}><bdi dir="ltr">© Shevatim</bdi></p>
    </footer>
  );
}
