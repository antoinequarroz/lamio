import { ConversationView } from "@/components/conversation";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  return <ConversationView id={(await params).id} />;
}
