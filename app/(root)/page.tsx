import type { Metadata } from "next";
import { asset } from "@/lib/asset";
import { getDict, LANG_KEY } from "@/lib/i18n";
import { ICONS } from "@/components/site/meta";

export const metadata: Metadata = { title: "שבטים · Shevatim", icons: ICONS, robots: { index: false, follow: true } };

// "/" only chooses a language: the saved one, or Hebrew. It runs before anything is painted.
const go = `(function(){var l='he';try{var s=localStorage.getItem(${JSON.stringify(LANG_KEY)});if(s==='he'||s==='en'||s==='fr')l=s}catch(e){}location.replace(${JSON.stringify(asset("/"))}+l+'/'+location.hash)})()`;

export default function RootPage() {
  const he = asset("/he/");
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: go }} />
      <noscript>
        <p style={{ padding: 32 }}><a className="link" href={he}>{getDict("he").root.go}</a></p>
      </noscript>
    </>
  );
}
