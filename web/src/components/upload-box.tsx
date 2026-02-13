import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

type UploadStatus = "waiting" | "processing" | "finished";

type UploadItem = {
  id: string;
  file: File;
  progress: number;
  status: UploadStatus;
  outputBlob?: Blob;
};

type UploadBoxProps = {
  onStartProcess?: (
    file: File,
    onProgress: (progress: number) => void,
    onFinish: (output?: Blob) => void,
  ) => void;
};

const MAX_FILES = 20;

const UploadBox = ({ onStartProcess }: UploadBoxProps) => {
  const [items, setItems] = useState<UploadItem[]>([]);

  const onDrop = useCallback((accepted: File[]) => {
    setItems((prev) => {
      const remain = MAX_FILES - prev.length;

      const next = accepted.slice(0, remain).map((file) => ({
        id: crypto.randomUUID(),
        file,
        progress: 0,
        status: "waiting" as UploadStatus,
      }));
      return [...prev, ...next];
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxFiles: MAX_FILES,
    accept: { "image/*": [] },
  });

  const startProcess = (item: UploadItem) => {
    if (!onStartProcess) return;

    setItems((prev) =>
      prev.map((it) =>
        it.id === item.id ? { ...it, status: "processing" } : it,
      ),
    );

    onStartProcess(
      item.file,
      (progress) => {
        setItems((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, progress } : it)),
        );
      },
      (output) => {
        setItems((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? { ...it, progress: 100, status: "finished", output }
              : it,
          ),
        );
      },
    );
  };

  return <div className="w-full h-full relative"></div>;
};

export default UploadBox;
