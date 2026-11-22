/**
 * The app's name, in one place. Everything that says the name to a person reads it from here, so
 * a rename (or a different name for one market) is this file, not a search through the code.
 *
 * Two things deliberately do not use it, because they are names of things outside the app that
 * must keep matching: the iOS Shortcut ("Life Portal Health"), which people have installed under
 * that name, and anything already sent or stored.
 */

/** The name as written in a sentence. */
export const APP_NAME = 'Life Portal';

/** The name as the wordmark writes it: one word. */
export const APP_WORDMARK = 'LifePortal';

/**
 * Who runs the app, as the terms and the privacy policy name them. Until a company is
 * registered this is the app's own name; replace it with the legal name (and add the address to
 * `LEGAL_ADDRESS`) before registration is opened: the law asks a privacy policy to say who is
 * responsible for the data.
 */
export const LEGAL_OPERATOR = 'LifePortal';
export const LEGAL_ADDRESS = 'Tbilisi, Georgia';
export const SUPPORT_EMAIL = 'support@lifeportal.one';
export const PRIVACY_EMAIL = 'privacy@lifeportal.one';
