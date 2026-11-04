import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { macroLine } from '@life-portal/shared-domain';
import { fetchPublicPreview } from '../../../lib/public-preview';

const GENERIC = {
  title: 'A post on Life Portal',
  description: 'Food, training and the numbers behind them. Sign in to see this post.',
};

/**
 * Link previews (spec 017). Only a public post gets its title, author and macros; anything else
 * gets the same generic text, so a preview never reveals that a private post exists.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const preview = await fetchPublicPreview(id);
  const title = preview
    ? `${preview.title || 'A post'} · ${preview.authorName} on Life Portal`
    : GENERIC.title;
  const description = preview
    ? [macroLine(preview.macros), preview.caption].filter(Boolean).join(' — ') ||
      `Shared by ${preview.authorName} on Life Portal.`
    : GENERIC.description;
  return {
    title,
    description,
    openGraph: { title, description, type: 'article', siteName: 'Life Portal' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default function PostLayout({ children }: { children: ReactNode }) {
  return children;
}
