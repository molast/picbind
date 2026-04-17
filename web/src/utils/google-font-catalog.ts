"use client";

export type FontVariant = {
  id: string;
  label: string;
  weight: number;
  style: "normal" | "italic";
};

export type GoogleFontOption = {
  key: string;
  label: string;
  family: string;
  variants: FontVariant[];
  variantUrls: Record<string, string>;
};

type GoogleFontsCompleteVariant = {
  local?: string[];
  url?: {
    woff2?: string;
    woff?: string;
    ttf?: string;
    eot?: string;
    svg?: string;
  };
};

type GoogleFontsCompleteEntry = {
  variants?: Record<string, Record<string, GoogleFontsCompleteVariant>>;
};

const WEIGHT_NAME: Record<number, string> = {
  100: "Thin",
  200: "Extra Light",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semi Bold",
  700: "Bold",
  800: "Extra Bold",
  900: "Black",
};

function fontKeyFromFamily(family: string): string {
  return family.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function toVariantLabel(weight: number, style: "normal" | "italic") {
  const weightText = WEIGHT_NAME[weight] ?? "Weight";
  const styleText = style === "italic" ? "Italic" : "Normal";
  return `${weightText} ${weight} ${styleText}`;
}

function parseGoogleFontCatalog(raw: Record<string, GoogleFontsCompleteEntry>) {
  const options: GoogleFontOption[] = [];

  for (const [family, entry] of Object.entries(raw)) {
    if (!entry?.variants) {
      continue;
    }

    const variants: FontVariant[] = [];
    const variantUrls: Record<string, string> = {};

    const styles = Object.keys(entry.variants)
      .filter((key) => key === "normal" || key === "italic")
      .sort((left, right) => {
        if (left === right) return 0;
        if (left === "normal") return -1;
        return 1;
      }) as Array<"normal" | "italic">;

    for (const style of styles) {
      const byWeight = entry.variants[style] ?? {};
      const sortedWeights = Object.keys(byWeight)
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b);

      for (const weight of sortedWeights) {
        const data = byWeight[String(weight)];
        const url = data?.url?.woff2 || data?.url?.woff;
        if (!url) {
          continue;
        }

        const id = `${weight}-${style}`;
        variants.push({
          id,
          label: toVariantLabel(weight, style),
          weight,
          style,
        });
        variantUrls[id] = url;
      }
    }

    if (!variants.length) {
      continue;
    }

    options.push({
      key: fontKeyFromFamily(family),
      label: family,
      family,
      variants,
      variantUrls,
    });
  }

  return options.sort((left, right) => left.label.localeCompare(right.label));
}

let optionsPromise: Promise<GoogleFontOption[]> | null = null;

export async function loadGoogleFontOptions(): Promise<GoogleFontOption[]> {
  if (!optionsPromise) {
    optionsPromise = import("google-fonts-complete").then((module: any) => {
      const raw = (module?.default ?? module) as Record<
        string,
        GoogleFontsCompleteEntry
      >;
      return parseGoogleFontCatalog(raw);
    });
  }
  return optionsPromise;
}

export async function ensureGoogleFontVariantLoaded(
  option: GoogleFontOption,
  variant: FontVariant,
) {
  if (typeof document === "undefined") {
    return;
  }

  const url = option.variantUrls[variant.id];
  if (!url) {
    return;
  }

  const styleId = `gfc-face-${option.key}-${variant.id}`.replace(
    /[^a-z0-9-]/g,
    "-",
  );

  if (!document.getElementById(styleId)) {
    const styleTag = document.createElement("style");
    styleTag.id = styleId;
    styleTag.textContent = `@font-face{font-family:"${option.family}";font-style:${variant.style};font-weight:${variant.weight};font-display:swap;src:url("${url}") format("woff2");}`;
    document.head.appendChild(styleTag);
  }

  if (document.fonts) {
    await document.fonts.load(
      `${variant.style} ${variant.weight} 32px "${option.family}"`,
    );
  }
}

