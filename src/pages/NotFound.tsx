import { motion } from "framer-motion";
import { ClippyLogo } from "@/components/ClippyLogo";

export default function NotFound() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="min-h-screen flex flex-col"
    >
      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-4">
        <div className="flex items-center justify-center min-h-[200px]">
          <div className="text-center">
            <div className="mb-6 flex justify-center">
              <ClippyLogo size={72} alt="Clippy" />
            </div>
            <h1 className="mb-4 text-4xl font-bold text-foreground">404</h1>
            <p className="text-lg text-muted-foreground">Page Not Found</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
