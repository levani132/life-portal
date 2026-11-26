import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, LegalSection } from '../../components/legal-page';
import { APP_WORDMARK, LEGAL_ADDRESS, LEGAL_OPERATOR, PRIVACY_EMAIL } from '../../lib/brand';

export const metadata: Metadata = { title: `Privacy · ${APP_WORDMARK}` };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      lead={`What ${APP_WORDMARK} stores about you, why, who else handles it, and how you take it with you or delete it. In short: everything is private unless you share it, we do not sell data, and we do not show advertising based on your health.`}
    >
      <LegalSection title="1. Who is responsible">
        <p>
          {LEGAL_OPERATOR}, {LEGAL_ADDRESS}, decides how your data is used. For anything about your data, write to{' '}
          <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>.
        </p>
      </LegalSection>

      <LegalSection title="2. What we store">
        <ul>
          <li><strong>Your account:</strong> name, email address, a scrambled form of your password that cannot be turned back into it, and, if you sign in with Google, the identifier Google gives us for you.</li>
          <li><strong>What you log:</strong> foods and meals, body weight, nutrition goals, workouts, exercises, sets and plans. This is information about your health.</li>
          <li><strong>Activity from Apple Health,</strong> only if you set up the Shortcut that sends it: energy burned and similar daily totals.</li>
          <li><strong>What you share:</strong> your profile (name, username, photo, bio), posts, photos, short videos, comments, likes, friends, blocks and messages. Messages are stored so both people can read them; they are not end-to-end encrypted.</li>
          <li><strong>Pages you follow and pages you manage:</strong> which pages you follow, and for a page you created or help run, its profile, posts, messages, who manages it and the invitations to help run it. A page’s follower count is shown; the list of who follows it is not shown to anyone, including the page. A page may follow you: it then sees your public posts in its feed, which it could already open, and nothing else.</li>
          <li><strong>Anything else you enter</strong> in a part of the app you switched on.</li>
          <li><strong>Sign-in and safety records:</strong> the devices signed in to your account, and a log of sign-in events (for example a failed password) kept for 90 days. It holds a scrambled form of the internet address, never the address itself.</li>
          <li><strong>Notification details,</strong> if you allow notifications: the address your phone or browser gives us to deliver them, and, if you manage pages, which of them that device is using the app as.</li>
        </ul>
        <p>
          We do not use advertising or tracking cookies and we run no third-party analytics. The app keeps one cookie
          that holds your sign-in. On your own device it also keeps a copy of your recent food, training and your own
          posts, so it works without a connection; signing out or deleting your account removes it.
        </p>
        <p>
          Our error log and usage counters hold no person: a scrubbed error message, the kind of page, and a count.
          When you see a page’s post, the page’s managers see one more view on it. We keep only a count per post and
          day; to count you once a day we keep a coded key made from your account, the post and the day, which
          cannot be read without our server’s secret and is deleted after two days.
        </p>
      </LegalSection>

      <LegalSection title="3. Why, and on what legal ground">
        <ul>
          <li><strong>To run the app for you</strong> (your account, your records, what you share): this is the service you asked for when you created an account.</li>
          <li><strong>Health information</strong> (food, weight, training, Apple Health activity): on your explicit consent, which you give when you create your account and can withdraw at any time by deleting what you entered or your account.</li>
          <li><strong>Keeping accounts and people safe</strong> (sign-in records, limits on repeated attempts, checking photos, reviewing reports): our legitimate interest in a safe service, and our legal duties.</li>
          <li><strong>Emails about your account</strong> (confirming your address, resetting a password, a notice that your account was deleted or suspended, or that a post of yours was removed): part of running the account. We send no marketing email.</li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Who can see what">
        <ul>
          <li><strong>Private is the default.</strong> What you log is seen by you alone until you choose otherwise.</li>
          <li>For each post you choose who sees it: only you, your friends, everyone in {APP_WORDMARK}, or the people you send its link to. You can change that or delete the post.</li>
          <li>You choose in Privacy and sharing which parts of your tracking friends or others may see, and whether people who are not your friends can find you.</li>
          <li>A food you mark as public can be found and copied by other members, without your name.</li>
          <li><strong>A page</strong> is public: its profile and public posts can be seen by every member. Other members are not shown who manages a page; we know, and our reviewer can see it. A message you send to a page is read by whoever manages it.</li>
          <li><strong>Our reviewer</strong> can see a post that was reported or that the automatic check flagged, whatever audience you chose, to decide whether it breaks the <Link href="/rules">Community Rules</Link>. Nobody on our side reads your records or messages otherwise.</li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Other companies that handle your data for us">
        <p>They act on our instructions and only for the purpose named.</p>
        <ul>
          <li><strong>MongoDB Atlas</strong>: the database where your records are kept.</li>
          <li><strong>Render</strong> and <strong>Vercel</strong>: the servers that run the app.</li>
          <li><strong>Cloudflare (R2)</strong>: storage for photos and videos. Files are private; each view uses a link that expires.</li>
          <li><strong>Resend</strong>: delivers the emails about your account, so it receives your email address and the message.</li>
          <li><strong>OpenAI</strong>: checks photos and video stills that <em>other people can see</em>, and profile photos, for nudity, graphic violence and self-harm before they are shown. It receives an expiring link to the picture and nothing else: not your name, your account or your text. A private post is never sent.</li>
          <li><strong>Google</strong>: only if you choose to sign in with Google.</li>
          <li><strong>Apple and Google push services</strong>: only if you allow notifications, to deliver them to your device.</li>
          <li><strong>Open Food Facts</strong>: when you scan a barcode, the barcode is looked up there. Nothing about you is sent.</li>
        </ul>
        <p>
          Some of these companies store or process data in the European Union and the United States. Where data leaves
          your country, it does so under the safeguards the law requires, such as standard contractual clauses.
        </p>
        <p>
          If you connect an AI assistant or another app to your account, it reads what you allow it to. That is your
          choice, you can end it in the app, and its provider’s own privacy policy applies to what it does with it.
        </p>
        <p>
          If you also let an assistant manage your pages, it reads what a page can see (public posts, the comments on
          them, profiles, and messages sent to the page) and acts as the page. We keep a list of what it did as each
          page (the time, the kind of action and what it was done to, never the text), which the page’s managers can
          read; it is kept for 90 days and deleted with the page. What an assistant asks to be done later (a post or a comment and its
          time) is kept until it is done and for a week after.
        </p>
      </LegalSection>

      <LegalSection title="6. What we never do">
        <ul>
          <li>We do not sell or rent your data.</li>
          <li>We do not show advertising based on your health information, and we do not let anyone target you by it.</li>
          <li>We do not use what you log to train AI models.</li>
        </ul>
      </LegalSection>

      <LegalSection title="7. How long we keep it">
        <ul>
          <li>Your records stay until you delete them or your account.</li>
          <li><strong>Deleting your account deletes everything at once:</strong> your records, posts, photos, comments, likes and messages, including conversations you were in. We keep no copy and there is no waiting period.</li>
          <li>What other people already saved from your posts (a food, an exercise, a plan) stays with them, without your name.</li>
          <li>Backups made by our database provider expire on its schedule, within weeks.</li>
          <li>Sign-in records are kept 90 days.</li>
        </ul>
      </LegalSection>

      <LegalSection title="8. Your rights">
        <ul>
          <li><strong>See and take your data:</strong> Menu → Your data and account → Download your data gives you everything as one file.</li>
          <li><strong>Correct it:</strong> edit it in the app.</li>
          <li><strong>Delete it:</strong> delete single records in the app, or the whole account on the same page.</li>
          <li><strong>Withdraw consent or object:</strong> stop sharing in Privacy and sharing, switch off notifications, disconnect an assistant, or delete your account.</li>
          <li>For anything the app does not let you do yourself, write to <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>. We answer within a month.</li>
          <li>You may complain to the data protection authority where you live. Ours is the Personal Data Protection Service of Georgia.</li>
        </ul>
      </LegalSection>

      <LegalSection title="9. Children">
        <p>
          {APP_WORDMARK} is for people aged 16 and over. If you believe a younger person has an account, tell us and we
          will delete it.
        </p>
      </LegalSection>

      <LegalSection title="10. Security">
        <p>
          Connections are encrypted, passwords are stored only in scrambled form, every request is checked against a
          live sign-in, and you can see and sign out your devices in Sign-in &amp; security. No service is perfectly
          safe: use a password you use nowhere else, and tell us at once if you think your account was used by someone
          else.
        </p>
      </LegalSection>

      <LegalSection title="11. Changes">
        <p>
          When this policy changes in a way that matters, we say so in the app or by email before it takes effect, and
          the date at the top changes.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
