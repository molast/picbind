import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "NanoImg-Compress WebP,PNG and JPEG images intelligently | nano.molast.com",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
