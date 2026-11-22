/**
 * Leaving and taking your data (spec 038). The export is everything the account owns, as the
 * stored records; deleting removes the account and all of it.
 */
export interface AccountExport {
  /** Bumped when the shape of this file changes. */
  version: 1;
  exportedAt: string;
  account: { id: string; email: string; name: string; createdAt?: string };
  /** One list per kind of record, named after where it is stored. Empty kinds are left out. */
  data: Record<string, Record<string, unknown>[]>;
  /** Your photos and videos, as links that work for about an hour. */
  files: { url: string; kind: 'image' | 'video' }[];
  /** Plain sentences about what the file holds and leaves out. */
  notes: string[];
}

export interface DeleteAccountRequest {
  /** Required when the account has a password. */
  password?: string;
  /** Required when it has none (Google sign-in): the account's email address, typed out. */
  confirmEmail?: string;
}

/** Error codes `POST /account/delete` answers with. */
export const ACCOUNT_DELETE_CODES = ['WRONG_PASSWORD', 'CONFIRM_EMAIL', 'DEVELOPER_ACCOUNT', 'FILES_NOT_DELETED'] as const;
export type AccountDeleteCode = (typeof ACCOUNT_DELETE_CODES)[number];

/**
 * The date of the terms, privacy policy and community rules a new account agrees to. Change it
 * whenever one of them changes in substance; it is stored on the account as `agreedVersion`.
 */
export const LEGAL_VERSION = '2026-11-23';
