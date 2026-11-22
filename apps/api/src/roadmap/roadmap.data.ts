import type { Roadmap } from '@life-portal/shared-types';

/**
 * The roadmap shown to the admin in the app. `docs/ROADMAP.md` is the text of record: change
 * both together. Kept in the API, not the web bundle, because it holds plans and the business
 * model, which are the owner's and not for every visitor's browser.
 */
export const ROADMAP: Roadmap = {
  updated: '2026-11-22',
  direction:
    'A private-by-default life dashboard that grows into a Strava-like social app for food, training and sports, where calories eaten and burned live on the same day. The core stays free; AI is the paid part.',
  areas: [
    { name: 'Money', items: ['Loans with payoff scenarios', 'Free-money cash flow', 'Items to sell', 'Shares and the ESPP plan', 'Spending from bank messages', 'Multi-currency with daily rates'] },
    { name: 'Work and life', items: ['EPAM boards', 'Side projects', 'Personal plans'] },
    { name: 'Food', items: ['Nutrition tracking and targets', 'Apple Health sync', 'AI assistant connectors', 'Brands with logos and filters', 'Several foods logged at once', 'Suggestions from recent meals'] },
    { name: 'Training', items: ['Exercise catalogue and logging', 'Ready-made and own plans', 'Workout flow: rest, supersets', 'Levels', 'Built, off: ranks, tournaments, sharing'] },
    { name: 'Social', items: ['Friends and shared widgets', 'Posts: text, photos, video, food, training', 'Likes, comments, reposts, Share', 'Home feed', 'Link-only posts', 'Direct messages'] },
    { name: 'Offline', items: ['Training, food and social work with no connection', 'Conflicts shown, never merged silently', 'Sync health for the admin'] },
    { name: 'Look and feel', items: ['Colour themes as data (v0, Crisp)', 'Glass surfaces', 'Tab bar that shrinks on scroll', 'Resizable Home widgets'] },
    { name: 'Platform', items: ['Onboarding and setup', 'Feature flags per group and person', 'Installable app with push', 'Checks run on every push'] },
  ],
  steps: [
    { title: 'Photos in posts', status: 'done', summary: 'Photos, 30-second camera video and text-only posts.' },
    {
      title: 'Safety net',
      status: 'built',
      summary: 'Built. One step is yours: email is not set up in production, so password reset is off there.',
      points: [
        'Done: password reset, email verification, sign-in rate limits, security log, Continue with Google',
        'Done: an error log for you, from the server and from people’s pages',
        'Yours: a Resend account, a verified sending domain and three settings on the API host',
        'Do this before removing the invite code',
      ],
    },
    {
      title: 'Switch on what is built',
      status: 'next',
      summary: 'Finished features that are still off for everyone but you.',
      points: ['Strength ranks', 'Monthly tournaments', 'Training sharing and copying', 'The Crisp theme', 'Link-only posts', 'Each: a check on a real device, then on for friends, then for everyone'],
    },
    {
      title: 'Your portal',
      status: 'next',
      summary: 'Make "portal" a real thing: a person’s profile becomes their portal, showing their widgets and modules to others as far as they choose.',
      points: [
        'One page for a life: food and training today, more later',
        'The person decides per module: private, friends or public; private stays the default',
        'Sharing by module already exists; this makes it the centre of the profile and names it',
        'Money is the person’s choice too, later, with a plain warning',
        'What a portal says is what its owner entered: nothing is shown as checked unless it was',
        '"Profile" becomes "Portal" everywhere, with an address a person can send',
      ],
    },
    {
      title: 'Pages',
      status: 'next',
      summary: 'An account that is not a person: managed by people, publishing content and nothing else.',
      points: [
        'Content only: no food, workout or weight logging; out of ranks, tournaments and friend suggestions',
        'The app’s own pages first (kitchen, training, challenges), so a new person never lands on an empty feed',
        'A page can be marked as AI-managed; on such a page, what a human did is marked as human',
        'Never fake people: no invented meals or records, no pages talking to each other to look like a crowd',
        'Later: restaurants, gyms, brands and coaches',
      ],
    },
    {
      title: 'Assistant tools for pages, training and challenges',
      status: 'next',
      summary: 'The connector handles food only; this lets an assistant run a page.',
      points: ['Act as a page: read feeds, post, comment, react', 'The same for training, then challenges', 'A tool acts as one named page, never as the person behind it', 'A scheduled job drafts posts; you approve them at first'],
    },
    {
      title: 'AI meal guess from a photo',
      status: 'next',
      summary: 'The main paid feature: a photo becomes a labelled estimate you confirm.',
      points: ['Behind a switch until there are API keys', 'Every guess is marked as an estimate with its basis'],
    },
    {
      title: 'Groups and challenges',
      status: 'later',
      summary: 'Streaks and targets among friends; a challenge sees a score, never the diary.',
      points: ['Protein-target days, logging streaks, staying within calories', 'Group chat reuses messages'],
    },
    {
      title: 'Plans',
      status: 'later',
      summary: 'A diet plan, a workout plan or both, with the creator’s notes, that others can copy.',
      points: ['Published by a person or a page', 'Free first; paid plans arrive with payments'],
    },
    {
      title: 'Explore and search built around food',
      status: 'partial',
      summary: 'Find posts by what is in them: "600 kcal dinners, 40g+ protein".',
      points: ['The first six diet tags exist', 'Search itself is not started', 'Image moderation must exist before public images'],
    },
    {
      title: 'Payments, promoted posts and paid plans',
      status: 'later',
      summary: 'Pay to promote a post, or give several posts a budget and let the system place it.',
      points: ['Needs payments, a "Sponsored" label and review of what is promoted', 'Can be built before launch and switched on when there are enough people', 'May not target on health data (see the open decisions)'],
    },
    {
      title: 'Training and sports, the rest',
      status: 'built',
      summary: 'Most of training is built; some of it is still off.',
      points: ['Done: logging, plans, the workout flow, levels', 'Built, off: ranks, tournaments, sharing', 'To come: friend leaderboards; GPS needs the native app'],
    },
    { title: 'Video through a service', status: 'later', summary: 'Every clip plays everywhere; library videos and 60 seconds.' },
    { title: 'Native apps', status: 'later', summary: 'The web app wrapped for the stores, with HealthKit and background GPS.' },
  ],
  gaps: [
    { title: 'Account deletion and data export', detail: 'Health data is a special category under GDPR.' },
    { title: 'Automatic end-to-end tests', detail: 'The real app is only booted against a database by hand.' },
    { title: 'Real-device checks', detail: 'Push, messages and swiping on an iPhone.' },
    { title: 'Free hosting limits', detail: '512 MB database; the web host’s free plan does not allow commercial use.' },
    { title: 'Image moderation', detail: 'Before public photos reach strangers. For You stays off until then.' },
    { title: 'Video plays only where its codec does', detail: 'No transcoding yet.' },
    { title: 'Money modules are built for one person', detail: 'Decide whether they stay yours or become a product.' },
    { title: 'Brand logos', detail: 'Other companies’ trademarks: check their use before the app is commercial.' },
  ],
  decisions: [
    { question: 'Should a shared link open without an account?', detail: 'Today every post needs sign-in. A public page makes sharing useful to people who have not joined, and is a deliberate privacy step.' },
    { question: 'AI meal photos or more polish first?', detail: 'It is the main paid feature and has not been started.' },
    { question: 'Money modules: yours for good, or a product?', detail: 'They are seeded for one person today.' },
    { question: 'When does the invite code go?', detail: 'It is one setting on the API host. Before removing it: email set up, account deletion, and a view on moderation, since strangers can then post.' },
    { question: 'Where does the AI mark show?', detail: 'On the page only, or beside the page’s name everywhere it appears. Most people meet a post in the feed and never open the page.' },
    { question: 'What may a promoted post target?', detail: 'Ads targeted on health data are ruled out, and here almost everything a person does is health data.' },
  ],
  business: [
    { title: 'Plus subscription', detail: 'About $4–8 a month: AI photo logging, an AI coach, deeper trends, longer video.' },
    { title: 'Company wellness', detail: 'Per-seat team challenges.' },
    { title: 'Sponsored challenges', detail: 'From gyms, brands and ski resorts, labelled as sponsored.' },
    { title: 'Verified restaurant menus', detail: 'Restaurants pay to list dishes with checked nutrition.' },
    { title: 'Promoted posts', detail: 'Anyone pays to put a post in front of more people.' },
    { title: 'Coach marketplace, later', detail: 'Paid plans, 10–20% commission.' },
  ],
  ruledOut: 'Ads targeted on health data, and selling data.',
};
