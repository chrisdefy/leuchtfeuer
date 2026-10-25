import { useEffect, useRef, useState } from "react";

/** One level of folders to sort chats and chatrooms; each list has its own folders. */
export interface Folder {
  id: string;
  name: string;
  kind: "chats" | "rooms";
  collapsed?: boolean;
  createdAt: number;
}

const KEY = "router.folders.v1";

export function useFolders() {
  const [folders, setFolders] = useState<Folder[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(folders));
    } catch {
      /* storage full; folders stay in memory */
    }
  }, [folders]);
  return [folders, setFolders] as const;
}
