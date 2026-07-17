import Link from "next/link";
import type { HomeCompressLandingCopy, Lang } from "@/locales";

type HomeFooterProps = {
  copy: HomeCompressLandingCopy;
  lang: Lang;
};

export default function HomeFooter({ copy }: HomeFooterProps) {
  return (
    <footer className="bg-[#171923] text-white">
      <div className="mx-auto max-w-[1280px] px-6 py-14 sm:px-8 lg:px-10 lg:py-16">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)] lg:gap-16">
            <div className="max-w-[360px]">
              <Link
                href="/"
                className="inline-flex items-center text-[28px] font-semibold tracking-[-0.03em] text-white"
              >
                {copy.footer.brandTitle}
              </Link>
              <p className="mt-4 text-[16px] leading-8 text-slate-400">
                {copy.footer.brandDesc}
              </p>
              <a
                href="mailto:loomchen@gmail.com"
                className="mt-7 inline-flex items-center rounded-[18px] border border-white/12 bg-white/6 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:border-[#4dc0d9]/60 hover:bg-white/10 hover:text-white"
              >
                {copy.footer.contactSupport}
              </a>
            </div>

            <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
              {copy.footer.groups.map((group) => (
                <div key={group.title}>
                  <h3 className="text-[13px] font-semibold uppercase tracking-[0.16em] text-white">
                    {group.title}
                  </h3>
                  <div className="mt-5 flex flex-col gap-4">
                    {group.links.map((link) => {
                      const externalNavigation =
                        link.href.startsWith("mailto:") ||
                        link.href.startsWith("#");
                      const className =
                        "text-[16px] font-medium text-slate-400 transition hover:text-white";

                      return externalNavigation ? (
                        <a key={link.href} href={link.href} className={className}>
                          {link.label}
                        </a>
                      ) : (
                        <Link key={link.href} href={link.href} className={className}>
                          {link.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
      </div>
    </footer>
  );
}
