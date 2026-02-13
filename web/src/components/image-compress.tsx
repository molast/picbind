import React from "react";
import { twMerge } from "tailwind-merge";
import { Tool, Status } from "@/types";
import AlertBar from "./alert-bar";
import { ConfirmModal } from "./confirm-modal";
import { updTask } from "@/lib/api";
import UploadBox from "./upload-box";

interface PropsData {
  expand: boolean;
  file: File | null;
  tool: Tool;
  status: string;
  setStatus: (status: Status) => void;
  result: string;
  setResult: (result: string) => void;
}

function ImageTransfer({
  expand,
  file,
  tool,
  status,
  setStatus,
  result,
  setResult,
}: PropsData) {
  const [maxWidth, setMaxWidth] = React.useState("900px");
  const [errorInfo, setErrorInfo] = React.useState<any>(null);

  // 退出
  const handleStop = async () => {
    updTask({});
    setStatus("Finish");
  };

  return (
    <div id="image-compress" className="w-full h-full space-y-4 flex flex-col">
      {/* 占位区 */}
      <div className="w-full">
        {status === "Error" && <AlertBar errInfo={errorInfo} />}
      </div>

      {/* 上传区 */}
      <div className="show w-full grow flex flex-col justify-center items-center space-y-4">
        {/* 上传容器 */}
      </div>

      {/* 操作区 */}
      <div className="w-full h-12 md:hidden"></div>
      <div
        className={twMerge(
          "action flex justify-between space-x-4 fixed left-0 bottom-12 w-full px-4 pt-2 bg-background/95 md:static md:p-0",
          expand && "md:px-12",
        )}
      >
        <ConfirmModal confirm={handleStop} />
      </div>
    </div>
  );
}

export default ImageTransfer;
