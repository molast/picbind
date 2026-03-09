import { initWasm } from "@/utils/wasm-runtime";

type ZipItem = {
  name: string;
  blob: Blob;
};

export default class SystemManager {
  static mergeData = (target: any, source: any) => {
    Object.keys(source).forEach(function (key) {
      if (source[key] && typeof source[key] === "object") {
        SystemManager.mergeData((target[key] = target[key] || {}), source[key]);
        return;
      }
      target[key] = source[key];
    });
  };

  static containsChinese(str: string) {
    const reg = /[\u4E00-\u9FA5]/g;
    return reg.test(str);
  }

  static getNowformatTime = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return year + month + day + hours + minutes + seconds;
  };

  static formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = ("0" + (date.getMonth() + 1)).slice(-2);
    const day = ("0" + date.getDate()).slice(-2);
    const hours = ("0" + date.getHours()).slice(-2);
    const minutes = ("0" + date.getMinutes()).slice(-2);
    return year + "/" + month + "/" + day + " " + hours + ":" + minutes;
  };

  static copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_error) {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand("copy");
      } catch (_error2) {
        console.log("copy text failed!");
      }
      document.body.removeChild(textArea);
    }
  };

  static downloadImage = async (url: string, name?: string) => {
    const file = await fetch(url).then((response) => response.blob());
    const currentTime = SystemManager.getNowformatTime();
    const metaType = file?.type.split("/")[1] || url.split(".")[1];
    const resultName = name || `result-${currentTime}.${metaType.split("+")[0]}`;
    const localUrl = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = localUrl;
    link.download = resultName;
    link.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      }),
    );

    setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(localUrl);
    }, 300);
  };

  static downloadZip = async (items: Array<{ name: string; url: string }>, zipName?: string) => {
    const validItems = items.filter((item) => item.url);
    if (!validItems.length) return;

    try {
      const blobs = await Promise.all(
        validItems.map(async (item) => ({
          name: item.name,
          blob: await fetch(item.url).then((response) => response.blob()),
        })),
      );

      const zipBlob = await SystemManager.createZipBlob(blobs);
      const link = document.createElement("a");
      const objectUrl = URL.createObjectURL(zipBlob);
      link.href = objectUrl;
      link.download = zipName || `nanoimg-${SystemManager.getNowformatTime()}.zip`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 300);
    } catch (error) {
      console.error("ZIP download failed:", error);
    }
  };

  private static async createZipBlob(items: ZipItem[]) {
    const mod = await initWasm();
    if (!mod || typeof mod.create_zip_from_items !== "function") {
      throw new Error("WASM module does not expose create_zip_from_items");
    }

    const payload = await Promise.all(
      items.map(async (item) => ({
        name: item.name,
        bytes: new Uint8Array(await item.blob.arrayBuffer()),
      })),
    );
    try {
      const zipBytes = mod.create_zip_from_items(payload) as Uint8Array | ArrayLike<number>;
      return new Blob([new Uint8Array(zipBytes)], { type: "application/zip" });
    } catch (error) {
      throw new Error(
        `WASM zip creation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
