import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { FinOpsProvider } from "@/components/finops-provider";
import { ThemeProvider } from "@/components/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Nexora — Financial Operations",
  description: "Financial operations and compliance — payroll, statutory filing, reconciliation and reporting.",
  icons: {
    icon: [
      { url: "/nexora-mark-64.png", sizes: "64x64", type: "image/png" },
      { url: "/nexora-mark.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col antialiased" suppressHydrationWarning>
        <FinOpsProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </FinOpsProvider>
      </body>
    </html>
  );
}
