"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ConversationList, MobileActions } from "@/components/app-shell";
import { PageHeader } from "@/components/ui";
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
      <PageHeader title="Messagerie">
        <MobileActions />
      </PageHeader>
      <div className="scroll-thin flex flex-1 flex-col overflow-y-auto px-2 py-2">
        <ConversationList />
      </div>
    </div>
  );
}
