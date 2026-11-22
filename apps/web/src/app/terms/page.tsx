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

      <LegalSection title="8. No guarantee">
        <p>
          We work to keep the app running and your data safe, but it is provided as it is. It may be slow, change, or be
          unavailable for a time, and a feature may be removed. Keep your own copy of anything you cannot afford to
          lose: Menu → Your data and account gives you all of it as a file.
        </p>
        <p>
          As far as the law allows, we are not liable for indirect losses, or for decisions you make based on figures
          the app shows. Nothing here limits rights the consumer law of your country gives you and that cannot be
          signed away.
        </p>
      </LegalSection>

      <LegalSection title="9. Changes to these terms">
        <p>
          When these terms change in a way that matters, we say so in the app or by email before the change takes
          effect. If you keep using the app after that, you accept the new terms. If you do not, you can delete your
          account.
        </p>
      </LegalSection>

      <LegalSection title="10. Law">
        <p>
          These terms are governed by the law of Georgia. If you live in another country, you keep the protection its
          consumer law gives you.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
