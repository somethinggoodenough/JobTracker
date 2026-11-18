import type { Metadata } from "next";
import { LanguageProvider } from "./language-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "求职雷达 · Job Radar",
  description: "每小时聚合、去重并保留最近 7 天职位信息。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased"><LanguageProvider>{children}</LanguageProvider></body>
    </html>
  );
}
