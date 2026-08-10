import { useAuth } from "@/hooks/use-auth";
import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ClippyLogo } from "@/components/ClippyLogo";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router";
import {
  Clapperboard,
  LayoutDashboard,
  LogOut,
  Settings,
  Sparkles,
  Wand2,
} from "lucide-react";
import type { ReactNode } from "react";

export function AppShell({
  children,
  title,
  actions,
}: {
  children: ReactNode;
  title?: string;
  actions?: ReactNode;
}) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const aiStatus = useQuery(api.status.aiStatus);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const initial = (user?.name || user?.email || "U").charAt(0).toUpperCase();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 px-4 pt-3 sm:px-6">
        <div className="clay flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/dashboard")}
              className="clay-press flex items-center gap-2 rounded-full"
              aria-label="Clippy — go to projects"
            >
              <ClippyLogo size={30} alt="" />
            </button>
            <span className="hidden sm:block text-sm font-bold tracking-tight">
              Clippy
            </span>
          </div>

          <nav className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="clay-chip"
              onClick={() => navigate("/dashboard")}
            >
              <LayoutDashboard className="size-4" />
              <span className="hidden sm:inline">Projects</span>
            </Button>
            {aiStatus && (
              <span
                className="clay-chip flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-muted-foreground"
                title={
                  aiStatus.transcriptionConfigured || aiStatus.llmConfigured
                    ? "AI providers connected"
                    : "No AI provider keys configured yet"
                }
              >
                <Wand2 className="size-3.5" />
                {aiStatus.transcriptionConfigured || aiStatus.llmConfigured ? (
                  <span className="text-emerald-700 dark:text-emerald-300">AI ready</span>
                ) : (
                  <span>AI keys needed</span>
                )}
              </span>
            )}
          </nav>

          <div className="flex items-center gap-2">
            {title && (
              <span className="hidden lg:block text-sm font-semibold text-muted-foreground max-w-48 truncate">
                {title}
              </span>
            )}
            {actions}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="clay-press rounded-full">
                  <Avatar className="size-9">
                    {user?.image && <AvatarImage src={user.image} alt="" />}
                    <AvatarFallback className="bg-primary/15 text-primary font-bold">
                      {initial}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="flex items-center gap-2">
                  <Sparkles className="size-4 text-primary" />
                  <span className="truncate">
                    {user?.name || user?.email || "Creator"}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/dashboard")} className="cursor-pointer">
                  <LayoutDashboard className="mr-2 size-4" />
                  Projects
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/settings")} className="cursor-pointer">
                  <Settings className="mr-2 size-4" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/")} className="cursor-pointer">
                  <Clapperboard className="mr-2 size-4" />
                  Landing page
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleSignOut}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
      <main className="flex-1 px-4 sm:px-6 py-6">{children}</main>
    </div>
  );
}
