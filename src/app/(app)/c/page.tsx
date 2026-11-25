"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { MobileConversations } from "@/components/mobile-list";
import { useApp } from "@/lib/store";

/** On a computer: straight to the first channel. On a phone: the list of conversations. */
export default function MessagingHome() {
  const router = useRouter();
  const { conversations } = useApp();
  const first = conversations.find((c) => c.name === "general") ?? conversations[0];

  useEffect(() => {
    if (first && window.matchMedia("(min-width: 768px)").matches) router.replace(`/c/${first.id}`);
  }, [first, router]);

  return (
    <div className="flex min-h-0 flex-1 flex-col md:hidden">
      <MobileConversations />
    </div>
  );
}
