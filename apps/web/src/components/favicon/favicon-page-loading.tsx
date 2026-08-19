import { FiLoader } from "react-icons/fi";

export default function FaviconPageLoading() {
  return (
    <main
      className="flex min-h-screen w-full items-center justify-center bg-[#efefef] text-[#3494e7]"
      role="status"
      aria-label="Loading favicon converter"
    >
      <FiLoader className="h-7 w-7 animate-spin" aria-hidden="true" />
      <span className="sr-only">Loading</span>
    </main>
  );
}
