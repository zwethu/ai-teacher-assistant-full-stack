/**
 * "MILA" set in running text, with the golden-pillar I.
 *
 * The logo's wordmark draws the M's right stem in gold (#FCC018) and everything
 * else in royal purple — that gold I *is* the identity, so when the name appears
 * inside a heading it should carry it too, rather than being flattened into one
 * colour or a gradient.
 *
 * Display use only. Gold on a light background is an accent, not body text; at
 * small sizes the letter stops reading. Anything under ~24px should just say
 * MILA in the surrounding colour.
 *
 * The visible letters are hidden from assistive tech and the whole word is
 * exposed once instead, so splitting it into spans cannot make a screen reader
 * spell it out.
 */
export function MilaWord({ className = '' }: { className?: string }) {
  return (
    <span className={className}>
      <span aria-hidden="true">
        M<span className="text-gold-400">I</span>LA
      </span>
      <span className="sr-only">MILA</span>
    </span>
  )
}
