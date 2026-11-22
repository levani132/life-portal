import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, LegalSection } from '../../components/legal-page';
import { APP_WORDMARK, LEGAL_ADDRESS, LEGAL_OPERATOR, SUPPORT_EMAIL } from '../../lib/brand';

export const metadata: Metadata = { title: `Terms · ${APP_WORDMARK}` };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of use"
      lead={`These are the rules between you and ${APP_WORDMARK}. Creating an account means you accept them, together with the Privacy Policy and the Community Rules.`}
    >
      <LegalSection title="1. Who we are">
        <p>
          {APP_WORDMARK} is run by {LEGAL_OPERATOR}, {LEGAL_ADDRESS}. You can reach us at{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </LegalSection>

      <LegalSection title="2. Your account">
        <ul>
          <li>You must be <strong>16 or older</strong> to have an account.</li>
          <li>An account is for one person. Keep your password to yourself and tell us if you think someone else has used your account.</li>
          <li>Give an email address you can read: it is how you get back in if you forget your password.</li>
          <li>You can delete your account at any time in Menu → Your data and account. Deleting is immediate and cannot be undone.</li>
        </ul>
      </LegalSection>

      <LegalSection title="3. What the app is, and is not">
        <p>
          {APP_WORDMARK} is a place to keep track of your own life: what you eat, how you train, and what you choose to
          share with others. It works from what you enter.
        </p>
        <ul>
          <li><strong>It is not medical, nutritional, fitness or financial advice.</strong> Calorie targets, strength levels and similar figures are estimates, and the app marks them as such. Talk to a doctor or another qualified person before changing your diet or training, especially if you have a health condition.</li>
          <li>Food facts come from you, from other members and from public sources such as Open Food Facts. They can be wrong. Check a label when it matters.</li>
          <li>What another member posts is theirs, not ours, and we do not check it for accuracy.</li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Your content">
        <ul>
          <li>What you enter and post stays yours.</li>
          <li>You give us permission to store it and show it to the people you chose (only you, your friends, everyone, or the people you sent a link to), for as long as it is in the app. We need that permission to run the service; we do not use it for anything else.</li>
          <li>Only post what you have the right to post. Do not post other people’s private information or photos of them without their agreement.</li>
          <li>When someone saves a food, an exercise or a plan from your post, that copy is theirs and stays with them if you delete the post or your account. It no longer carries your name once your account is deleted.</li>
        </ul>
      </LegalSection>

      <LegalSection title="5. How we keep the app safe">
        <ul>
          <li>Everyone follows the <Link href="/rules">Community Rules</Link>.</li>
          <li>Photos and video stills that other people can see are checked automatically before they are shown. Posts can be reported by any member.</li>
          <li>A reported post, or one the automatic check flags, may be hidden and is looked at by a person on our side, who can see it whatever audience you chose.</li>
          <li>We may remove content that breaks these terms or the rules, and suspend or close an account that does so seriously or repeatedly. If you think we got it wrong, write to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</li>
        </ul>
        <p>
          <strong>These are efforts, not a guarantee.</strong> We do not look at everything people post before it
          appears, automatic checks miss things, and a report takes time to reach a person. We do not promise that
          nothing harmful, wrong or offensive will ever appear in the app.
        </p>
      </LegalSection>

      <LegalSection title="6. Connecting an AI assistant or another app">
        <p>
          You can let an AI assistant or a Shortcut on your phone read and add to your data. That is your choice: you
          start it, you can end it in the app at any time, and what that assistant or app does with what it reads is
          between you and its provider.
        </p>
      </LegalSection>

      <LegalSection title="7. Price">
        <p>
          The app is free today. If paid features arrive, they will be clearly marked, the price will be shown before
          you pay, and what is free now will not be taken away from accounts without notice.
        </p>
      </LegalSection>

      <LegalSection title="8. Who is responsible for what">
        <p>
          <strong>You are responsible</strong> for what you post, for how you use the app, and for the decisions you
          make with what it shows you.
        </p>
        <p>
          <strong>We are not responsible</strong> for what other members post, say or do, in the app or outside it; for
          content our checks did not catch; for food facts and other information that comes from members or from
          outside sources; for what an assistant or another app you connected does; or for the services of other
          companies the app relies on.
        </p>
        <p>
          <strong>We answer only for actual, direct harm that we ourselves cause</strong> by breaking these terms or the
          law deliberately or through gross negligence, and only to the extent the law requires. We are not liable for
          indirect losses, lost data, lost income or lost opportunity.
        </p>
        <p>
          The app is provided as it is. We work to keep it running and your data safe, but it may be slow, change, or
          be unavailable for a time, and a feature may be removed. Keep your own copy of anything you cannot afford to
          lose: Menu → Your data and account gives you all of it as a file.
        </p>
        <p>
          Nothing here limits rights the law gives you and that cannot be signed away, including under the consumer and
          data protection law of your country.
        </p>
      </LegalSection>

      <LegalSection title="9. Changes to these terms">
        <p>
          When these terms change in a way that matters, we say so in the app or by email before the change takes
          effect. If you keep using the app after that, you accept the new terms. If you do not, you can delete your
          account.
        </p>
      </LegalSection>

      <LegalSection title="10. Law and disputes">
        <p>
          These terms are governed by the law of Georgia, and disputes are decided by the courts of Georgia. If you
          live in another country, you keep the protection its consumer law gives you and that cannot be signed away.
          Write to us first: most things can be settled by a message.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
