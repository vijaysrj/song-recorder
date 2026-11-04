"use client";

import { useSearchParams } from "next/navigation";

const MESSAGES: Record<string, string> = {
  denied: "That Google account isn't allowed to use this app.",
  setup: "Google sign-in isn't set up yet.",
  expired: "The sign-in took too long. Please try again.",
  google: "Google sign-in failed. Please try again.",
};

export default function LoginError() {
  const error = useSearchParams().get("error");
  if (!error) return null;
  return <p className="text-sm text-red-400">{MESSAGES[error] ?? MESSAGES.google}</p>;
}
