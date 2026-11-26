# Spec 045: Pages, the next part

Asked by the owner on 2026-11-26, after reviewing the roadmap's Pages item. Six slices, each
shipped on its own.

## 1. "By a person" (closes spec 040 T032b)

On a page run with AI, what a person writes through the app is marked **By a person**: a post, a
comment or reply, a message. What the page's assistant writes carries no mark, and reactions
(likes, reposts, follows) never do. The mark is stored when the thing is created (`byPerson` on
`food_posts`, `post_comments`, `messages`), so it never changes later when the page's AI setting
does. "Through the app" means a request made while acting as the page (`actorId` differs from
`userId`); the assistant calls the services directly.

## 2. Pages in Search

Home's "Pages to follow" card disappears once someone follows five pages. Search, before
anything is typed, lists pages to follow for good: official first, then the most followed, with
Follow buttons, never pages already followed or managed, suspended, switched off or blocked.

## 3. Notifications for a page's managers

- A person's own notifications always arrive, whichever identity the app is using.
- A page's notifications arrive by default too. Each manager can choose, per page: **always**, or
  **only while using the app as this page**. The device tells the server which identity it is
  using (on start and on every switch), so the server knows which devices count as "using it".
- Tapping one of your own notifications while acting as a page switches back to you.

## 4. Insights

For a page's managers: followers (now, and new follows per day over 28 days), and per post views,
likes, comments, reposts and saves. A **view** is a person seeing the post (on screen for a
moment, or opened), counted once per person per post per day, without storing who: a keyed hash
of account, post and day that expires in two days, and a daily count per post. Views are counted
for page posts only; views on people's posts are the separate roadmap item. The assistant reads
insights with a tool.

## 5. A pinned post

A page's managers pin one of its posts; it shows first on the page's profile with a "Pinned"
label. Unpinning, deleting the post or pinning another replaces it. The assistant can pin.

## 6. Co-managers

A manager invites a person (not a page) by username; the person accepts or declines in Menu.
Every manager can post as the page and invite. The page's creator can remove a manager; anyone
can leave, except the last manager, who deletes the page instead. A page is suspended only when
none of its managers can act (all of them suspended), and is restored when one is. Suspending a
person otherwise leaves their pages alone: a page is its own account.
