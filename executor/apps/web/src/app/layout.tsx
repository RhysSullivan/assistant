import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Toaster } from "@/components/ui/sonner";
import { AppConvexProvider } from "@/lib/convex-provider";
import { QueryProvider } from "@/lib/query-provider";
import { SessionProvider } from "@/lib/session-context";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import { runtimeConfigFromEnv } from "@/lib/runtime-config";
import "./globals.css";

export const metadata: Metadata = {
  title: "Executor Console",
  description: "Approval-first runtime console for AI-generated code execution",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const runtimeConfig = JSON.stringify(runtimeConfigFromEnv());

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__EXECUTOR_RUNTIME_CONFIG__ = ${runtimeConfig};`,
          }}
        />
        <NuqsAdapter>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            enableColorScheme
          >
            <AppErrorBoundary>
              <QueryProvider>
                <AppConvexProvider>
                  <SessionProvider>{children}</SessionProvider>
                </AppConvexProvider>
              </QueryProvider>
            </AppErrorBoundary>
            <Toaster position="bottom-right" />
          </ThemeProvider>
        </NuqsAdapter>
      </body>
    </html>
  );
}
