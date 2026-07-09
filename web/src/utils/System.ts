type ZipItem = {
  name: string;
  url: string;
};

type ZipCentralRecord = {
  name: Uint8Array;
  crc32: number;
  size: number;
  offset: number;
};

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_VERSION = 20;
const ZIP_UTF8_FLAG = 0x0800;

const crc32Table = new Uint32Array(256);
for (let i = 0; i < crc32Table.length; i += 1) {
  let crc = i;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  crc32Table[i] = crc >>> 0;
}

function pushU16Le(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushU32Le(target: number[], value: number) {
  target.push(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
}

function createLocalFileHeader(name: Uint8Array, crc32: number, size: number) {
  const header: number[] = [];
  pushU32Le(header, ZIP_LOCAL_FILE_HEADER_SIGNATURE);
  pushU16Le(header, ZIP_VERSION);
  pushU16Le(header, ZIP_UTF8_FLAG);
  pushU16Le(header, 0);
  pushU16Le(header, 0);
  pushU16Le(header, 0);
  pushU32Le(header, crc32);
  pushU32Le(header, size);
  pushU32Le(header, size);
  pushU16Le(header, name.byteLength);
  pushU16Le(header, 0);
  return new Uint8Array([...header, ...name]);
}

function createCentralDirectoryHeader(record: ZipCentralRecord) {
  const header: number[] = [];
  pushU32Le(header, ZIP_CENTRAL_DIRECTORY_HEADER_SIGNATURE);
  pushU16Le(header, ZIP_VERSION);
  pushU16Le(header, ZIP_VERSION);
  pushU16Le(header, ZIP_UTF8_FLAG);
  pushU16Le(header, 0);
  pushU16Le(header, 0);
  pushU16Le(header, 0);
  pushU32Le(header, record.crc32);
  pushU32Le(header, record.size);
  pushU32Le(header, record.size);
  pushU16Le(header, record.name.byteLength);
  pushU16Le(header, 0);
  pushU16Le(header, 0);
  pushU16Le(header, 0);
  pushU16Le(header, 0);
  pushU32Le(header, 0);
  pushU32Le(header, record.offset);
  return new Uint8Array([...header, ...record.name]);
}

function createEndOfCentralDirectory(fileCount: number, centralSize: number, centralOffset: number) {
  const header: number[] = [];
  pushU32Le(header, ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  pushU16Le(header, 0);
  pushU16Le(header, 0);
  pushU16Le(header, fileCount);
  pushU16Le(header, fileCount);
  pushU32Le(header, centralSize);
  pushU32Le(header, centralOffset);
  pushU16Le(header, 0);
  return new Uint8Array(header);
}

function calculateCrc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    crc = crc32Table[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

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
      const zipBlob = await SystemManager.createZipBlob(validItems);
      const link = document.createElement("a");
      const objectUrl = URL.createObjectURL(zipBlob);
      link.href = objectUrl;
      link.download = zipName || `picbind-${SystemManager.getNowformatTime()}.zip`;
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
    const encoder = new TextEncoder();
    const parts: BlobPart[] = [];
    const centralRecords: ZipCentralRecord[] = [];
    let offset = 0;

    for (const item of items) {
      const name = encoder.encode(item.name);
      if (name.byteLength > 0xffff) {
        throw new Error(`File name is too long for ZIP: ${item.name}`);
      }

      const blob = await fetch(item.url).then((response) => response.blob());
      const size = blob.size;
      if (size > 0xffffffff || offset > 0xffffffff) {
        throw new Error("ZIP is too large for ZIP32");
      }

      const bytes = new Uint8Array(await blob.arrayBuffer());
      const crc32 = calculateCrc32(bytes);
      const localHeader = createLocalFileHeader(name, crc32, size);

      parts.push(localHeader, blob);
      centralRecords.push({
        name,
        crc32,
        size,
        offset,
      });
      offset += localHeader.byteLength + size;
    }

    const centralOffset = offset;
    for (const record of centralRecords) {
      const centralHeader = createCentralDirectoryHeader(record);
      parts.push(centralHeader);
      offset += centralHeader.byteLength;
    }

    const centralSize = offset - centralOffset;
    if (centralRecords.length > 0xffff || centralSize > 0xffffffff || centralOffset > 0xffffffff) {
      throw new Error("ZIP is too large for ZIP32");
    }

    parts.push(
      createEndOfCentralDirectory(centralRecords.length, centralSize, centralOffset),
    );

    return new Blob(parts, { type: "application/zip" });
  }
}
