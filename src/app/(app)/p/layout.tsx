/** Module Projets: the look of the suite, with its own accent (see .module-projets in globals.css). */
export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  return <div className="module-projets flex min-h-0 flex-1 flex-col">{children}</div>;
}
