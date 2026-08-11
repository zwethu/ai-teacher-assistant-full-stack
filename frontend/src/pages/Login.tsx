import { useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import {
  Mail,
  type LucideIcon,
} from 'lucide-react'

import { MilaLogo } from '../components/brand/MilaLogo'
import { MilaWord } from '../components/brand/MilaWord'
import { useAuth } from '../hooks/useAuth'
import { Button, Modal } from '../design-system'
import { ARTIFACT_ICONS } from '../utils/artifactIcons'
import LoadingScreen from '../components/ui/LoadingScreen'
import { TermsDocument, TERMS_UPDATED } from '../components/legal/TermsDocument'

/**
 * Sign-in page.
 *
 * Two columns on desktop: what MILA is on the left over the academic canvas,
 * the sign-in itself on the right in glass. On narrow screens the left column
 * drops entirely — it is context, not a step in the task — and the right column
 * becomes the whole page.
 *
 * Both columns scroll independently rather than the page scrolling as one, so
 * the sign-in button stays reachable on a short viewport without the marketing
 * copy pushing it off screen.
 */

// ---------------------------------------------------------------------------
// Content — kept next to the page it describes, and true to what is built
// ---------------------------------------------------------------------------

type Capability = { icon: LucideIcon; title: string; body: string }

/** The generation workflows the composer actually offers (see GENERATE_MODES). */
const CAPABILITIES: Capability[] = [
  { icon: ARTIFACT_ICONS.course_blueprint, title: 'Course plans', body: 'A term mapped out week by week.' },
  { icon: ARTIFACT_ICONS.lesson_plan, title: 'Lesson plans', body: 'Structured sessions from your own materials.' },
  { icon: ARTIFACT_ICONS.assessment, title: 'Assessments', body: 'Quizzes and tests, exported to Google Forms.' },
  { icon: ARTIFACT_ICONS.lab, title: 'Labs', body: 'Practical worksheets with setup and steps.' },
  { icon: Mail, title: 'Class email', body: 'Drafted, reviewed by you, then sent or scheduled.' },
  { icon: ARTIFACT_ICONS.game, title: 'Study games', body: 'Revision activities built from your notes.' },
]

/**
 * Google services and why each is asked for. This mirrors the OAuth scopes the
 * backend actually requests (utils/google_credentials.py) — the consent screen
 * should never ask for something this page has not already explained.
 */
const GOOGLE_SERVICES: { name: string; purpose: string }[] = [
  { name: 'Google Docs', purpose: 'lesson plans and labs' },
  { name: 'Google Drive', purpose: 'a folder per class for what MILA creates' },
  // "creating assessments", not "and their responses": forms.responses.readonly
  // is granted but nothing reads responses yet. Say only what is built.
  { name: 'Google Forms', purpose: 'creating assessments' },
  { name: 'Gmail', purpose: 'messages to your students' },
]

/**
 * Who builds MILA — shown in the About modal. The advisor's address doubles as
 * the contact for terms and data questions (see TermsDocument.CONTACT_EMAIL).
 */
const ADVISOR = { name: 'Dr. Nang Hsu Mon Pyae', email: 'nanghsumonpyae@mfu.ac.th' }

const TEAM: { name: string; email: string }[] = [
  { name: 'Nyan Sint Zaw', email: '6731503077@lamduan.mfu.ac.th' },
  { name: 'Thaw Zin Myo Aung', email: '6731503088@lamduan.mfu.ac.th' },
  { name: 'Zwe Thura Aung', email: '6731503097@lamduan.mfu.ac.th' },
  { name: 'Thant Htoo San', email: '6731503087@lamduan.mfu.ac.th' },
  { name: 'Nadi Zeya', email: '6731503070@lamduan.mfu.ac.th' },
]

/** Email as a quiet violet link — used for every address in the About modal. */
const MAIL_LINK = 'font-medium text-violet-700 underline-offset-2 hover:underline'

const MICRO_LABEL = 'text-[10px] font-bold uppercase tracking-[0.2em] text-violet-700'

/**
 * Lockup height, and the nudge that makes it sit flush with the type below it.
 *
 * The artwork does not start at its own viewBox edge — the leftmost bead's
 * outer edge lands ~7.9% in (bead cx 20.2, r 7.5, inside a `scale(0.875)`
 * group on a 140-wide box). Rendered flush-left the mark therefore hangs about
 * 15px right of the heading's stem, which reads as a misalignment rather than
 * as clear space. Pulling it back by that same fraction lines the ring's
 * leftmost point up with the text.
 */
const LOGO_HEIGHT = 112
const LOGO_OPTICAL_INSET = Math.round(LOGO_HEIGHT * (140 / 84) * 0.079)

/**
 * Both columns end in a footer, and they have to land on the same line — the
 * page is one surface split by a glass edge, not two independent pages. Sharing
 * these three classes (and the columns' `py-14`) is what puts the rule, the
 * micro-label and the content line at identical heights on either side.
 */
const FOOTER_BAND = 'border-t border-violet-200/60 pt-6'
const FOOTER_LABEL = 'text-[10px] font-bold uppercase tracking-[0.2em] text-slate-600'
const FOOTER_LINE = 'mt-2.5 text-sm font-medium leading-6 text-slate-600'

// ---------------------------------------------------------------------------

function TermsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Terms and Privacy Notice"
      eyebrow={TERMS_UPDATED}
      size="lg"
      footer={<Button onClick={onClose}>Got it</Button>}
    >
      {/* The prose lives in TermsDocument — the same component the post-sign-in
          acceptance gate renders, so the two can never drift apart. */}
      <TermsDocument />
    </Modal>
  )
}

function AboutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="About MILA"
      eyebrow="Educator-first assistant"
      size="lg"
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="space-y-5 text-sm leading-relaxed text-slate-700">
        <p>
          MILA — MFU Intelligent Lecturer Assistant — supports you in planning lessons,
          creating assessments, managing classes, and communicating with students.
        </p>
        <p>
          It is built <strong className="font-semibold text-slate-900">by educators, for
          educators</strong>, around the classroom workflows you already use, and it is
          improved continuously from lecturer feedback.
        </p>
        <p>
          MILA is developed at Mae Fah Luang University under the MLII Innovation
          Development Grant, at the MFU Learning Innovation Institute.
        </p>

        <section className="space-y-1.5">
          <h4 className="font-semibold text-slate-900">Project advisor</h4>
          <p>
            {ADVISOR.name} —{' '}
            <a className={MAIL_LINK} href={`mailto:${ADVISOR.email}`}>
              {ADVISOR.email}
            </a>
          </p>
        </section>

        <section className="space-y-1.5">
          <h4 className="font-semibold text-slate-900">Development team</h4>
          <ul className="space-y-1">
            {TEAM.map(({ name, email }) => (
              <li key={email}>
                {name} —{' '}
                <a className={MAIL_LINK} href={`mailto:${email}`}>
                  {email}
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-1.5">
          <h4 className="font-semibold text-slate-900">Contact</h4>
          <p>
            Questions, feedback, or data requests:{' '}
            <a className={MAIL_LINK} href={`mailto:${ADVISOR.email}`}>
              {ADVISOR.email}
            </a>
          </p>
        </section>
      </div>
    </Modal>
  )
}

export default function Login() {
  const { user, loading, signInWithGoogle } = useAuth()
  const [searchParams] = useSearchParams()
  // The OAuth callback bounces a non-allowlisted address back here. Without a
  // message the round trip looks like a silent failure, and the natural next
  // move is to try the same account again.
  const notLecturer = searchParams.get('error') === 'not_lecturer'
  const [redirecting, setRedirecting] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  /* Deliberately not persisted: a consent box that comes back pre-ticked is a
     dark pattern. One click per visit is the price of an honest ask; the
     durable record is the per-account acceptance behind sign-in (TermsGate). */
  const [agreed, setAgreed] = useState(false)

  if (loading) return <LoadingScreen label="Checking sign-in status…" />
  if (user) return <Navigate to="/chat" replace />

  return (
    <div className="academic-bg fixed inset-0 flex font-sans">
      <TermsModal open={termsOpen} onClose={() => setTermsOpen(false)} />
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />

      {/* ---------------------------------------------------------------- */}
      {/* Left: what MILA is                                               */}
      {/* ---------------------------------------------------------------- */}
      {/* `justify-between` on three groups — mark, hero, integrations — so the
          column occupies the full height on purpose rather than stacking from
          the top and trailing off. */}
      <section className="hero-left-branding hidden flex-1 flex-col justify-between gap-12 overflow-y-auto px-12 py-14 lg:flex xl:px-20">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="maia-blob maia-blob--azure absolute -top-16 right-[-6rem] h-[26rem] w-[26rem]" />
          <div className="maia-blob maia-blob--indigo absolute bottom-24 right-[12%] h-72 w-72" />
        </div>
        {/* No container. The lockup carries its own clear space, and boxing it
            made the mark read as a stray card floating on the canvas. */}
        <div style={{ marginLeft: -LOGO_OPTICAL_INSET }}>
          <MilaLogo height={LOGO_HEIGHT} />
        </div>

        <div className="max-w-3xl 2xl:max-w-5xl">
          <p className={MICRO_LABEL}>Your teaching companion</p>

          {/* One clause per line, deliberately. At `text-4xl` in a `max-w-xl`
              column the first clause wrapped after "for", so the heading read as
              three ragged lines instead of two balanced ones. A wider measure
              plus a smaller step at `lg` keeps "Smart support for educators," on
              one line at every width, which is also what frees the height the
              mark above now uses. */}
          <p className="mt-3 font-display text-3xl font-bold leading-[1.12] tracking-[-0.025em] text-slate-900 xl:text-5xl xl:tracking-[-0.03em]">
            <span className="block">Smart support for educators,</span>
            <span className="block text-violet-600">by educators.</span>
          </p>

          <p className="mt-6 max-w-lg text-lg leading-relaxed text-slate-600 2xl:max-w-2xl">
            {/* Plain, not MilaWord: gold on this canvas measures 1.35:1 at
                18px, so the I all but vanishes — and the component's own rule
                is display sizes only. The mark sits directly above anyway. */}
            <span className="font-semibold text-slate-800">MILA</span> turns your course
            materials into the things you actually hand out — and sends them where your
            students already are. Built at Mae Fah Luang University.
          </p>

          {/* A row per workflow rather than two large cards: the product does
              six of these, and two cards both over-weighted the two they named
              and left the column looking half-finished. */}
          <ul className="mt-10 grid grid-cols-2 gap-x-6 gap-y-6 xl:gap-x-10 2xl:grid-cols-3">
            {CAPABILITIES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-white/70 bg-white/70 text-violet-600 shadow-sm">
                  <Icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-semibold text-slate-900">{title}</span>
                  <span className="mt-1 block text-sm leading-normal text-slate-600">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Shares its rule position and two-row rhythm with the sign-in
            column's footer, so the two read as one band across the seam
            instead of two footers that happen to be near each other. */}
        <div className={FOOTER_BAND}>
          <p className={FOOTER_LABEL}>Works seamlessly with</p>
          {/* A fixed 32px gutter, not `justify-between`. Spreading five names
              across the full column stretched the gaps to whatever width was
              left over, which varies with the viewport and pulled the list
              apart. A constant gap keeps them reading as one row. */}
          <div className={`${FOOTER_LINE} flex flex-wrap gap-x-8 gap-y-1`}>
            {GOOGLE_SERVICES.map(({ name }) => (
              <span key={name}>{name}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Right: sign in                                                   */}
      {/* ---------------------------------------------------------------- */}
      {/* Everything here — including the footer — is one group centred with
          `my-auto`, rather than a `flex-1 justify-center` block above a footer
          pinned to the bottom. That older arrangement split the column's spare
          height in two and parked half of it between the last link and the
          footer, where it read as a hole. Centring the whole group instead puts
          all the slack outside it, as symmetric margin.

          `my-auto` rather than `justify-center` on the column: it centres the
          same way but still scrolls from the top when the viewport is too short
          to fit the group, instead of clipping its head. */}
      <section className="login-card flex w-full flex-col overflow-y-auto px-6 py-14 sm:px-10 lg:w-[27rem] lg:px-12 xl:w-[31rem]">
        {/* Bounded spacers rather than `my-auto`. Auto margins split the spare
            height evenly, which parked half of it between the last button and
            the footer — a gap bounded on both sides, so it read as a hole. The
            second spacer is capped, so the surplus collects above the group
            instead, where it is just page margin. Both collapse to zero when
            the column overflows, so a short viewport still scrolls from the
            top rather than clipping the heading. */}
        <div aria-hidden="true" className="flex-1" />

        <div className="mx-auto w-full max-w-sm md:max-w-md lg:max-w-sm">
          {/* The left column is hidden below lg, so the mark has to appear here
              or the page loses its identity entirely on a phone. */}
          <div className="mb-10 lg:hidden">
            <MilaLogo height={38} />
          </div>
          {/* The page's only h1: the left column is `hidden lg:flex`, so below
              1024px its heading is out of the accessibility tree entirely and
              the document used to start at h2. "Sign in", not "Log in" —
              everything else in the app says sign in. */}
          <h1 className="font-display text-3xl font-bold leading-[1.15] tracking-[-0.015em] text-slate-900">
            Sign in to <MilaWord className="text-violet-600" />
          </h1>
          <p className="mt-3 text-base leading-relaxed text-slate-600">
            Plan a lesson, build an assessment, and send it to your students.
          </p>

          {/* signInWithGoogle is a full-page redirect, so without this the
              button sits inert for however long the round trip takes and the
              page looks broken. `loading` renders the bead garland — the
              loading loader, never the thinking one. */}
          {notLecturer && (
            <div
              role="alert"
              className="mt-8 rounded-2xl border border-amber-200 bg-amber-50/90 p-4 text-left"
            >
              <p className="text-sm font-semibold text-amber-900">
                That account can't sign in here
              </p>
              <p className="mt-1 text-sm leading-relaxed text-amber-800">
                MILA is for lecturers, and this Google account isn't on the list. If you're
                a student, open the game link your teacher sent you instead. If you're
                staff, ask your admin to add your email — then sign in again.
              </p>
            </div>
          )}

          {/* The agreement sits directly above the button it arms, so cause
              and effect share one glance. Not the design-system Checkbox: its
              label is typed string-only, and this one needs a live link. */}
          <label
            className={`flex cursor-pointer items-start gap-2.5 text-sm leading-relaxed text-slate-700 ${
              notLecturer ? 'mt-5' : 'mt-10'
            }`}
          >
            <input
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              className="mt-0.5 h-4 w-4 flex-none cursor-pointer accent-violet-600"
            />
            <span id="terms-agree-label">
              I have read and agree to the{' '}
              <button
                type="button"
                className="font-semibold text-violet-700 underline underline-offset-2"
                /* preventDefault so opening the document never toggles the box
                   it happens to be labelling. */
                onClick={(event) => {
                  event.preventDefault()
                  setTermsOpen(true)
                }}
              >
                Terms and Privacy Notice
              </button>
            </span>
          </label>

          <Button
            type="button"
            onClick={() => {
              setRedirecting(true)
              signInWithGoogle()
            }}
            loading={redirecting}
            disabled={!agreed}
            /* Points a screen reader at the reason the button is shut. */
            aria-describedby="terms-agree-label"
            size="lg"
            block
            /* Greyed while shut, violet once the box is ticked — the colour
               arriving is the feedback. `!` because the design system's
               unlayered CSS beats Tailwind's @layer utilities. */
            className="mt-4 disabled:!bg-slate-200 disabled:!text-slate-500 disabled:!opacity-100 disabled:!shadow-none"
          >
            {redirecting ? 'Taking you to Google…' : 'Sign in with Google'}
          </Button>

          <div className="mt-4 rounded-2xl border border-white/70 bg-white/70 p-5 shadow-sm backdrop-blur-sm">
            <p className="text-sm font-semibold text-slate-900">What MILA will ask for</p>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
              Google will ask you to grant access to the services below. MILA uses them
              only for the classroom work you start.
            </p>
            <ul className="mt-4 space-y-2">
              {GOOGLE_SERVICES.map(({ name, purpose }) => (
                <li key={name} className="flex gap-2.5 text-sm leading-snug">
                  <span className="mt-2 h-1 w-1 flex-none rounded-full bg-violet-400" />
                  <span className="text-slate-600">
                    <span className="font-semibold text-slate-800">{name}</span> — {purpose}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* The design system's `secondary` — frosted white against the solid
              violet primary — so these read as buttons without competing with
              the one action the page exists for. Equal columns rather than a
              flex row: two buttons of different widths under a full-width CTA
              look like a mistake. */}
          <div className="mt-8 grid grid-cols-2 gap-3">
            <Button type="button" variant="secondary" size="sm" block onClick={() => setTermsOpen(true)}>
              Terms and privacy
            </Button>
            <Button type="button" variant="secondary" size="sm" block onClick={() => setAboutOpen(true)}>
              About and contact
            </Button>
          </div>
        </div>

        <div aria-hidden="true" className="max-h-20 flex-1" />

        {/* Outside the group and last in the column, so it sits on the same
            line as the integrations footer opposite. The grant line leads and
            the copyright follows, which is what puts © level with the Google
            services list rather than a row above it. */}
        <footer className={`mx-auto w-full max-w-sm md:max-w-md lg:max-w-sm ${FOOTER_BAND}`}>
          <p className={FOOTER_LABEL}>Built with the MLII Innovation Development Grant</p>
          {/* Two items, so the ends of the rule are the natural anchors —
              unlike the five-name list opposite, which needs a fixed gutter. */}
          <div className={`${FOOTER_LINE} flex justify-between gap-4`}>
            <span>© 2026 MILA</span>
            <span>Mae Fah Luang University</span>
          </div>
        </footer>
      </section>
    </div>
  )
}
