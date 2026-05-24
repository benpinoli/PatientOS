import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Choice Healthcare Tracker",
  description: "Patient pipeline tracker for custom power wheelchair approvals.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
