import { CalendarDays, Clapperboard, FileText, LayoutGrid, MessagesSquare, Send, type LucideProps } from "lucide-react";

const ICONS: Record<string, React.ComponentType<LucideProps>> = {
  messages: MessagesSquare,
  notes: FileText,
  publication: Send,
  agenda: CalendarDays,
  studio: Clapperboard,
};

export function ModuleIcon({ icon, ...props }: { icon: string } & LucideProps) {
  const Icon = ICONS[icon] ?? LayoutGrid;
  return <Icon {...props} />;
}
