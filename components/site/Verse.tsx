import s from "./Tribes.module.css";

/** A verse: Hebrew with nikud always; the translation and the reference follow. */
export default function Verse({ v, className }: { v: { he: string; tr: string | null; ref: string }; className?: string }) {
  return (
    <blockquote className={className}>
      <p className="verse" lang="he" dir="rtl">{v.he}</p>
      {v.tr ? <p className="verseTr">{v.tr}</p> : null}
      {v.ref ? <cite className={`verseRef ${s.ref}`}><bdi>{v.ref}</bdi></cite> : null}
    </blockquote>
  );
}
