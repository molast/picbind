'use client'
import React from "react"
import PhotoshowLand from "./_component/land"
import PhotoshowEdit from "./_component/edit"
import { useStore } from "@/stores";
import { Tool } from "@/types"
import Locale from '@/locales'
const tools = Locale.Photo.Tool.list

export default function PhotoshowPage() {
  const { setToken } = useStore();
  const [tool, setTool] = React.useState<Tool>(tools[0])
  const [file, setFile] = React.useState<File | null>(null)

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      document.title = Locale.Title;

      const apiKeyFromEnv = process.env.NEXT_PUBLIC_API_KEY;
      if (apiKeyFromEnv) {
        setToken(apiKeyFromEnv);
      }
    }
  }, [setToken]);

  return (
    <div id="photoshow-page" className="w-full p-4">
      {file
        ? <PhotoshowEdit tool={tool} setTool={setTool} file={file} setFile={setFile} />
        : <PhotoshowLand tool={tool} setTool={setTool} file={file} setFile={setFile} />
      }
    </div>
  )
}
