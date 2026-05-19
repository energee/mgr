import type { Metadata } from "next";
import { DM_Sans, DM_Mono } from "next/font/google";
import { Providers } from "@/app/providers";
import "./globals.css";

// DM Sans: Modern, warm geometric sans-serif with excellent readability
// More character than Inter while remaining highly professional
const dmSans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// DM Mono: Matching monospace for code, data, batch numbers
const dmMono = DM_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: "MGR - Brewery Management",
    template: "%s | MGR",
  },
  description: "Professional brewery management system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${dmSans.variable} ${dmMono.variable} font-sans antialiased`}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-4 focus:left-4 focus:px-4 focus:py-2 focus:bg-background focus:text-foreground focus:rounded-md focus:border focus:border-border focus:shadow-sm"
        >
          Skip to main content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
