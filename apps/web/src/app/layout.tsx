import './global.css';
import type { ReactNode } from 'react';
import { AuthProvider } from '../lib/auth-context';

export const metadata = {
  title: 'Life Portal',
  description: 'Debts, cash flow, assets, work and plans in one place.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
