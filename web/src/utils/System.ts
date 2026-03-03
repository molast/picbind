import ImageManager from "./Image";

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
    const file = await ImageManager.imageToFile(url);
    const currentTime = SystemManager.getNowformatTime();
    const metaType = file?.type.split("/")[1] || url.split(".")[1];
    const resultName = name || `result-${currentTime}.${metaType.split("+")[0]}`;
    const localUrl = URL.createObjectURL(file as File);
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

  static downloadVideo = (url: string, name?: string) => {
    fetch(url)
      .then((response) => response.blob())
      .then((blob) => {
        const currentTime = SystemManager.getNowformatTime();
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = name || `result-${currentTime}.mp4`;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
      })
      .catch((error) => {
        console.error("download video failed:", error);
      });
  };

  static downloadZip = async (items: Array<{ name: string; url: string }>, zipName?: string) => {
    const validItems = items.filter((item) => item.url);
    if (!validItems.length) return;

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
    link.download = zipName || `result-${SystemManager.getNowformatTime()}.zip`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 300);
  };

  private static async createZipBlob(items: ZipItem[]) {
    const encoder = new TextEncoder();
    const localParts: Uint8Array[] = [];
    const centralParts: Uint8Array[] = [];
    let offset = 0;

    for (const item of items) {
      const data = new Uint8Array(await item.blob.arrayBuffer());
      const fileName = encoder.encode(item.name);
      const crc32 = SystemManager.crc32(data);
      const dosTime = SystemManager.getDosTime();
      const dosDate = SystemManager.getDosDate();

      const localHeader = new Uint8Array(30 + fileName.length + data.length);
      const localView = new DataView(localHeader.buffer);
      let pointer = 0;
      localView.setUint32(pointer, 0x04034b50, true); pointer += 4;
      localView.setUint16(pointer, 20, true); pointer += 2;
      localView.setUint16(pointer, 0, true); pointer += 2;
      localView.setUint16(pointer, 0, true); pointer += 2;
      localView.setUint16(pointer, dosTime, true); pointer += 2;
      localView.setUint16(pointer, dosDate, true); pointer += 2;
      localView.setUint32(pointer, crc32, true); pointer += 4;
      localView.setUint32(pointer, data.length, true); pointer += 4;
      localView.setUint32(pointer, data.length, true); pointer += 4;
      localView.setUint16(pointer, fileName.length, true); pointer += 2;
      localView.setUint16(pointer, 0, true); pointer += 2;
      localHeader.set(fileName, pointer); pointer += fileName.length;
      localHeader.set(data, pointer);
      localParts.push(localHeader);

      const centralHeader = new Uint8Array(46 + fileName.length);
      const centralView = new DataView(centralHeader.buffer);
      pointer = 0;
      centralView.setUint32(pointer, 0x02014b50, true); pointer += 4;
      centralView.setUint16(pointer, 20, true); pointer += 2;
      centralView.setUint16(pointer, 20, true); pointer += 2;
      centralView.setUint16(pointer, 0, true); pointer += 2;
      centralView.setUint16(pointer, 0, true); pointer += 2;
      centralView.setUint16(pointer, dosTime, true); pointer += 2;
      centralView.setUint16(pointer, dosDate, true); pointer += 2;
      centralView.setUint32(pointer, crc32, true); pointer += 4;
      centralView.setUint32(pointer, data.length, true); pointer += 4;
      centralView.setUint32(pointer, data.length, true); pointer += 4;
      centralView.setUint16(pointer, fileName.length, true); pointer += 2;
      centralView.setUint16(pointer, 0, true); pointer += 2;
      centralView.setUint16(pointer, 0, true); pointer += 2;
      centralView.setUint16(pointer, 0, true); pointer += 2;
      centralView.setUint16(pointer, 0, true); pointer += 2;
      centralView.setUint32(pointer, 0, true); pointer += 4;
      centralView.setUint32(pointer, offset, true); pointer += 4;
      centralHeader.set(fileName, pointer);
      centralParts.push(centralHeader);

      offset += localHeader.length;
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    let pointer = 0;
    endView.setUint32(pointer, 0x06054b50, true); pointer += 4;
    endView.setUint16(pointer, 0, true); pointer += 2;
    endView.setUint16(pointer, 0, true); pointer += 2;
    endView.setUint16(pointer, items.length, true); pointer += 2;
    endView.setUint16(pointer, items.length, true); pointer += 2;
    endView.setUint32(pointer, centralSize, true); pointer += 4;
    endView.setUint32(pointer, offset, true); pointer += 4;
    endView.setUint16(pointer, 0, true);

    return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
  }

  private static getDosTime() {
    const now = new Date();
    return (now.getHours() << 11) | (now.getMinutes() << 5) | (Math.floor(now.getSeconds() / 2));
  }

  private static getDosDate() {
    const now = new Date();
    return (((now.getFullYear() - 1980) & 0x7f) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  }

  private static crc32(data: Uint8Array) {
    let crc = 0 ^ -1;
    for (let i = 0; i < data.length; i += 1) {
      crc = (crc >>> 8) ^ SystemManager.crcTable[(crc ^ data[i]) & 0xff];
    }
    return (crc ^ -1) >>> 0;
  }

  private static crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();
}