# Feature Specification: Leave and take your data

**Feature Branch**: `038-account-deletion`

**Created**: 2026-11-22

**Status**: Built

**Input**: Owner: "Please go ahead and take care of account deletion and data export … we still want to remove the invite code." Once registration is open to anyone, a person must be able to leave and to take their data; the app holds health data, a special category under GDPR.

## User Scenarios & Testing

### User Story 1 - Download everything (Priority: P1)

A person opens Menu → Your data and account, taps **Prepare my data**, then **Save the file**. They get one JSON file with every record the app holds about them and links to their photos and videos.

**Acceptance Scenarios**:

1. **Given** an account with food, training, posts and messages, **When** it exports, **Then** the file holds those records as stored, and none of another person's records (messages received, other people's comments).
2. **Given** any export, **Then** it contains no password hash, session, token, private link key or storage location.
3. **Given** an account with photos, **Then** the file lists each as a link that works for about an hour.

### User Story 2 - Delete the account (Priority: P1)

The same page has **Delete my account**. It says what goes and what stays, asks for the password (or, for an account that signs in with Google and has no password, the email address typed out), and then deletes everything at once and signs the device out.

**Acceptance Scenarios**:

1. **Given** the wrong password or email, **Then** nothing is deleted.
2. **Given** the right one, **Then** every record the account owns is gone, its files are gone from storage, and the address can register again as a new, empty account.
3. **Given** other people liked, commented on, reposted or reported the account's posts, **Then** those rows are gone too, and other people's own records are untouched.
4. **Given** a conversation with the account, **Then** it disappears for the other person as well.
5. **Given** someone saved a food, exercise or plan from the account's post, **Then** their copy stays and no longer shows the account's name.
6. **Given** a file cannot be deleted from storage, **Then** nothing is deleted and the person is asked to try again.
7. **Given** the developer account, **Then** deletion is refused: it runs the app.

### Edge Cases

- A crash halfway: the account row is deleted last, so the person can sign in and run it again.
- Sessions, assistant tokens and Shortcut tokens are deleted before the data, so nothing can write as the account while it goes.
- Unsent offline changes on the device are discarded with the account.

## Requirements

- **FR-001**: `GET /account/export` returns `AccountExport` for the signed-in account only, `no-store`, at most 6 an hour.
- **FR-002**: `POST /account/delete` needs the password, or the typed email when there is none; at most 5 attempts an hour.
- **FR-003**: Every collection the API declares is classified as owned, custom or kept in `ACCOUNT_PLAN`; a test fails when one is missing.
- **FR-004**: Deletion removes files, then credentials, then what others hold of the account, then what it owns, then the account.
- **FR-005**: A confirmation email is sent to the deleted address when email is configured.
- **FR-006**: Nothing about the deleted account is kept: no tombstone, no grace period, no backup copy made by the app.

## Out of scope

- A grace period with undo. Deleting is immediate; the email is how an unwanted deletion is noticed.
- Exporting as anything but JSON, and bundling the media files themselves into the download.
- Deleting from database backups held by the hosting provider (they expire on the provider's schedule).
