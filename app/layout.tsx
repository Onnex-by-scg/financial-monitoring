import type { Metadata } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import "./globals.css";

// ONNEX CI typography: Lufga for English, Noto Sans Thai for Thai.
// Lufga is a commercial typeface (not on Google Fonts): the font stack in globals.css uses it when installed on the
// viewer's machine; to embed it for everyone, add the licensed files with next/font/local. Noto Sans Thai is
// self-hosted by Next.js and also covers Latin text when Lufga isn't available.
const notoThai = Noto_Sans_Thai({
  variable: "--font-noto-thai",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "AR · ESCO — Financial Monitoring · ONNEX by SCG",
  description: "Accounts receivable aging dashboard on PEAK and NetSuite",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className={`${notoThai.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
