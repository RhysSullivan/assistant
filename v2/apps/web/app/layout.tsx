import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Sans } from "next/font/google";
import type { ReactNode } from "react";

import { Providers } from "./providers";
import "./globals.css";

const bodyFont = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600"],
});

const displayFont = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "700"],
});

export const metadata: Metadata = {
  title: "Executor v2 Control Plane",
  description: "Basic Next.js frontend for Executor v2 control plane",
};

type RootLayoutProps = {
  children: ReactNode;
};

const RootLayout = ({ children }: RootLayoutProps) => (
  <html lang="en" className={`${bodyFont.variable} ${displayFont.variable}`}>
    <body>
      <Providers>{children}</Providers>
    </body>
  </html>
);

export default RootLayout;
