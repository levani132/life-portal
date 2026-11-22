import type { Metadata } from 'next';
import { LegalPage, LegalSection } from '../../components/legal-page';
import { APP_WORDMARK, SUPPORT_EMAIL } from '../../lib/brand';

export const metadata: Metadata = { title: `Community rules · ${APP_WORDMARK}` };

export default function RulesPage() {
  return (
    <LegalPage
      title="Community rules"
      lead={`${APP_WORDMARK} is where people show how they really eat and train. These rules keep it a place where that feels safe. They apply to posts, photos, video, comments, messages, names and profile photos.`}
    >
      <LegalSection title="What belongs here">
        <ul>
          <li>Your own meals, workouts, progress and plans, as they are.</li>
          <li>Honest numbers. Nobody here is checking, which is the point.</li>
          <li>Encouragement, questions and useful disagreement.</li>
        </ul>
      </LegalSection>

      <LegalSection title="What is not allowed">
        <ul>
          <li><strong>Anything that sexualises or endangers a child.</strong> It is removed, the account is closed, and it is reported to the authorities.</li>
          <li><strong>Nudity and sexual content.</strong> Ordinary gym, sport and progress photos are fine.</li>
          <li><strong>Violence, gore and cruelty</strong>, and threats against anyone.</li>
          <li><strong>Harassment and hate:</strong> attacking a person or a group for who they are, mocking someone’s body, weight or food, or following someone around the app after they asked you to stop.</li>
          <li><strong>Encouraging self-harm or disordered eating:</strong> starvation targets, purging, “thinspiration”, or pushing someone to eat or train in a way that puts them in danger.</li>
          <li><strong>Dangerous advice presented as fact:</strong> for example drug or steroid protocols, extreme dehydration, or telling someone to stop a medical treatment.</li>
          <li><strong>Other people’s private information</strong> or photos of them without their agreement.</li>
          <li><strong>Spam and deception:</strong> fake accounts, pretending to be someone else, invented results presented as real, undisclosed advertising, and selling anything illegal.</li>
          <li><strong>A page that hides what it is:</strong> a page presented as a real person, or a page run with AI without its “run with AI” mark. Pages follow every rule here, and their managers answer for them.</li>
          <li><strong>Anything illegal</strong> where you live or in Georgia.</li>
        </ul>
      </LegalSection>

      <LegalSection title="If you see something wrong">
        <ul>
          <li>Open the post’s menu and choose <strong>Report</strong>, and say what is wrong. The post disappears for you straight away.</li>
          <li>You can block anyone from their profile. They are not told.</li>
          <li>If someone is in immediate danger, contact the emergency services where you are first.</li>
        </ul>
      </LegalSection>

      <LegalSection title="What happens next">
        <ul>
          <li>Photos and video stills that other people can see are checked automatically before they appear. One that does not pass stays hidden until a person has looked at it.</li>
          <li>A post that several people report, or that is reported as putting a child at risk, is hidden until a person has looked at it.</li>
          <li>We then keep it or remove it. For serious or repeated breaches we suspend or close the account.</li>
          <li>While a post is hidden, only its author sees it, with a note.</li>
        </ul>
      </LegalSection>

      <LegalSection title="If you think we got it wrong">
        <p>
          Write to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> from the address of your account and say
          which post or decision you mean. A person reads every message.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
