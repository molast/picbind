import React from "react";
import { twMerge } from "tailwind-merge";
import { Tool, Status } from "@/types";
import AlertBar from "./alert-bar";
import { ConfirmModal } from "./confirm-modal";
import UploadZone from "./upload-zone";
import { compressWithWasm } from "@/utils/wasm";

interface PropsData {
  expand: boolean;
  file: File | null;
  tool: Tool;
  status: string;
  setStatus: (status: Status) => void;
  result: string;
  setResult: (result: string) => void;
}

function ImageCompress({
  expand,
  file,
  tool,
  status,
  setStatus,
  result,
  setResult,
}: PropsData) {
  const [errorInfo, setErrorInfo] = React.useState<any>(null);
  const [compressing, setCompressing] = React.useState(false);

  React.useEffect(() => {
    if (!file) {
      setResult("");
      return;
    }

    let compressedObjectUrl: string | null = null;

    const run = async () => {
      try {
        setCompressing(true);
        setStatus("Pending");
        setErrorInfo(null);

        const compressedBlob = await compressWithWasm(file, 80);
        compressedObjectUrl = URL.createObjectURL(compressedBlob);
        setResult(compressedObjectUrl);
        setStatus("Done");
      } catch (err) {
        console.error(err);
        setErrorInfo(err);
        setStatus("Error");
      } finally {
        setCompressing(false);
      }
    };

    run();

    return () => {
      if (compressedObjectUrl) {
        URL.revokeObjectURL(compressedObjectUrl);
      }
    };
  }, [file, compressWithWasm, setResult, setStatus]);

  const handleStop = () => {
    setStatus("Finish");
  };

  return (
    <div
      id="image-compress"
      className="w-full h-full flex flex-col bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900"
    >
      <div className="flex-1 w-full flex flex-col items-center justify-center px-4">
        {status === "Error" && (
          <div className="mb-4 w-full max-w-2xl">
            <AlertBar errInfo={errorInfo} />
          </div>
        )}
        <div className="w-full max-w-2xl">
          <UploadZone />
        </div>
      </div>

      <div className="w-full h-12 md:h-14" />
      <div
        className={twMerge(
          "action flex justify-between space-x-4 fixed left-0 bottom-0 w-full px-4 py-2 bg-background/95 md:px-12",
          expand && "md:px-12",
        )}
      >
        <div className="text-xs text-slate-400 flex items-center">
          {compressing
            ? "正在使用 WASM 进行压缩…"
            : file
              ? "当前单图已压缩完成，可在顶部下载结果；右侧列表支持批量压缩。"
              : "请先在左侧上传一张图片以执行单图压缩，或在中间区域批量上传进行压缩。"}
        </div>
        <ConfirmModal confirm={handleStop} />
      </div>
    </div>
  );
}

export default ImageCompress;
