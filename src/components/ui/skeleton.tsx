import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "rounded-md bg-muted",
        "bg-[length:200%_100%] bg-[linear-gradient(90deg,transparent_0%,oklch(0.90_0.002_260/0.5)_50%,transparent_100%)] animate-[shimmer_1.5s_ease-in-out_infinite] [animation-fill-mode:backwards]",
        "dark:bg-[linear-gradient(90deg,transparent_0%,oklch(0.30_0.002_260/0.5)_50%,transparent_100%)]",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
