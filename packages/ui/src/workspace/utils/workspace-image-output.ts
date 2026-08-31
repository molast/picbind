import { appendFileNameSuffix } from "../../utils/image-object";

const OUTPUT_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/avif": "avif",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/jxl": "jxl",
  "image/png": "png",
  "image/webp": "webp",
};

function normalizedMimeType(mimeType: string) {
  return mimeType.split(";", 1)[0].trim().toLowerCase();
}

export function workspaceMaterializeQuality(mimeType: string) {
  switch (normalizedMimeType(mimeType)) {
    case "image/png":
    case "image/jxl":
      return 100;
    case "image/avif":
      return 58;
    case "image/jpeg":
    case "image/jpg":
    case "image/webp":
    default:
      return 82;
  }
}

export function workspaceEditedImageName(name: string, mimeType: string) {
  const extension = OUTPUT_EXTENSION_BY_MIME_TYPE[normalizedMimeType(mimeType)]
    || name.split(".").pop()?.toLowerCase()
    || "image";
  return appendFileNameSuffix(name, "edited", extension);
}
