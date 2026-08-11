import type { ReactNode } from 'react'

/**
 * The Terms of Use and Privacy Notice, in one place.
 *
 * Rendered by two surfaces: the informational modal on the login page, and the
 * blocking acceptance gate a lecturer meets on first sign-in. The prose lives
 * only here so the two can never drift apart.
 *
 * **Import nothing but React.** `Login.test.tsx` mocks only `useAuth`, so
 * anything in this file's import graph that reaches `lib/firebase.ts` would run
 * `initializeApp()` in jsdom against undefined env vars and take the login
 * suite down with it.
 *
 * Every factual claim below is grounded in the code:
 *  - OAuth scopes: backend/utils/google_credentials.py
 *  - AI processing region + session retention: backend/services/
 *    agent_engine_client.py, agent_platform_sessions.py
 *  - Data regions: firebase.json (asia-southeast1), Agent Engine us-central1
 *  - Retention windows: backend/services/attachment_constants.py,
 *    backend/entity/GameSession.py
 *  - Game telemetry: docs/game-results-csv.md
 *  - Game links readable by anyone with the link: docs/firestore.rules
 * If any of those change, this document must change with them.
 */

/**
 * Bump this when the text changes in a way lecturers must re-accept. The
 * post-sign-in gate compares it against `users/{uid}.termsVersion`, so a bump
 * re-fires the gate for every account.
 */
export const TERMS_VERSION = '2026-08'

export const TERMS_UPDATED = 'Last updated August 2026'

/** The address the Privacy Notice points people at. */
export const CONTACT_EMAIL = 'nanghsumonpyae@mfu.ac.th'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h4 className="font-semibold text-slate-900">{title}</h4>
      {children}
    </section>
  )
}

/**
 * The document body only — no card, no scroll region, no buttons. Each render
 * site wraps it in its own chrome.
 */
export function TermsDocument() {
  return (
    <div className="space-y-5 text-sm leading-relaxed text-slate-700">
      <p>
        By using MILA (MFU Intelligent Lecturer Assistant) you agree to these terms.
        Please read them — they also explain what happens to your data and your
        students' data.
      </p>

      <h3 className="pt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-700">
        Terms of use
      </h3>

      <Section title="What MILA is">
        <p>
          MILA is an AI assistant for lecturers: course plans, lesson plans,
          assessments, labs, class email, and study games. It is a research project of
          the MFU Learning Innovation Institute at Mae Fah Luang University, built
          under the MLII Innovation Development Grant. It is not a commercial service.
        </p>
      </Section>

      <Section title="Who may use it">
        <p>
          Access is limited to lecturers approved by the project team. Sign in with a
          valid Google account; you are responsible for keeping that account secure.
          Access may be withdrawn at any time.
        </p>
      </Section>

      <Section title="Your Google account">
        <p>
          MILA asks Google for permission to: create and edit Google Docs it makes for
          you, manage files it creates in Google Drive, create Google Forms, and draft
          and send email through your Gmail. It cannot read your existing email, and
          it cannot see Drive files it did not create or open. You can revoke MILA's
          access at any time at myaccount.google.com.
        </p>
      </Section>

      <Section title="AI output is a draft">
        <p>
          Everything MILA generates is a draft for you to review. AI output can be
          wrong, incomplete, or unsuitable for your class — check it before you use
          it. Nothing is sent to your students until you explicitly approve it.
        </p>
      </Section>

      <Section title="Your responsibilities">
        <p>
          You are responsible for what you send to students, for using student data
          you upload lawfully and appropriately, and for not uploading material you
          have no right to use.
        </p>
      </Section>

      <Section title="Ownership">
        <p>
          Your course content stays yours. The MILA software, name, and brand belong
          to Mae Fah Luang University.
        </p>
      </Section>

      <Section title="Availability">
        <p>
          MILA is provided as-is, without warranty. As a research project it may
          change, pause, or stop at any time.
        </p>
      </Section>

      <Section title="Changes to these terms">
        <p>
          When these terms change in a way that matters, you will be asked to read and
          accept them again the next time you sign in.
        </p>
      </Section>

      <h3 className="pt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-700">
        Privacy notice
      </h3>

      <Section title="What we store about you">
        <p>
          Your name, email address, profile photo, and Google connection status. The
          token that lets MILA act on your Google account is kept in a private record
          that no browser can read.
        </p>
      </Section>

      <Section title="What you put in">
        <p>
          Class rosters (student names and email addresses), uploaded course
          materials, chat messages, and the artifacts MILA generates. This data is
          stored on Google Cloud in Singapore (asia-southeast1).
        </p>
      </Section>

      <Section title="AI processing">
        <p>
          Your chat messages, course materials, and attachments are processed by
          Google Vertex AI in the United States (us-central1) — that processing
          happens outside Singapore. Uploaded course materials are indexed so MILA can
          search them. Google holds conversation sessions for up to 90 days. When you
          ask MILA to draft a class email, the student addresses you selected are part
          of the instruction sent to the AI.
        </p>
      </Section>

      <Section title="Student data">
        <p>
          When a student plays a study game, MILA records their roster name, school
          email, chosen nickname, answers, score, and how they played — time per
          round, pauses, tab switches, and time spent reviewing feedback. This is
          visible to you and exportable as a spreadsheet. Treat these signals as a
          starting point for a conversation with the student, not as proof of
          anything.
        </p>
      </Section>

      <Section title="How long data is kept">
        <p>
          Chat attachments are deleted 30 days after they are sent; uploads never
          attached to a message are deleted within about a day. Game sessions expire
          about 30 days after creation, or 7 days after their deadline. Other content
          — rosters, chats, generated artifacts, emails — is kept until you delete
          it. Deleting a class removes its files, chats, roster, and search index.
        </p>
      </Section>

      <Section title="Deletion and access">
        <p>
          There is no self-service account deletion or data export yet. To have your
          data or a student's data removed, contact the team at{' '}
          <a className="font-medium text-violet-700 underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          . Note that removing a student from a roster does not delete their past game
          results.
        </p>
      </Section>

      <Section title="Game links are not confidential">
        <p>
          A study game can be opened by anyone who has its link. Do not put sensitive
          or confidential material into game content.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about these terms or your data:{' '}
          <a className="font-medium text-violet-700 underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>
    </div>
  )
}
