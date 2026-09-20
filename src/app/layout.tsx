import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { AppNavbar } from "@/components/layout/AppNavbar";
import { AuthGuard } from "@/components/layout/AuthGuard";

const ibmArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-ibm-arabic",
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "There DMC — منصة إدارة الوجهات السياحية",
  description: "أداة بناء رحلات ومحرك استكشاف مزودين مدعوم بالذكاء الاصطناعي لشركات إدارة الوجهات السياحية السعودية",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${ibmArabic.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col font-sans bg-slate-50 text-slate-900" suppressHydrationWarning>
        <AuthGuard>
          <AppNavbar />
          {children}
        </AuthGuard>
      </body>
    </html>
  );
}
