import type { AuthCapabilities } from '@life-portal/shared-types';
import { request } from './api';

/** What this server can do by email (#27) and with Google (#28). Nothing is offered when it can't say. */
export async function authCapabilities(): Promise<AuthCapabilities> {
  try {
    return await request<AuthCapabilities>('/auth/capabilities', { anonymous: true });
  } catch {
    return { passwordReset: false, emailVerification: false, google: false };
  }
}
