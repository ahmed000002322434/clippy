import { toast as sonnerToast } from "sonner";

export interface ToastOptions {
  title?: string;
  description?: string;
  variant?: "default" | "destructive";
}

export function useToast() {
  return {
    toast: (opts: ToastOptions) => {
      if (opts.variant === "destructive") {
        sonnerToast.error(opts.title ?? "Error", {
          description: opts.description,
        });
      } else {
        sonnerToast(opts.title ?? "Done", { description: opts.description });
      }
    },
  };
}
