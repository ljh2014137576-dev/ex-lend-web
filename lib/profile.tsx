"use client";

import { createContext, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "exlend-profile";

type ProfileContextValue = {
  name: string;
  avatar: string;
  setName: (s: string) => void;
  setAvatar: (s: string) => void;
};

const ProfileContext = createContext<ProfileContextValue>({
  name: "",
  avatar: "",
  setName: () => {},
  setAvatar: () => {},
});

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { name?: string; avatar?: string };
        if (p.name) setName(p.name);
        if (p.avatar) setAvatar(p.avatar);
      }
    } catch {
      // ignore corrupt profile
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ name, avatar }));
  }, [name, avatar]);

  return (
    <ProfileContext.Provider value={{ name, avatar, setName, setAvatar }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  return useContext(ProfileContext);
}